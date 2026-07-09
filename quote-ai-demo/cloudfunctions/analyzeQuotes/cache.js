/**
 * 报价结果服务端缓存（CloudBase 文档数据库）
 * - 按 workbooks 内容 SHA-256 去重，命中则跳过 AI，省 token
 * - 数据库不可用时静默降级（不影响主流程）
 */
const crypto = require('crypto')

const COLLECTION = 'quote_cache'
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const DOC_SIZE_SOFT_LIMIT = 900 * 1024 // 文档建议 < 1MB，超限只存 AI 字段
const REPORT_CACHE_VERSION = 'v4-bilingual'

let dbReady = null

function getDb() {
  if (dbReady) return dbReady
  dbReady = (async () => {
    try {
      // 运行时由云函数环境注入凭证；本地无环境时返回 null
      // eslint-disable-next-line import/no-unresolved, global-require
      const cloudbase = require('@cloudbase/node-sdk')
      const env =
        process.env.TCB_ENV ||
        process.env.SCF_NAMESPACE ||
        process.env.CLOUDBASE_ENV_ID ||
        cloudbase.SYMBOL_CURRENT_ENV
      const app = cloudbase.init({ env })
      return app.database()
    } catch (err) {
      console.warn(JSON.stringify({ message: 'cache db init failed', error: err.message }))
      return null
    }
  })()
  return dbReady
}

/** 稳定序列化：对象键排序，保证同内容同 hash */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

/**
 * 只对表格内容哈希（不含文件名），改名仍可命中。
 * 供应商顺序：按 sheet 内容排序后再 hash，顺序无关。
 */
function hashWorkbooks(workbooks) {
  const units = (Array.isArray(workbooks) ? workbooks : []).map((wb) => ({
    sheets: (wb.sheets || []).map((s) => ({
      sheetName: String(s.sheetName || ''),
      rows: s.rows || [],
    })),
  }))
  units.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
  const digest = crypto.createHash('sha256').update(stableStringify(units)).digest('hex')
  return digest
}

function isExpired(doc) {
  if (!doc) return true
  if (!doc.expiresAt) return false
  const ts = typeof doc.expiresAt === 'number' ? doc.expiresAt : Date.parse(doc.expiresAt)
  return Number.isFinite(ts) && Date.now() > ts
}

async function getByHash(contentHash) {
  if (!contentHash || typeof contentHash !== 'string') return null
  try {
    const db = await getDb()
    if (!db) return null
    const res = await db.collection(COLLECTION).doc(contentHash).get()
    const doc = Array.isArray(res.data) ? res.data[0] : res.data
    if (!doc || isExpired(doc)) return null
    return doc
  } catch (err) {
    // 文档不存在时 CloudBase 可能抛错
    console.warn(JSON.stringify({ message: 'cache get failed', contentHash, error: err.message }))
    return null
  }
}

async function saveAnalyzeResult(contentHash, payload) {
  if (!contentHash) return false
  try {
    const db = await getDb()
    if (!db) return false

    const now = Date.now()
    const existing = await getByHash(contentHash)

    const base = {
      contentHash,
      fileNames: payload.fileNames || [],
      suppliers: payload.suppliers || [],
      items: payload.items || [],
      warnings: payload.warnings || [],
      summary: payload.summary || { zh: '', en: '' },
      procurementSummary: payload.procurementSummary || null,
      // 保留已有报告，避免只重跑比价时丢掉
      report: existing?.report || null,
      reportGeneratedAt: existing?.reportGeneratedAt || null,
      reportCacheVersion: existing?.reportCacheVersion || null,
      rawWorkbooks: payload.rawWorkbooks || existing?.rawWorkbooks || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: now + TTL_MS,
      schemaVersion: 1,
    }

    // 体量过大时丢掉 rawWorkbooks（报告仍可用前端再传的 raw）
    let doc = base
    if (JSON.stringify(doc).length > DOC_SIZE_SOFT_LIMIT) {
      doc = { ...doc, rawWorkbooks: null }
    }

    await db.collection(COLLECTION).doc(contentHash).set(doc)
    return true
  } catch (err) {
    console.warn(JSON.stringify({ message: 'cache save analyze failed', contentHash, error: err.message }))
    return false
  }
}

async function saveReport(contentHash, report, generatedAt) {
  if (!contentHash || !report) return false
  try {
    const db = await getDb()
    if (!db) return false
    const now = Date.now()
    const existing = await getByHash(contentHash)

    if (existing) {
      await db.collection(COLLECTION).doc(contentHash).update({
        report,
        reportGeneratedAt: generatedAt || new Date().toISOString(),
        updatedAt: now,
        expiresAt: now + TTL_MS,
      })
      return true
    }

    // 仅有报告、无比价记录时也写入（少见）
    await db.collection(COLLECTION).doc(contentHash).set({
      contentHash,
      report,
      reportGeneratedAt: generatedAt || new Date().toISOString(),
      suppliers: [],
      items: [],
      warnings: [],
      summary: { zh: '', en: '' },
      fileNames: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: now + TTL_MS,
      schemaVersion: 1,
    })
    return true
  } catch (err) {
    console.warn(JSON.stringify({ message: 'cache save report failed', contentHash, error: err.message }))
    return false
  }
}

function toAnalyzeResponse(doc, { requestId, cacheHit }) {
  const cachedReport = isCurrentBilingualReport(doc)
    ? { report: doc.report, generatedAt: doc.reportGeneratedAt || null }
    : null

  return {
    success: true,
    requestId,
    cacheHit: Boolean(cacheHit),
    contentHash: doc.contentHash || doc._id,
    suppliers: doc.suppliers || [],
    items: doc.items || [],
    warnings: doc.warnings || [],
    summary: doc.summary || { zh: '', en: '' },
    procurementSummary: doc.procurementSummary || null,
    // 旧版中文长报告不能作为英文报告展示，需由 generateReport 自动重建。
    cachedReport,
  }
}

function isCurrentBilingualReport(doc) {
  const report = doc?.report
  return Boolean(
    doc?.reportCacheVersion === REPORT_CACHE_VERSION &&
      report &&
      typeof report === 'object' &&
      report.verdict &&
      typeof report.verdict.zh === 'string' &&
      typeof report.verdict.en === 'string',
  )
}

module.exports = {
  COLLECTION,
  hashWorkbooks,
  getByHash,
  saveAnalyzeResult,
  saveReport,
  toAnalyzeResponse,
}
