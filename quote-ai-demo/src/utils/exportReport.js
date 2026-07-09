import { saveAs } from 'file-saver'
import { asBilingual } from './bilingual.js'

// 导出 Excel 兼容文件（SpreadsheetML .xls，Excel / WPS 均可打开，零额外依赖）
export function exportReportToExcel(report, suppliers, items, procurementSummary) {
  const r = report || {}
  const sheets = [
    buildDecisionSheet(r, suppliers, procurementSummary),
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
export async function exportReportToDocx(report, suppliers, items, procurementSummary) {
  exportReportToExcel(report, suppliers, items, procurementSummary)
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

function buildDecisionSheet(r, suppliers = [], procurementSummary) {
  const totals = procurementSummary?.supplierTotals || []
  const totalItems = procurementSummary?.totalItems || 0
  const supplierName = (supplierId) =>
    suppliers.find((supplier) => supplier.id === supplierId)?.name || supplierId || '—'
  const orderLeader = supplierName(procurementSummary?.orderLeaderSupplierId)
  const priceLeader = supplierName(procurementSummary?.priceLeaderSupplierId)
  const rows = [
    ['快速采购结论 / Quick procurement decision', ''],
    ['按首单已知总额领先 / Lowest known first-order total', orderLeader],
    ['按最低 EXW 单价领先 / Most lowest unit-price wins', priceLeader],
    ['相对第二名已知节省 / Known saving vs. runner-up', procurementSummary?.knownOrderSavings ?? '—'],
    [],
    ['供应商 / Supplier', '已报价项目 / Quoted items', '缺报 / Missing', '已知数量项目 / Rows with quantity', '已知首单金额 RMB / Known first-order amount', '模具费 RMB / Tooling', '已知合计 RMB / Known total'],
    ...totals.map((total) => [
      supplierName(total.supplierId),
      totalItems ? `${total.quotedItems}/${totalItems}` : total.quotedItems,
      total.missingItems,
      total.knownAmountItems,
      total.knownFirstOrderAmount,
      total.toolingTotal,
      total.knownFirstOrderTotal,
    ]),
    [],
    ['说明 / Note', '“已知合计”只计算同时有 EXW 单价和首单数量的项目；请先处理漏报和规格不一致。 / “Known total” includes only rows with both EXW unit price and first-order quantity. Resolve missing quotes and specification differences first.'],
  ]
  return worksheet('决策速览 Decision', rows)
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
    '首单数量 First-order qty',
    ...suppliers.flatMap((s) => [`${s.name} 单价 Unit EXW (RMB)`, `${s.name} 首单金额 First-order amount (RMB)`]),
    '最低 Lowest',
  ]
  const rows = [header]
  for (const item of items) {
    const lowestName = suppliers.find((s) => s.id === item.lowestSupplierId)?.name || ''
    rows.push([
      item.projectNo || '',
      item.name || '',
      firstKnownQuantity(item),
      ...suppliers.flatMap((s) => {
        const q = item.quotes?.find((x) => x.supplierId === s.id)
        if (!q?.matched || q.totalPrice == null) return ['漏报 / Not quoted', '—']
        return [q.totalPrice, q.firstOrderAmount ?? '数量缺失 / Qty missing']
      }),
      lowestName,
    ])
  }
  if (rows.length === 1) rows.push(['—', '—', '—', ...suppliers.flatMap(() => ['—', '—']), '—'])
  return worksheet('比价矩阵 Matrix', rows)
}

function firstKnownQuantity(item) {
  const quote = (item.quotes || []).find((entry) => entry?.firstOrderQuantity != null)
  return quote?.firstOrderQuantity ?? '—'
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
