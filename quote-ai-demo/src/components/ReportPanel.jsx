import { FileText, FileType, AlertTriangle, Target, Scale, Wrench, Lightbulb } from 'lucide-react'
import { formatPrice } from '../utils/formatters.js'

// 动态导入导出模块：docx 库较大（~400KB），仅在用户点击导出时才加载，不拖慢首屏
async function getExporters() {
  return import('../utils/exportReport.js')
}

// 详细分析报告展示面板。展开在快速比价结果下方。
// 报告由更强的 AI 模型（默认 deepseek-v4-pro，思考模式）生成，包含多维分析章节。
function ReportPanel({ report, suppliers, items, generatedAt }) {
  const r = report
  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || ''

  const handleExportWord = async () => {
    const { exportReportToDocx } = await getExporters()
    exportReportToDocx(r, suppliers, items)
  }

  return (
    <div className="report-panel printable">
      <div className="report-head no-print">
        <div className="report-head-left">
          <p className="eyebrow">详细分析报告</p>
          <h2>Analytical Report</h2>
          {generatedAt ? (
            <p className="report-meta">生成于 {formatDateTime(generatedAt)}</p>
          ) : null}
        </div>
        <div className="report-export" data-onboarding="export-buttons">
          <button type="button" className="ghost-button report-export-btn" onClick={handleExportWord}>
            <FileText size={16} />
            导出 Word
          </button>
          <button
            type="button"
            className="ghost-button report-export-btn"
            onClick={async () => {
              const { exportReportToPDF } = await getExporters()
              exportReportToPDF()
            }}
          >
            <FileType size={16} />
            导出 PDF
          </button>
        </div>
      </div>

      <div className="report-body">
        {r.executiveSummary ? (
          <ReportSection icon={<Target size={16} />} title="执行摘要">
            <p>{r.executiveSummary}</p>
          </ReportSection>
        ) : null}

        {r.priceAnalysis ? (
          <ReportSection icon={<Scale size={16} />} title="价格分析">
            {r.priceAnalysis.overallRanking?.length > 0 ? (
              <div className="report-ranking">
                {r.priceAnalysis.overallRanking.map((item, idx) => (
                  <div key={idx} className="ranking-item">
                    <span className="ranking-no">第 {item.rank || idx + 1} 名</span>
                    <strong>{item.supplier}</strong>
                    {item.avgPriceLevel ? <span className="ranking-level">{item.avgPriceLevel}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {r.priceAnalysis.spreadInsights?.map((insight, idx) => (
              <p key={idx} className="report-bullet">• {insight}</p>
            ))}
            {r.priceAnalysis.costPerformance ? (
              <p className="report-subnote">{r.priceAnalysis.costPerformance}</p>
            ) : null}
          </ReportSection>
        ) : null}

        {r.specAudit?.length > 0 ? (
          <ReportSection icon={<AlertTriangle size={16} />} title="规格逐项核对" accent="warn">
            {r.specAudit.map((audit, idx) => (
              <div key={idx} className="spec-audit-item">
                <div className="spec-audit-project">{audit.projectNo}</div>
                {(audit.findings || []).map((f, j) => (
                  <div key={j} className="spec-finding">
                    <span className="spec-supplier">{f.supplier || supplierName(f.supplierId)}</span>
                    <span className="spec-issue">{f.issue}</span>
                    {f.originalSpec ? (
                      <span className="spec-orig">原要求：{f.originalSpec}</span>
                    ) : null}
                    {f.impact ? <span className="spec-impact">影响：{f.impact}</span> : null}
                  </div>
                ))}
              </div>
            ))}
          </ReportSection>
        ) : null}

        {r.costBreakdown ? (
          <ReportSection icon={<Scale size={16} />} title="成本拆解分析">
            <p>{r.costBreakdown}</p>
          </ReportSection>
        ) : null}

        {r.toolingAnalysis ? (
          <ReportSection icon={<Wrench size={16} />} title="模具费分析">
            <p>{r.toolingAnalysis}</p>
          </ReportSection>
        ) : null}

        {r.recommendation ? (
          <ReportSection icon={<Lightbulb size={16} />} title="谈判与选型建议">
            {r.recommendation.selection ? (
              <p><strong>选型：</strong>{r.recommendation.selection}</p>
            ) : null}
            {r.recommendation.negotiation?.length > 0 ? (
              <div className="report-negotiation">
                <strong>谈判筹码：</strong>
                <ul>
                  {r.recommendation.negotiation.map((n, idx) => (
                    <li key={idx}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {r.recommendation.nextSteps ? (
              <p className="report-subnote"><strong>下一步：</strong>{r.recommendation.nextSteps}</p>
            ) : null}
          </ReportSection>
        ) : null}

        {r.risks?.length > 0 ? (
          <ReportSection icon={<AlertTriangle size={16} />} title="风险提示" accent="warn">
            <ul className="report-risks">
              {r.risks.map((risk, idx) => (
                <li key={idx}>{risk}</li>
              ))}
            </ul>
          </ReportSection>
        ) : null}
      </div>
    </div>
  )
}

function ReportSection({ icon, title, accent, children }) {
  return (
    <section className={`report-section ${accent || ''}`}>
      <h3 className="report-section-title">
        {icon}
        {title}
      </h3>
      <div className="report-section-body">{children}</div>
    </section>
  )
}

function formatDateTime(iso) {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export default ReportPanel
