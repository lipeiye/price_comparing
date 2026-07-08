import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
} from 'docx'
import { saveAs } from 'file-saver'
import { formatPrice } from './formatters.js'

// 导出为 Word（.docx）：用 docx 库在浏览器端组装文档并触发下载。
// 妈妈可在 Word 里二次编辑、加公司章、另存为 PDF。
export async function exportReportToDocx(report, suppliers, items) {
  const r = report || {}
  const children = []

  // 标题
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '供应商报价比价分析报告', bold: true })],
    }),
  )
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `生成时间：${nowText()}`, color: '666666', size: 20 })],
      spacing: { after: 300 },
    }),
  )

  // 执行摘要
  pushHeading(children, '一、执行摘要')
  pushPara(children, r.executiveSummary)

  // 价格分析
  if (r.priceAnalysis) {
    pushHeading(children, '二、价格分析')
    if (r.priceAnalysis.overallRanking?.length) {
      pushPara(children, '供应商整体排名：')
      r.priceAnalysis.overallRanking.forEach((item) => {
        pushPara(
          children,
          `  第 ${item.rank || ''} 名 ${item.supplier}：${item.avgPriceLevel || ''}${item.note ? '（' + item.note + '）' : ''}`,
          false,
        )
      })
    }
    r.priceAnalysis.spreadInsights?.forEach((s) => pushPara(children, `• ${s}`, false))
    if (r.priceAnalysis.costPerformance) pushPara(children, r.priceAnalysis.costPerformance)
  }

  // 规格核对
  if (r.specAudit?.length) {
    pushHeading(children, '三、规格逐项核对')
    r.specAudit.forEach((audit) => {
      pushPara(children, `【${audit.projectNo}】`, false)
      ;(audit.findings || []).forEach((f) => {
        pushPara(
          children,
          `  ${f.supplier || ''}：${f.issue}${f.originalSpec ? '（原要求：' + f.originalSpec + '）' : ''}${f.impact ? '。影响：' + f.impact : ''}`,
          false,
        )
      })
    })
  }

  if (r.costBreakdown) {
    pushHeading(children, '四、成本拆解分析')
    pushPara(children, r.costBreakdown)
  }

  if (r.toolingAnalysis) {
    pushHeading(children, '五、模具费分析')
    pushPara(children, r.toolingAnalysis)
  }

  // 建议与风险
  if (r.recommendation) {
    pushHeading(children, '六、谈判与选型建议')
    if (r.recommendation.selection) pushPara(children, `选型：${r.recommendation.selection}`)
    if (r.recommendation.negotiation?.length) {
      pushPara(children, '谈判筹码：')
      r.recommendation.negotiation.forEach((n) => pushPara(children, `• ${n}`, false))
    }
    if (r.recommendation.nextSteps) pushPara(children, `下一步：${r.recommendation.nextSteps}`)
  }

  if (r.risks?.length) {
    pushHeading(children, '七、风险提示')
    r.risks.forEach((risk) => pushPara(children, `• ${risk}`, false))
  }

  // 附：比价明细表
  if (items?.length) {
    pushHeading(children, '附：报价比价明细表')
    children.push(buildComparisonTable(suppliers, items))
  }

  const doc = new Document({ sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, `报价比价分析报告_${dateStamp()}.docx`)
}

// 导出为 PDF：调用浏览器打印对话框（零依赖，中文无障碍）。
// 配合 index.css 的 @media print 样式，只打印 .printable 区域。
export function exportReportToPDF() {
  window.print()
}

// 构建比价明细 Word 表格
function buildComparisonTable(suppliers, items) {
  const headerCells = [
    cellText('项目号'),
    cellText('类型'),
    ...suppliers.map((s) => cellText(s.name)),
    cellText('最低'),
  ]

  const rows = items.slice(0, 50).map((item) => {
    const lowestName = suppliers.find((s) => s.id === item.lowestSupplierId)?.name || ''
    return new TableRow({
      children: [
        cellText(item.projectNo),
        cellText(item.name),
        ...suppliers.map((s) => {
          const q = item.quotes.find((x) => x.supplierId === s.id)
          return cellText(q?.matched && q.totalPrice != null ? formatPrice(q.totalPrice) : '漏报')
        }),
        cellText(lowestName),
      ],
    })
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: headerCells, tableHeader: true }), ...rows],
  })
}

function cellText(text) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), size: 18 })] })],
  })
}

function pushHeading(children, text) {
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text, bold: true, size: 28 })],
    }),
  )
}

function pushPara(children, text, indent = true) {
  if (!text) return
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      indent: indent ? { left: 0 } : undefined,
      children: [new TextRun({ text, size: 22 })],
    }),
  )
}

function nowText() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function dateStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
