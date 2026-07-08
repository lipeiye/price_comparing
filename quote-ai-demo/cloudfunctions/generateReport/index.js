const { reportAnalysisPrompt } = require('./prompt')
const { reportSchema } = require('./schema')

// 详细分析报告云函数（与 analyzeQuotes 解耦）：
// 输入：前端已算好的 alignedResult（比价结果）+ rawWorkbooks（原始表格）。
// 输出：深度 Analytical Report（执行摘要/价格分析/规格核对/成本拆解/模具/建议/风险）。
// 默认使用 deepseek-v4-pro（强推理），通过 AI_REPORT_MODEL 环境变量配置。
const MAX_PAYLOAD_CHARS = 1500000

// v4-pro 默认开启思考模式，耗时更长，预留更充裕预算。
// 必须小于云函数执行超时（建议控制台设为 300 秒）。
const AI_ATTEMPT_TIMEOUT_MS = 270000

const FUNCTION_VERSION = 'v1-report-pro'

exports.main = async (event = {}) => {
  const requestId = event.requestId || event.requestContext?.requestId || `req_${Date.now()}`

  try {
    if (getRequestMethod(event) === 'OPTIONS') {
      return response(204, {})
    }

    if (isHealthCheck(event)) {
      return response(200, { success: true, pong: true, version: FUNCTION_VERSION })
    }

    const payload = parsePayload(event)
    const { alignedResult, rawWorkbooks } = payload

    if (!alignedResult || !Array.isArray(alignedResult.items) || alignedResult.items.length === 0) {
      throw userError('缺少有效的比价结果（alignedResult.items 为空）。请先完成快速比价。', 400)
    }

    const report = await callAi(alignedResult, rawWorkbooks, requestId)

    return response(200, {
      success: true,
      requestId,
      report,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error(
      JSON.stringify({ requestId, message: error.message, code: error.code, stack: error.stack }),
    )
    return response(error.statusCode || 500, {
      success: false,
      requestId,
      message: error.userMessage || '详细报告生成失败，请稍后重试。',
      detail: error.exposeDetail ? error.message : undefined,
    })
  }
}

function parsePayload(event) {
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || ''
  const bodyText = getRequestBodyText(event)
  if (bodyText.length > MAX_PAYLOAD_CHARS) {
    throw userError('上传的数据过大，无法生成详细报告。', 413)
  }

  let payload
  try {
    payload = JSON.parse(bodyText)
  } catch {
    const error = userError(`请求体不是合法 JSON。content-type: ${contentType || '空'}`, 400)
    error.exposeDetail = true
    throw error
  }

  return {
    alignedResult: payload?.alignedResult,
    rawWorkbooks: Array.isArray(payload?.rawWorkbooks) ? payload.rawWorkbooks : [],
  }
}

async function callAi(alignedResult, rawWorkbooks, requestId) {
  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_REPORT_MODEL || 'deepseek-v4-pro'
  const endpoint = resolveEndpoint()

  if (!apiKey) {
    throw userError('真实 AI 尚未配置，缺少 AI_API_KEY。', 503)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_ATTEMPT_TIMEOUT_MS)

  // 给 AI 的原始表格做瘦身：只保留报价主 sheet 的前 60 行，控制 token
  const slimRaw = rawWorkbooks.map((wb) => ({
    filename: wb.filename,
    sheets: (wb.sheets || []).map((s) => ({
      sheetName: s.sheetName,
      rows: (s.rows || []).slice(0, 60),
    })),
  }))

  try {
    const aiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        // v4-pro 思考模式下 temperature 会被忽略，但保留 json_object 约束输出格式
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: reportAnalysisPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              requestId,
              outputSchema: reportSchema,
              alignedResult,
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
      throw userError('AI 已返回，但没有生成可读取的 content 字段。', 502)
    }

    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      throw userError('AI 返回的内容不是合法 JSON。', 502)
    }

    return normalizeReport(parsed)
  } catch (error) {
    if (error.name === 'AbortError') {
      throw userError('详细报告生成超时（推理模型耗时较长），请稍后重试。', 504)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// 容错归一化：AI 偶尔会漏字段或字段类型不对，保证前端拿到稳定结构
function normalizeReport(raw) {
  const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback)
  const arr = (v) => (Array.isArray(v) ? v : [])
  return {
    executiveSummary: str(raw?.executiveSummary),
    priceAnalysis: {
      overallRanking: arr(raw?.priceAnalysis?.overallRanking),
      spreadInsights: arr(raw?.priceAnalysis?.spreadInsights),
      costPerformance: str(raw?.priceAnalysis?.costPerformance),
    },
    specAudit: arr(raw?.specAudit),
    costBreakdown: str(raw?.costBreakdown),
    toolingAnalysis: str(raw?.toolingAnalysis),
    recommendation: {
      selection: str(raw?.recommendation?.selection),
      negotiation: arr(raw?.recommendation?.negotiation),
      nextSteps: str(raw?.recommendation?.nextSteps),
    },
    risks: arr(raw?.risks),
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
