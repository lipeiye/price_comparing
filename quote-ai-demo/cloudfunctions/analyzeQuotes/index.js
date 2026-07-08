const Busboy = require('busboy')
const readXlsxFile = require('read-excel-file/node')
const { quoteAnalysisPrompt } = require('./prompt')
const { quoteAnalysisSchema } = require('./schema')

const MAX_FILES = 3
const MIN_FILES = 2
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['xlsx'])

exports.main = async (event = {}) => {
  const requestId = event.requestId || event.requestContext?.requestId || `req_${Date.now()}`

  try {
    if (getRequestMethod(event) === 'OPTIONS') {
      return response(204, {})
    }

    const files = await parseIncomingFiles(event)
    validateFiles(files)

    const workbooks = await Promise.all(
      files.map(async (file) => ({
        filename: file.filename,
        sheets: await extractWorkbookTables(file.buffer),
      })),
    )

    const aiResult = await callAi(workbooks, requestId)

    return response(200, {
      success: true,
      requestId,
      ...aiResult,
    })
  } catch (error) {
    console.error(JSON.stringify({ requestId, message: error.message, code: error.code }))
    return response(error.statusCode || 500, {
      success: false,
      requestId,
      message: error.userMessage || 'Excel 报价单分析失败，请检查文件格式后重试。',
    })
  }
}

function validateFiles(files) {
  if (files.length < MIN_FILES) {
    throw userError('请至少上传 2 份供应商 Excel 报价单。', 400)
  }

  if (files.length > MAX_FILES) {
    throw userError('最多只能上传 3 份供应商 Excel 报价单。', 400)
  }

  for (const file of files) {
    const extension = file.filename.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw userError(`${file.filename} 不是 XLSX Excel 文件。`, 400)
    }

    if (file.buffer.length > MAX_FILE_SIZE) {
      throw userError(`${file.filename} 超过 10 MB。`, 400)
    }
  }
}

async function extractWorkbookTables(buffer) {
  const parsed = await readXlsxFile(buffer)
  const sheets = Array.isArray(parsed[0]?.data)
    ? parsed
    : [{ sheet: 'Sheet1', data: parsed }]

  return sheets.slice(0, 5).map((sheet) => ({
    sheetName: sheet.sheet || 'Sheet1',
    rows: sheet.data
      .slice(0, 80)
      .map((row) => row.slice(0, 18).map(normalizeCellValue)),
  }))
}

function normalizeCellValue(value) {
  if (value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object' && value !== null) {
    if ('result' in value) return normalizeCellValue(value.result)
    if ('text' in value) return value.text
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    return JSON.stringify(value)
  }
  return value
}

async function callAi(workbooks, requestId) {
  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_MODEL || 'kimi-k2.7-code'
  const endpoint = resolveEndpoint()

  if (!apiKey) {
    throw userError('真实 AI 尚未配置，缺少 AI_API_KEY。', 503)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)

  try {
    const aiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: quoteAnalysisPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              requestId,
              outputSchema: quoteAnalysisSchema,
              workbooks,
            }),
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!aiResponse.ok) {
      throw new Error(`AI HTTP ${aiResponse.status}`)
    }

    const payload = await aiResponse.json()
    const content = payload.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('AI response has no content')
    }

    return JSON.parse(content)
  } finally {
    clearTimeout(timer)
  }
}

function resolveEndpoint() {
  if (process.env.AI_API_ENDPOINT) return process.env.AI_API_ENDPOINT
  if (process.env.AI_API_BASE_URL) {
    return `${process.env.AI_API_BASE_URL.replace(/\/$/, '')}/chat/completions`
  }
  return 'https://api.moonshot.ai/v1/chat/completions'
}

function getRequestMethod(event) {
  return event.httpMethod || event.requestContext?.http?.method || event.requestContext?.method || ''
}

async function parseIncomingFiles(event) {
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || ''
  const body = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8')

  if (contentType.includes('multipart/form-data')) {
    return parseMultipart(body, contentType)
  }

  if (event.files) {
    return event.files.map((file) => ({
      filename: file.filename || file.name,
      buffer: Buffer.from(file.content || file.body, file.base64 ? 'base64' : 'utf8'),
    }))
  }

  throw userError('请使用 multipart/form-data 上传 Excel 文件。', 400)
}

function parseMultipart(body, contentType) {
  return new Promise((resolve, reject) => {
    const files = []
    const busboy = Busboy({ headers: { 'content-type': contentType } })

    busboy.on('file', (_fieldName, stream, info) => {
      const chunks = []
      let size = 0

      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_FILE_SIZE) {
          stream.resume()
          reject(userError(`${info.filename} 超过 10 MB。`, 400))
          return
        }
        chunks.push(chunk)
      })

      stream.on('end', () => {
        files.push({
          filename: info.filename,
          mimeType: info.mimeType,
          buffer: Buffer.concat(chunks),
        })
      })
    })

    busboy.on('error', reject)
    busboy.on('finish', () => resolve(files))
    busboy.end(body)
  })
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
