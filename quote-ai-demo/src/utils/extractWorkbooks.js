import readXlsxFile from 'read-excel-file/browser'

// 浏览器端 Excel 解析与瘦身：只上传表格数据（几十 KB），不上传含图片的原始文件。
//
// 关键修正（修复"没有真正比价"的根因）：
// 旧版按"列填充率"砍列，会把只对部分商品有值的成本列（Driver/LED/Controller 等填充率较低）
// 误删，导致后端 AI 根本看不到这些价格。新版策略：
//   1. 保留全部工作表（含 Tooling Overview 模具费表），不再只取前 2 个 sheet。
//   2. 保留全部有数据的列（不再按填充率排序截断），只裁掉完全空的列和行。
// 价格列的识别、对齐、计算全部由后端代码按表头文字完成，前端只负责如实搬运数据。
const MAX_SHEETS = 5
const MAX_ROWS_PER_SHEET = 120
// 真实报价模板有 86 列；认证和包装信息位于第 60 列之后，必须保留给规则化规格核验。
// 90 仍远低于上传图片原文件的量级，不会拖慢浏览器端解析。
const MAX_COLUMNS_PER_SHEET = 90

export async function extractWorkbook(file, filename) {
  let parsed
  try {
    parsed = await readXlsxFile(file)
  } catch {
    throw new Error(`${filename} 无法解析，请确认是有效的 XLSX 文件。`)
  }

  const sheets = parsed
    .map(normalizeSheet)
    .filter((sheet) => sheet.rows.length >= 2 && sheet.columns.length >= 2)
    .slice(0, MAX_SHEETS)
    .map((sheet) => ({
      sheetName: sheet.sheetName,
      columns: sheet.columns,
      rows: sheet.rows,
    }))

  if (sheets.length === 0) {
    throw new Error(`${filename} 里没有读到可分析的表格数据（至少需要 2 行 × 2 列）。`)
  }

  return { filename, sheets }
}

function normalizeSheet(sheet) {
  const data = Array.isArray(sheet.data) ? sheet.data : []

  // 保留所有"至少有一个非空单元格"的列，保持原始列顺序——不再按填充率排序。
  // 这样 Driver/LED 等只对部分行有值的成本列不会被丢弃。
  const columnIndexes = collectRelevantColumnIndexes(data)
  const rows = data
    .filter(hasMeaningfulCells)
    .slice(0, MAX_ROWS_PER_SHEET)
    .map((row) => columnIndexes.map((index) => normalizeCellValue(row[index])))

  return {
    sheetName: sheet.sheet || 'Sheet1',
    columns: columnIndexes.map(getColumnName),
    rows,
  }
}

function collectRelevantColumnIndexes(rows) {
  const present = new Set()
  rows.forEach((row) => {
    if (!Array.isArray(row)) return
    row.forEach((cell, index) => {
      if (isMeaningfulCell(cell)) present.add(index)
    })
  })
  return Array.from(present).sort((a, b) => a - b).slice(0, MAX_COLUMNS_PER_SHEET)
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

function hasMeaningfulCells(row) {
  return Array.isArray(row) && row.some(isMeaningfulCell)
}

function isMeaningfulCell(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('result' in value) return normalizeCellValue(value.result)
    if ('text' in value) return value.text
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  return value
}
