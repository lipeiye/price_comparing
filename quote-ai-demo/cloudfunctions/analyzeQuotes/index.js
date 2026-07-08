const { quoteAnalysisPrompt } = require('./prompt')
const { quoteAnalysisSchema } = require('./schema')
const { alignQuotes } = require('./align')

// 两段式架构（修复"没有真正比价"的根因）：
// 1. 代码做结构化对齐：按表头文字识别价格列、按项目号跨家对齐、算最低/最高/均价、
//    检测漏报、量级异常、模具费。比价表永不为空，不依赖 AI。
// 2. AI 只做叙述：中文采购建议 + 检测"供应商擅自改规格"。AI 超时/失败时，比价报告照常返回。
const MIN_WORKBOOKS = 2
const MAX_WORKBOOKS = 3
const MAX_PAYLOAD_CHARS = 1200000

// AI 调用预算：结构化对齐由代码秒级完成，AI 叙述可使用全部剩余预算。
// 全局截止线必须小于 CloudBase 函数执行超时（当前 200s），留足返回与网关开销。
const OVERALL_DEADLINE_MS = 185000
const AI_ATTEMPT_TIMEOUT_MS = 175000

// 部署版本标记：健康检查返回，用于秒级确认线上跑的是哪一版代码
const FUNCTION_VERSION = 'v4-align-engine-185s'

exports.main = async (event = {}) => {
  const requestId = event.requestId || event.requestContext?.requestId || `req_${Date.now()}`

  try {
    if (getRequestMethod(event) === 'OPTIONS') {
      return response(204, {})
    }

    if (isHealthCheck(event)) {
      return response(200, { success: true, pong: true, version: FUNCTION_VERSION })
    }

    const workbooks = parseWorkbooks(event)

    // 第一段：代码对齐——比价表永不为空的核心保证
    const aligned = alignQuotes(workbooks)

    if (aligned.items.length === 0) {
      throw userError(
        '未能从这些报价单中识别出任何项目。请确认每份表都包含「LZ Project No」列和「Total price」列，且有数据行。',
        400,
      )
    }

    // 第二段：AI 叙述。失败不阻断，比价报告照常返回（缺 summary 和补充异常）。
    const deadlineAt = Date.now() + OVERALL_DEADLINE_MS
    let aiNarrative = { summary: '', warnings: [] }
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
        summary: 'AI 采购建议生成失败，以下为系统自动比价结果。最低价已逐项标出，请据此判断。',
        warnings: [],
      }
    }

    // 合并：代码检测的异常 + AI 补充的异常
    const mergedWarnings = [...aligned.warnings, ...aiNarrative.warnings]

    return response(200, {
      success: true,
      requestId,
      suppliers: aligned.suppliers,
      items: aligned.items,
      warnings: mergedWarnings,
      summary: aiNarrative.summary,
    })
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

function parseWorkbooks(event) {
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
    payload = JSON.parse(bodyText)
  } catch {
    const error = userError(`请求体不是合法 JSON。当前 content-type: ${contentType || '空'}`, 400)
    error.exposeDetail = true
    throw error
  }

  const workbooks = payload?.workbooks
  if (!Array.isArray(workbooks) || workbooks.length < MIN_WORKBOOKS) {
    throw userError('请至少上传 2 份供应商 Excel 报价单。', 400)
  }
  if (workbooks.length > MAX_WORKBOOKS) {
    throw userError('最多只能上传 3 份供应商 Excel 报价单。', 400)
  }

  return workbooks.map(sanitizeWorkbook)
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
    // 给 AI 的输入：对齐后的结构化结果 + 一份精简的原始表格（用于规格篡改检测）
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
      summary: typeof parsedContent.summary === 'string' ? parsedContent.summary : '',
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
