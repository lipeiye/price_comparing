const Busboy = require('busboy')
const readXlsxFile = require('read-excel-file/node')
const { quoteAnalysisPrompt } = require('./prompt')
const { quoteAnalysisSchema } = require('./schema')

const MAX_FILES = 3
const MIN_FILES = 2
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_SHEETS = 2
const MAX_ROWS_PER_SHEET = 80
const MAX_COLUMNS_PER_SHEET = 45
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
    console.error(JSON.stringify({ requestId, message: error.message, code: error.code, stack: error.stack }))
    return response(error.statusCode || 500, {
      success: false,
      requestId,
      message: error.userMessage || 'Excel 报价单分析失败，请检查文件格式后重试。',
      detail: error.exposeDetail ? error.message : undefined,
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

  return sheets
    .map(normalizeSheet)
    .filter((sheet) => sheet.nonEmptyRows >= 2 && sheet.nonEmptyColumns >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SHEETS)
    .map((sheet) => ({
      sheetName: sheet.sheetName,
      columns: sheet.columns,
      rows: sheet.rows,
    }))
}

function normalizeSheet(sheet) {
  const data = Array.isArray(sheet.data) ? sheet.data : []
  const columnIndexes = getRelevantColumnIndexes(data)
  const rows = data
    .filter(hasMeaningfulCells)
    .slice(0, MAX_ROWS_PER_SHEET)
    .map((row) => columnIndexes.map((index) => normalizeCellValue(row[index])))

  return {
    sheetName: sheet.sheet || 'Sheet1',
    columns: columnIndexes.map(getColumnName),
    rows,
    nonEmptyRows: rows.length,
    nonEmptyColumns: columnIndexes.length,
    score: rows.length * columnIndexes.length,
  }
}

function getColumnName(index) {
  let column = ''
  let cursor = index + 1

  while (cursor > 0) {
    const remainder = (cursor - 1) % 26
    column = String.fromCharCode(65 + remainder) + column
    cursor = Math.floor((cursor - 1) / 26)
  }

  return column
}

function getRelevantColumnIndexes(rows) {
  const counts = new Map()

  rows.forEach((row) => {
    row.forEach((cell, index) => {
      if (isMeaningfulCell(cell)) {
        counts.set(index, (counts.get(index) || 0) + 1)
      }
    })
  })

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_COLUMNS_PER_SHEET)
    .map(([index]) => index)
    .sort((a, b) => a - b)
}

function hasMeaningfulCells(row) {
  return row.some(isMeaningfulCell)
}

function isMeaningfulCell(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
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
  const model = process.env.AI_MODEL || 'deepseek-v4-flash'
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

    const responseText = await aiResponse.text()
    let payload = null
    try {
      payload = JSON.parse(responseText)
    } catch {
      payload = null
    }

    if (!aiResponse.ok) {
      const aiMessage = extractAiErrorMessage(payload, responseText)
      const error = userError(`AI API 调用失败：HTTP ${aiResponse.status}${aiMessage ? ` - ${aiMessage}` : ''}`, 502)
      error.exposeDetail = true
      throw error
    }

    const content = payload.choices?.[0]?.message?.content
    if (!content) {
      const error = userError('AI API 已返回，但没有生成可读取的 content 字段。', 502)
      error.exposeDetail = true
      throw error
    }

    try {
      return JSON.parse(content)
    } catch {
      const error = userError('AI API 返回的内容不是合法 JSON，请稍后重试或调整提示词。', 502)
      error.exposeDetail = true
      throw error
    }
  } finally {
    clearTimeout(timer)
  }
}

function extractAiErrorMessage(payload, responseText) {
  const message =
    payload?.error?.message ||
    payload?.message ||
    payload?.msg ||
    payload?.error ||
    responseText

  if (!message) return ''
  return String(message)
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .slice(0, 500)
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

async function parseIncomingFiles(event) {
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || ''

  if (contentType.includes('multipart/form-data')) {
    const body = getRequestBodyBuffer(event)
    return parseMultipart(body, contentType)
  }

  if (event.files) {
    return event.files.map((file) => ({
      filename: file.filename || file.name,
      buffer: Buffer.from(file.content || file.body, file.base64 ? 'base64' : 'utf8'),
    }))
  }

  const error = userError(
    `请使用 multipart/form-data 上传 Excel 文件。当前 content-type: ${contentType || '空'}`,
    400,
  )
  error.exposeDetail = true
  throw error
}

function getRequestBodyBuffer(event) {
  const body = event.rawBody || event.body || ''

  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (typeof body === 'object') return Buffer.from(JSON.stringify(body), 'utf8')

  return Buffer.from(body, event.isBase64Encoded ? 'base64' : 'utf8')
}

function parseMultipart(body, contentType) {
  return new Promise((resolve, reject) => {
    const files = []
    const busboy = Busboy({ headers: { 'content-type': contentType } })

    busboy.on('file', (_fieldName, stream, info) => {
      const chunks = []
      let size = 0
      let sizeRejected = false

      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_FILE_SIZE) {
          sizeRejected = true
          stream.resume()
          return
        }
        chunks.push(chunk)
      })

      stream.on('end', () => {
        if (sizeRejected) {
          reject(userError(`${info.filename} 超过 10 MB。`, 400))
          return
        }

        files.push({
          filename: info.filename,
          mimeType: info.mimeType,
          buffer: Buffer.concat(chunks),
        })
      })
    })

    busboy.on('error', reject)
    busboy.on('finish', () => {
      if (files.length === 0) {
        const error = userError('没有从 multipart/form-data 中读取到 Excel 文件。', 400)
        error.exposeDetail = true
        reject(error)
        return
      }

      resolve(files)
    })
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
