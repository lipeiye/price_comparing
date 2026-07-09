const { quoteAnalysisPrompt } = require('./prompt')
const { quoteAnalysisSchema } = require('./schema')
const { alignQuotes } = require('./align')
const {
  hashWorkbooks,
  getByHash,
  saveAnalyzeResult,
  toAnalyzeResponse,
} = require('./cache')

// 两段式架构：
// 1. 代码对齐（秒级）
// 2. AI 叙述；若 contentHash 命中服务端缓存则跳过 AI
const MIN_WORKBOOKS = 2
const MAX_WORKBOOKS = 8
const MAX_PAYLOAD_CHARS = 2000000

const OVERALL_DEADLINE_MS = 185000
const AI_ATTEMPT_TIMEOUT_MS = 175000

const FUNCTION_VERSION = 'v6-cache-hash-30d'

exports.main = async (event = {}) => {
  const requestId = event.requestId || event.requestContext?.requestId || `req_${Date.now()}`

  try {
    if (getRequestMethod(event) === 'OPTIONS') {
      return response(204, {})
    }

    if (isHealthCheck(event)) {
      return response(200, { success: true, pong: true, version: FUNCTION_VERSION, cache: true })
    }

    const parsed = parseRequest(event)

    // 仅用 hash 拉取缓存（前端「恢复上次」走云端）
    if (parsed.mode === 'lookup') {
      const doc = await getByHash(parsed.contentHash)
      if (!doc || !Array.isArray(doc.items) || doc.items.length === 0) {
        throw userError('未找到该比价缓存，或已过期。请重新上传报价单。', 404)
      }
      return response(200, toAnalyzeResponse(doc, { requestId, cacheHit: true }))
    }

    const workbooks = parsed.workbooks
    const contentHash = hashWorkbooks(workbooks)

    // 服务端缓存命中：整份结果直接返回，不调 AI
    const cached = await getByHash(contentHash)
    if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
      console.log(JSON.stringify({ requestId, message: 'cache hit', contentHash }))
      return response(200, toAnalyzeResponse(cached, { requestId, cacheHit: true }))
    }

    // 第一段：代码对齐
    const aligned = alignQuotes(workbooks)

    if (aligned.items.length === 0) {
      throw userError(
        '未能从这些报价单中识别出任何项目。请确认每份表都包含「LZ Project No」列和「Total price」列，且有数据行。',
        400,
      )
    }

    // 第二段：AI 叙述
    const deadlineAt = Date.now() + OVERALL_DEADLINE_MS
    let aiNarrative = { summary: { zh: '', en: '' }, warnings: [] }
    try {
      aiNarrative = await callAi(aligned, workbooks, requestId, { deadlineAt })
    } catch (aiError) {
      console.warn(
        JSON.stringify({
          requestId,
          message: 'AI 叙述生成失败，返回不含建议的比价报告',
          error: aiError.message,
        }),
      )
      aiNarrative = {
        summary: {
          zh: 'AI 采购建议生成失败，以下为系统自动比价结果。最低价已逐项标出，请据此判断。',
          en: 'AI summary failed. Auto comparison below — lowest prices are marked per item.',
        },
        warnings: [],
      }
    }

    const mergedWarnings = [...aligned.warnings, ...(aiNarrative.warnings || [])]
    const resultBody = {
      success: true,
      requestId,
      cacheHit: false,
      contentHash,
      suppliers: aligned.suppliers,
      items: aligned.items,
      warnings: mergedWarnings,
      summary: aiNarrative.summary,
      cachedReport: null,
    }

    // 异步不阻塞返回：写入失败只打日志
    await saveAnalyzeResult(contentHash, {
      fileNames: workbooks.map((w) => w.filename),
      suppliers: aligned.suppliers,
      items: aligned.items,
      warnings: mergedWarnings,
      summary: aiNarrative.summary,
      // 瘦身存盘：只留 filename + 主表前 40 行，供日后恢复报告上下文
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

function slimWorkbooksForCache(workbooks) {
  return workbooks.map((wb) => ({
    filename: wb.filename,
    sheets: (wb.sheets || []).slice(0, 2).map((s) => ({
      sheetName: s.sheetName,
      rows: (s.rows || []).slice(0, 40),
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

  // 仅 hash 查询
  if (payload?.action === 'lookup' || (payload?.contentHash && !payload?.workbooks)) {
    const contentHash =
      typeof payload.contentHash === 'string' ? payload.contentHash.trim() : ''
    if (!/^[a-f0-9]{64}$/i.test(contentHash)) {
      throw userError('contentHash 无效。', 400)
    }
    return { mode: 'lookup', contentHash: contentHash.toLowerCase() }
  }

  const workbooks = payload?.workbooks
  if (!Array.isArray(workbooks) || workbooks.length < MIN_WORKBOOKS) {
    throw userError('请至少上传 2 份供应商 Excel 报价单。', 400)
  }
  if (workbooks.length > MAX_WORKBOOKS) {
    throw userError(`最多只能上传 ${MAX_WORKBOOKS} 份供应商 Excel 报价单。`, 400)
  }

  return {
    mode: 'analyze',
    workbooks: workbooks.map(sanitizeWorkbook),
  }
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

  if (sheets.length === 0) {
    throw userError(`${filename} 里没有可分析的表格数据。`, 400)
  }

  return { filename, sheets }
}

function sanitizeSheet(sheet, sheetIndex) {
  const sheetName =
    typeof sheet?.sheetName === 'string' && sheet.sheetName.trim()
      ? sheet.sheetName.trim().slice(0, 100)
      : `Sheet${sheetIndex + 1}`

  const columns = Array.isArray(sheet?.columns) ? sheet.columns.slice(0, 60) : []

  const rows = (Array.isArray(sheet?.rows) ? sheet.rows : [])
    .slice(0, 120)
    .map((row) => (Array.isArray(row) ? row.slice(0, 60).map(sanitizeCellValue) : []))

  return { sheetName, columns, rows }
}

function sanitizeCellValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 2000)
  return String(value).slice(0, 2000)
}

async function callAi(aligned, workbooks, requestId, { deadlineAt } = {}) {
  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_MODEL || 'deepseek-v4-flash'
  const endpoint = resolveEndpoint()

  if (!apiKey) {
    throw userError('真实 AI 尚未配置，缺少 AI_API_KEY。', 503)
  }

  const budget = typeof deadlineAt === 'number' ? deadlineAt - Date.now() : AI_ATTEMPT_TIMEOUT_MS
  const attemptTimeout = Math.max(1000, Math.min(AI_ATTEMPT_TIMEOUT_MS, budget))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), attemptTimeout)

  try {
    const slimRaw = workbooks.map((wb) => ({
      filename: wb.filename,
      sheets: wb.sheets.map((s) => ({
        sheetName: s.sheetName,
        rows: s.rows,
      })),
    }))

    const aiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: quoteAnalysisPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              requestId,
              outputSchema: quoteAnalysisSchema,
              alignedResult: {
                suppliers: aligned.suppliers,
                items: aligned.items,
                codeWarnings: aligned.warnings,
              },
              rawWorkbooks: slimRaw,
            }),
          },
        ],
      }),
      signal: controller.signal,
    })

    const responseText = await aiResponse.text()
    let payload = null
    try {
      payload = JSON.parse(responseText)
    } catch {
      payload = null
    }

    if (!aiResponse.ok) {
      const aiMessage = extractAiErrorMessage(payload, responseText)
      const error = userError(
        `AI API 调用失败：HTTP ${aiResponse.status}${aiMessage ? ` - ${aiMessage}` : ''}`,
        502,
      )
      error.exposeDetail = true
      throw error
    }

    const content = payload.choices?.[0]?.message?.content
    if (!content) {
      throw userError('AI API 已返回，但没有生成可读取的 content 字段。', 502)
    }

    let parsedContent
    try {
      parsedContent = JSON.parse(content)
    } catch {
      throw userError('AI API 返回的内容不是合法 JSON。', 502)
    }

    return {
      summary: normalizeSummary(parsedContent.summary),
      warnings: Array.isArray(parsedContent.warnings) ? parsedContent.warnings : [],
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw userError('AI 叙述生成超时，已返回不含建议的比价结果。', 504)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function normalizeSummary(summary) {
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    return {
      zh: typeof summary.zh === 'string' ? summary.zh : '',
      en: typeof summary.en === 'string' ? summary.en : '',
    }
  }
  if (typeof summary === 'string' && summary.trim()) {
    return { zh: summary, en: summary }
  }
  return { zh: '', en: '' }
}

function extractAiErrorMessage(payload, responseText) {
  const message =
    payload?.error?.message || payload?.message || payload?.msg || payload?.error || responseText
  if (!message) return ''
  return String(message).replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').slice(0, 500)
}

function resolveEndpoint() {
  if (process.env.AI_API_ENDPOINT) return process.env.AI_API_ENDPOINT
  if (process.env.AI_API_BASE_URL) {
    return `${process.env.AI_API_BASE_URL.replace(/\/$/, '')}/chat/completions`
  }
  return 'https://api.deepseek.com/chat/completions'
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
