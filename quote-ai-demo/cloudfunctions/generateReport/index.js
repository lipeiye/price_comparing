const { reportAnalysisPrompt } = require('./prompt')
const { reportSchema } = require('./schema')
const { hashWorkbooks, getByHash, saveReport, REPORT_CACHE_VERSION } = require('./cache')

// 详细分析报告云函数（与 analyzeQuotes 解耦）：
// 输入：alignedResult + rawWorkbooks；按 contentHash 缓存，命中则跳过 AI。
// 全程 deepseek-v4-flash，速度优先。
const MAX_PAYLOAD_CHARS = 1500000
const AI_ATTEMPT_TIMEOUT_MS = 90000
const FUNCTION_VERSION = 'v3-report-cache-hash'

exports.main = async (event = {}) => {
  const requestId = event.requestId || event.requestContext?.requestId || `req_${Date.now()}`

  try {
    if (getRequestMethod(event) === 'OPTIONS') {
      return response(204, {})
    }

    if (isHealthCheck(event)) {
      return response(200, { success: true, pong: true, version: FUNCTION_VERSION, cache: true })
    }

    const payload = parsePayload(event)
    const { alignedResult, rawWorkbooks, contentHash: clientHash } = payload

    if (!alignedResult || !Array.isArray(alignedResult.items) || alignedResult.items.length === 0) {
      throw userError('缺少有效的比价结果（alignedResult.items 为空）。请先完成快速比价。', 400)
    }

    const contentHash =
      (typeof clientHash === 'string' && /^[a-f0-9]{64}$/i.test(clientHash)
        ? clientHash.toLowerCase()
        : null) || (rawWorkbooks.length > 0 ? hashWorkbooks(rawWorkbooks) : null)

    // 服务端已有报告 → 直接返回
    if (contentHash) {
      const cached = await getByHash(contentHash)
      if (isCurrentBilingualReport(cached)) {
        console.log(JSON.stringify({ requestId, message: 'report cache hit', contentHash }))
        return response(200, {
          success: true,
          requestId,
          cacheHit: true,
          contentHash,
          report: cached.report,
          generatedAt: cached.reportGeneratedAt || new Date().toISOString(),
        })
      }
    }

    const report = await callAi(alignedResult, rawWorkbooks, requestId)
    const generatedAt = new Date().toISOString()

    const cacheSaved = contentHash
      ? await saveReport(contentHash, report, generatedAt, REPORT_CACHE_VERSION)
      : false
    if (contentHash && !cacheSaved) {
      console.warn(JSON.stringify({ requestId, message: 'report cache save failed', contentHash }))
    }

    return response(200, {
      success: true,
      requestId,
      cacheHit: false,
      contentHash: contentHash || undefined,
      cacheSaved,
      report,
      generatedAt,
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
    contentHash: payload?.contentHash,
  }
}

async function callAi(alignedResult, rawWorkbooks, requestId) {
  const apiKey = process.env.AI_API_KEY
  // 全程强制 Flash（忽略控制台里可能残留的 AI_REPORT_MODEL=pro）
  const requested = process.env.AI_REPORT_MODEL || process.env.AI_MODEL || 'deepseek-v4-flash'
  const model =
    /pro|reasoner/i.test(String(requested)) ? 'deepseek-v4-flash' : String(requested)
  const endpoint = resolveEndpoint()

  if (!apiKey) {
    throw userError('真实 AI 尚未配置，缺少 AI_API_KEY。', 503)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_ATTEMPT_TIMEOUT_MS)

  // 瘦身原始表：主 sheet 前 60 行，控制 token
  const slimRaw = rawWorkbooks.map((wb) => ({
    filename: wb.filename,
    sheets: (wb.sheets || []).map((s) => ({
      sheetName: s.sheetName,
      rows: (s.rows || []).slice(0, 60),
    })),
  }))

  // 给 AI 的对齐结果也做瘦身：价格字段足够，去掉冗长 costBreakdown 明细以外的噪声
  const slimAligned = {
    suppliers: alignedResult.suppliers,
    codeWarnings: alignedResult.warnings || alignedResult.codeWarnings || [],
    items: (alignedResult.items || []).map((item) => ({
      projectNo: item.projectNo,
      name: item.name,
      lowestSupplierId: item.lowestSupplierId,
      lowestPrice: item.lowestPrice,
      highestPrice: item.highestPrice,
      averagePrice: item.averagePrice,
      quotes: (item.quotes || []).map((q) => ({
        supplierId: q.supplierId,
        matched: q.matched,
        totalPrice: q.totalPrice,
        costBreakdown: q.costBreakdown,
      })),
    })),
  }

  try {
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
          { role: 'system', content: reportAnalysisPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              requestId,
              outputSchema: reportSchema,
              alignedResult: slimAligned,
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
      throw userError('详细报告生成超时，请稍后重试。', 504)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function bilingual(value, fallback = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      zh: typeof value.zh === 'string' ? value.zh : fallback,
      en: typeof value.en === 'string' ? value.en : fallback,
    }
  }
  if (typeof value === 'string') {
    return { zh: value, en: value }
  }
  return { zh: fallback, en: fallback }
}

function isCurrentBilingualReport(doc) {
  const report = doc?.report
  return Boolean(
    doc?.reportCacheVersion === REPORT_CACHE_VERSION &&
      report &&
      typeof report === 'object' &&
      report.verdict &&
      typeof report.verdict.zh === 'string' &&
      report.verdict.en &&
      typeof report.verdict.en === 'string',
  )
}

function normalizeReport(raw) {
  const arr = (v) => (Array.isArray(v) ? v : [])

  // 兼容旧七章结构：尽量映射到新结构，避免缓存/旧响应炸前端
  if (raw?.executiveSummary && !raw?.verdict) {
    return normalizeLegacyReport(raw)
  }

  return {
    verdict: bilingual(raw?.verdict),
    ranking: arr(raw?.ranking)
      .slice(0, 12)
      .map((row, idx) => ({
        rank: Number.isFinite(Number(row?.rank)) ? Number(row.rank) : idx + 1,
        supplier: typeof row?.supplier === 'string' ? row.supplier : '',
        lowestWins: Number.isFinite(Number(row?.lowestWins)) ? Number(row.lowestWins) : null,
        note: bilingual(row?.note),
      })),
    keyGaps: arr(raw?.keyGaps)
      .slice(0, 6)
      .map((row) => ({
        projectNo: typeof row?.projectNo === 'string' ? row.projectNo : '',
        lowest: typeof row?.lowest === 'string' ? row.lowest : '',
        highest: typeof row?.highest === 'string' ? row.highest : '',
        gapPct: Number.isFinite(Number(row?.gapPct)) ? Number(row.gapPct) : null,
        note: bilingual(row?.note),
      })),
    specIssues: arr(raw?.specIssues)
      .slice(0, 8)
      .map((row) => ({
        projectNo: typeof row?.projectNo === 'string' ? row.projectNo : '',
        supplier: typeof row?.supplier === 'string' ? row.supplier : '',
        issue: bilingual(row?.issue),
      })),
    nextSteps: arr(raw?.nextSteps)
      .slice(0, 3)
      .map((step) => bilingual(step)),
    risks: arr(raw?.risks)
      .slice(0, 3)
      .map((risk) => bilingual(risk)),
  }
}

function normalizeLegacyReport(raw) {
  const arr = (v) => (Array.isArray(v) ? v : [])
  const ranking = arr(raw?.priceAnalysis?.overallRanking).map((item, idx) => ({
    rank: item.rank || idx + 1,
    supplier: item.supplier || '',
    lowestWins: null,
    note: bilingual(item.note || item.avgPriceLevel || ''),
  }))
  const specIssues = arr(raw?.specAudit).flatMap((audit) =>
    arr(audit?.findings).map((f) => ({
      projectNo: audit.projectNo || '',
      supplier: f.supplier || '',
      issue: bilingual(
        [f.issue, f.originalSpec ? `原要求：${f.originalSpec}` : ''].filter(Boolean).join('；'),
      ),
    })),
  )
  return {
    verdict: bilingual(raw.executiveSummary),
    ranking,
    keyGaps: arr(raw?.priceAnalysis?.spreadInsights)
      .slice(0, 6)
      .map((s) => ({
        projectNo: '',
        lowest: '',
        highest: '',
        gapPct: null,
        note: bilingual(s),
      })),
    specIssues: specIssues.slice(0, 8),
    nextSteps: raw?.recommendation?.nextSteps
      ? [bilingual(raw.recommendation.nextSteps)]
      : raw?.recommendation?.selection
        ? [bilingual(raw.recommendation.selection)]
        : [],
    risks: arr(raw?.risks).slice(0, 3).map((r) => bilingual(r)),
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
