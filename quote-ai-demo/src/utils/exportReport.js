import { saveAs } from 'file-saver'
import { formatPrice } from './formatters.js'
import { asBilingual } from './bilingual.js'

// 导出 Excel 兼容文件（SpreadsheetML .xls，Excel / WPS 均可打开，零额外依赖）
export function exportReportToExcel(report, suppliers, items) {
  const r = report || {}
  const sheets = [
    buildVerdictSheet(r),
    buildRankingSheet(r),
    buildMatrixSheet(suppliers, items),
    buildGapsSheet(r),
    buildSpecSheet(r),
    buildActionsSheet(r),
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${sheets.join('\n')}
</Workbook>`

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
  saveAs(blob, `报价比价报告_${dateStamp()}.xls`)
}

// 保留旧 Word 导出入口（若他处引用）；改为简表
export async function exportReportToDocx(report, suppliers, items) {
  exportReportToExcel(report, suppliers, items)
}

export function exportReportToPDF() {
  window.print()
}

function buildVerdictSheet(r) {
  const v = asBilingual(r.verdict)
  return worksheet('结论 Verdict', [
    ['字段 / Field', '中文 ZH', 'English EN'],
    ['结论 Verdict', v.zh, v.en],
  ])
}

function buildRankingSheet(r) {
  const rows = [['#', '供应商 Supplier', '最低价项数 Wins', '备注 ZH', 'Note EN']]
  for (const row of r.ranking || []) {
    const note = asBilingual(row.note)
    rows.push([
      row.rank ?? '',
      row.supplier || '',
      row.lowestWins ?? '',
      note.zh,
      note.en,
    ])
  }
  if (rows.length === 1) rows.push(['—', '—', '—', '—', '—'])
  return worksheet('排名 Ranking', rows)
}

function buildMatrixSheet(suppliers = [], items = []) {
  const header = [
    '项目号 Project',
    '类型 Type',
    ...suppliers.map((s) => s.name),
    '最低 Lowest',
  ]
  const rows = [header]
  for (const item of items) {
    const lowestName = suppliers.find((s) => s.id === item.lowestSupplierId)?.name || ''
    rows.push([
      item.projectNo || '',
      item.name || '',
      ...suppliers.map((s) => {
        const q = item.quotes?.find((x) => x.supplierId === s.id)
        if (!q?.matched || q.totalPrice == null) return '漏报'
        return formatPrice(q.totalPrice)
      }),
      lowestName,
    ])
  }
  if (rows.length === 1) rows.push(['—', '—', ...suppliers.map(() => '—'), '—'])
  return worksheet('比价矩阵 Matrix', rows)
}

function buildGapsSheet(r) {
  const rows = [['项目号', '最低', '最高', '价差%', '备注 ZH', 'Note EN']]
  for (const row of r.keyGaps || []) {
    const note = asBilingual(row.note)
    rows.push([
      row.projectNo || '',
      row.lowest || '',
      row.highest || '',
      row.gapPct != null ? `${row.gapPct}%` : '',
      note.zh,
      note.en,
    ])
  }
  if (rows.length === 1) rows.push(['—', '—', '—', '—', '—', '—'])
  return worksheet('关键价差 Gaps', rows)
}

function buildSpecSheet(r) {
  const rows = [['项目号', '供应商', '问题 ZH', 'Issue EN']]
  for (const row of r.specIssues || []) {
    const issue = asBilingual(row.issue)
    rows.push([row.projectNo || '', row.supplier || '', issue.zh, issue.en])
  }
  if (rows.length === 1) rows.push(['—', '—', '—', '—'])
  return worksheet('规格问题 Spec', rows)
}

function buildActionsSheet(r) {
  const rows = [['类型 Type', '中文 ZH', 'English EN']]
  for (const step of r.nextSteps || []) {
    const t = asBilingual(step)
    rows.push(['下一步 Next', t.zh, t.en])
  }
  for (const risk of r.risks || []) {
    const t = asBilingual(risk)
    rows.push(['风险 Risk', t.zh, t.en])
  }
  if (rows.length === 1) rows.push(['—', '—', '—'])
  return worksheet('行动与风险 Actions', rows)
}

function worksheet(name, rows) {
  const safeName = String(name).replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31)
  const xmlRows = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const text = escapeXml(cell == null ? '' : String(cell))
          const isNum = typeof cell === 'number' || (typeof cell === 'string' && /^-?\d+(\.\d+)?$/.test(cell))
          if (isNum && cell !== '') {
            return `<Cell><Data ss:Type="Number">${escapeXml(String(cell))}</Data></Cell>`
          }
          return `<Cell><Data ss:Type="String">${text}</Data></Cell>`
        })
        .join('')
      return `<Row>${cells}</Row>`
    })
    .join('')
  return `<Worksheet ss:Name="${escapeXml(safeName)}"><Table>${xmlRows}</Table></Worksheet>`
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function dateStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
