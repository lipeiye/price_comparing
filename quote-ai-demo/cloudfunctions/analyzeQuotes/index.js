const { alignQuotes } = require('./align')
const {
  hashWorkbooks,
  getByHash,
  saveAnalyzeResult,
  toAnalyzeResponse,
} = require('./cache')

// 快速决策架构：核心结果完全由代码生成，AI 只留给用户按需生成详细报告。
// 这样首次上传也能在数秒内得到可读结论，不受模型延迟影响。
const MIN_WORKBOOKS = 2
const MAX_WORKBOOKS = 8
const MAX_PAYLOAD_CHARS = 2000000
const FUNCTION_VERSION = 'v7-fast-rule-decision'

exports.main = async (event = {}) => {
  const requestId = event.requestId || event.requestContext?.requestId || `req_${Date.now()}`

  try {
    if (getRequestMethod(event) === 'OPTIONS') return response(204, {})
    if (isHealthCheck(event)) {
      return response(200, { success: true, pong: true, version: FUNCTION_VERSION, cache: true })
    }

    const parsed = parseRequest(event)
    if (parsed.mode === 'lookup') {
      const doc = await getByHash(parsed.contentHash)
      if (!doc || !Array.isArray(doc.items) || doc.items.length === 0) {
        throw userError('未找到该比价缓存，或已过期。请重新上传报价单。', 404)
      }
      return response(200, toAnalyzeResponse(doc, { requestId, cacheHit: true }))
    }

    const workbooks = parsed.workbooks
    const contentHash = hashWorkbooks(workbooks)
    const cached = await getByHash(contentHash)
    if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
      console.log(JSON.stringify({ requestId, message: 'cache hit', contentHash }))
      return response(200, toAnalyzeResponse(cached, { requestId, cacheHit: true }))
    }

    const aligned = alignQuotes(workbooks)
    if (aligned.items.length === 0) {
      throw userError(
        '未能从这些报价单中识别出任何项目。请确认每份表都包含「LZ Project No」列和「Total price」列，且有数据行。',
        400,
      )
    }

    const summary = buildDeterministicSummary(aligned)
    const resultBody = {
      success: true,
      requestId,
      cacheHit: false,
      contentHash,
      suppliers: aligned.suppliers,
      items: aligned.items,
      warnings: aligned.warnings,
      summary,
      procurementSummary: aligned.procurementSummary,
      cachedReport: null,
    }

    await saveAnalyzeResult(contentHash, {
      fileNames: workbooks.map((workbook) => workbook.filename),
      suppliers: aligned.suppliers,
      items: aligned.items,
      warnings: aligned.warnings,
      summary,
      procurementSummary: aligned.procurementSummary,
      // 瘦身存盘：只留 filename + 主表前 40 行，供日后恢复报告上下文。
      rawWorkbooks: slimWorkbooksForCache(workbooks),
    })

    return response(200, resultBody)
  } catch (error) {
    console.error(
      JSON.stringify({ requestId, message: error.message, code: error.code, stack: error.stack }),
    )
    return response(error.statusCode || 500, {
      success: false,
      requestId,
      message: error.userMessage || 'Excel 报价单分析失败，请检查文件格式后重试。',
      detail: error.exposeDetail ? error.message : undefined,
    })
  }
}

function buildDeterministicSummary(aligned) {
  const totals = aligned.procurementSummary?.supplierTotals || []
  const supplierName = (supplierId) =>
    aligned.suppliers.find((supplier) => supplier.id === supplierId)?.name || '—'
  const leader = totals.find(
    (total) => total.supplierId === aligned.procurementSummary?.orderLeaderSupplierId,
  )
  const priceLeader = totals.find(
    (total) => total.supplierId === aligned.procurementSummary?.priceLeaderSupplierId,
  )
  const leaderName = leader ? supplierName(leader.supplierId) : supplierName(priceLeader?.supplierId)
  const missing = totals.reduce((sum, total) => sum + total.missingItems, 0)
  const specWarnings = aligned.warnings.filter((warning) => warning.type === 'SPEC_MISMATCH').length
  const savings = aligned.procurementSummary?.knownOrderSavings
  const totalText = leader
    ? `已知首单金额 RMB ${Math.round(leader.knownFirstOrderTotal).toLocaleString()}（含模具费）`
    : '首单数量不完整，暂不计算总采购额'
  const savingText = savings != null && savings > 0
    ? `，相对次优已知金额节省 RMB ${Math.round(savings).toLocaleString()}`
    : ''

  return {
    zh: `快速结论：${leaderName} 当前价格领先；${totalText}${savingText}。需先核实 ${missing} 项漏报及 ${specWarnings} 项规格差异，再下单。`,
    en: `Quick decision: ${leaderName} currently leads on price. ${leader ? `Known first-order cost is RMB ${Math.round(leader.knownFirstOrderTotal).toLocaleString()}, including tooling` : 'First-order quantities are incomplete, so no total order cost is shown'}${savings != null && savings > 0 ? `, saving RMB ${Math.round(savings).toLocaleString()} versus the next comparable quote` : ''}. Verify ${missing} missing quotes and ${specWarnings} specification differences before placing the order.`,
  }
}

function slimWorkbooksForCache(workbooks) {
  return workbooks.map((workbook) => ({
    filename: workbook.filename,
    sheets: (workbook.sheets || []).slice(0, 2).map((sheet) => ({
      sheetName: sheet.sheetName,
      rows: (sheet.rows || []).slice(0, 40),
    })),
  }))
}

function parseRequest(event) {
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || ''
  if (contentType.includes('multipart/form-data')) {
    const error = userError('网站已升级，请强制刷新页面（Ctrl/Cmd + Shift + R）后重试。', 400)
    error.exposeDetail = true
    throw error
  }

  const bodyText = getRequestBodyText(event)
  if (bodyText.length > MAX_PAYLOAD_CHARS) {
    throw userError('上传的数据过大，请确认每份报价单不超过 120 行有效数据。', 413)
  }

  let payload
  try {
    payload = bodyText ? JSON.parse(bodyText) : {}
  } catch {
    const error = userError(`请求体不是合法 JSON。当前 content-type: ${contentType || '空'}`, 400)
    error.exposeDetail = true
    throw error
  }

  if (payload?.action === 'lookup' || (payload?.contentHash && !payload?.workbooks)) {
    const contentHash = typeof payload.contentHash === 'string' ? payload.contentHash.trim() : ''
    if (!/^[a-f0-9]{64}$/i.test(contentHash)) throw userError('contentHash 无效。', 400)
    return { mode: 'lookup', contentHash: contentHash.toLowerCase() }
  }

  const workbooks = payload?.workbooks
  if (!Array.isArray(workbooks) || workbooks.length < MIN_WORKBOOKS) {
    throw userError('请至少上传 2 份供应商 Excel 报价单。', 400)
  }
  if (workbooks.length > MAX_WORKBOOKS) {
    throw userError(`最多只能上传 ${MAX_WORKBOOKS} 份供应商 Excel 报价单。`, 400)
  }
  return { mode: 'analyze', workbooks: workbooks.map(sanitizeWorkbook) }
}

function sanitizeWorkbook(workbook, index) {
  const filename =
    typeof workbook?.filename === 'string' && workbook.filename.trim()
      ? workbook.filename.trim().slice(0, 200)
      : `报价单 ${index + 1}`
  const sheets = (Array.isArray(workbook?.sheets) ? workbook.sheets : [])
    .slice(0, 6)
    .map((sheet, sheetIndex) => sanitizeSheet(sheet, sheetIndex))
    .filter((sheet) => sheet.rows.some((row) => row.some((cell) => cell !== null && cell !== '')))
  if (sheets.length === 0) throw userError(`${filename} 里没有可分析的表格数据。`, 400)
  return { filename, sheets }
}

function sanitizeSheet(sheet, sheetIndex) {
  const sheetName =
    typeof sheet?.sheetName === 'string' && sheet.sheetName.trim()
      ? sheet.sheetName.trim().slice(0, 100)
      : `Sheet${sheetIndex + 1}`
  const columns = Array.isArray(sheet?.columns) ? sheet.columns.slice(0, 90) : []
  const rows = (Array.isArray(sheet?.rows) ? sheet.rows : [])
    .slice(0, 120)
    .map((row) => (Array.isArray(row) ? row.slice(0, 90).map(sanitizeCellValue) : []))
  return { sheetName, columns, rows }
}

function sanitizeCellValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 2000)
  return String(value).slice(0, 2000)
}

function getRequestMethod(event) {
  return event.httpMethod || event.requestContext?.http?.method || event.requestContext?.method || ''
}

function isHealthCheck(event) {
  const path = event.path || event.requestContext?.path || ''
  const query = event.queryString || event.queryStringParameters || {}
  if (query && (query.ping === '1' || query.ping === 'true' || query.health === '1')) return true
  if (typeof path === 'string' && path.includes('ping')) return true
  const raw = event.rawBody || event.body
  if (typeof raw === 'string' && raw.length < 200 && raw.includes('"ping"')) {
    try {
      return JSON.parse(raw)?.ping === true
    } catch {
      return false
    }
  }
  return false
}

function getRequestBodyText(event) {
  const body = event.rawBody || event.body || ''
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  if (typeof body === 'object') return JSON.stringify(body)
  if (event.isBase64Encoded) return Buffer.from(String(body), 'base64').toString('utf8')
  return String(body)
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(body),
  }
}

function userError(userMessage, statusCode = 400) {
  const error = new Error(userMessage)
  error.userMessage = userMessage
  error.statusCode = statusCode
  return error
}
