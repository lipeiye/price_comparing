/**
 * 与 analyzeQuotes/cache.js 保持同步（两云函数独立部署，故各有一份）。
 * 报价结果服务端缓存：按内容 hash 去重，省 AI token。
 */
const crypto = require('crypto')

const COLLECTION = 'quote_cache'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const DOC_SIZE_SOFT_LIMIT = 900 * 1024

let dbReady = null

function getDb() {
  if (dbReady) return dbReady
  dbReady = (async () => {
    try {
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

function hashWorkbooks(workbooks) {
  const units = (Array.isArray(workbooks) ? workbooks : []).map((wb) => ({
    sheets: (wb.sheets || []).map((s) => ({
      sheetName: String(s.sheetName || ''),
      rows: s.rows || [],
    })),
  }))
  units.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
  return crypto.createHash('sha256').update(stableStringify(units)).digest('hex')
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
      report: existing?.report || null,
      reportGeneratedAt: existing?.reportGeneratedAt || null,
      rawWorkbooks: payload.rawWorkbooks || existing?.rawWorkbooks || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: now + TTL_MS,
      schemaVersion: 1,
    }
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
  return {
    success: true,
    requestId,
    cacheHit: Boolean(cacheHit),
    contentHash: doc.contentHash || doc._id,
    suppliers: doc.suppliers || [],
    items: doc.items || [],
    warnings: doc.warnings || [],
    summary: doc.summary || { zh: '', en: '' },
    cachedReport: doc.report
      ? { report: doc.report, generatedAt: doc.reportGeneratedAt || null }
      : null,
  }
}

module.exports = {
  COLLECTION,
  hashWorkbooks,
  getByHash,
  saveAnalyzeResult,
  saveReport,
  toAnalyzeResponse,
}
