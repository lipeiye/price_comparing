import { FileSpreadsheet, FileType, AlertTriangle, Target, ListOrdered, GitCompare } from 'lucide-react'
import { formatPrice } from '../utils/formatters.js'
import { asBilingual, hasBilingualText } from '../utils/bilingual.js'

async function getExporters() {
  return import('../utils/exportReport.js')
}

// 精简双语报告：表格为主，禁止七章长文。比价矩阵直接用快速比价的 items。
function ReportPanel({ report, suppliers, items, generatedAt }) {
  const r = normalizeClientReport(report)
  const verdict = asBilingual(r.verdict)
  const ranking = Array.isArray(r.ranking) ? r.ranking : []
  const keyGaps = Array.isArray(r.keyGaps) ? r.keyGaps : []
  const specIssues = Array.isArray(r.specIssues) ? r.specIssues : []
  const nextSteps = Array.isArray(r.nextSteps) ? r.nextSteps : []
  const risks = Array.isArray(r.risks) ? r.risks : []

  const handleExportExcel = async () => {
    const { exportReportToExcel } = await getExporters()
    exportReportToExcel(r, suppliers, items)
  }

  return (
    <div className="report-panel printable">
      <div className="report-head no-print">
        <div className="report-head-left">
          <p className="eyebrow">比价报告 / Comparison Report</p>
          <h2>精简双语 · 表格对比</h2>
          {generatedAt ? (
            <p className="report-meta">生成于 {formatDateTime(generatedAt)} · DeepSeek V4 Flash</p>
          ) : null}
        </div>
        <div className="report-export" data-onboarding="export-buttons">
          <button type="button" className="ghost-button report-export-btn" onClick={handleExportExcel}>
            <FileSpreadsheet size={16} />
            导出 Excel
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
        {(verdict.zh || verdict.en) && (
          <ReportSection icon={<Target size={16} />} title="结论 / Verdict">
            {verdict.zh ? <p className="verdict-zh">{verdict.zh}</p> : null}
            {verdict.en && verdict.en !== verdict.zh ? (
              <p className="verdict-en">{verdict.en}</p>
            ) : null}
          </ReportSection>
        )}

        {ranking.length > 0 && (
          <ReportSection icon={<ListOrdered size={16} />} title="供应商排名 / Ranking">
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>供应商 / Supplier</th>
                    <th>最低价项数 / Wins</th>
                    <th>备注 ZH</th>
                    <th>Note EN</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((row, idx) => {
                    const note = asBilingual(row.note)
                    return (
                      <tr key={`${row.supplier}-${idx}`}>
                        <td>{row.rank ?? idx + 1}</td>
                        <td>
                          <strong>{row.supplier || '—'}</strong>
                        </td>
                        <td>{row.lowestWins != null ? row.lowestWins : '—'}</td>
                        <td>{note.zh || '—'}</td>
                        <td className="cell-en">{note.en || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </ReportSection>
        )}

        {items?.length > 0 && (
          <ReportSection icon={<GitCompare size={16} />} title="比价矩阵 / Price Matrix">
            <div className="table-scroll">
              <table className="report-table report-matrix">
                <thead>
                  <tr>
                    <th>项目号 / Project</th>
                    <th>类型 / Type</th>
                    {suppliers.map((s) => (
                      <th key={s.id}>{s.name}</th>
                    ))}
                    <th>最低 / Lowest</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const lowestName =
                      suppliers.find((s) => s.id === item.lowestSupplierId)?.name || '—'
                    return (
                      <tr key={item.id || item.projectNo}>
                        <td>
                          <strong>{item.projectNo}</strong>
                        </td>
                        <td>{item.name || '—'}</td>
                        {suppliers.map((s) => {
                          const q = item.quotes?.find((x) => x.supplierId === s.id)
                          const isLowest = s.id === item.lowestSupplierId
                          if (!q?.matched || q.totalPrice == null) {
                            return (
                              <td key={s.id} className="is-missing">
                                漏报
                              </td>
                            )
                          }
                          return (
                            <td key={s.id} className={isLowest ? 'is-lowest' : ''}>
                              {formatPrice(q.totalPrice)}
                            </td>
                          )
                        })}
                        <td>{lowestName}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </ReportSection>
        )}

        {keyGaps.length > 0 && (
          <ReportSection icon={<GitCompare size={16} />} title="关键价差 / Key Gaps">
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>项目号</th>
                    <th>最低</th>
                    <th>最高</th>
                    <th>价差%</th>
                    <th>备注 ZH</th>
                    <th>Note EN</th>
                  </tr>
                </thead>
                <tbody>
                  {keyGaps.map((row, idx) => {
                    const note = asBilingual(row.note)
                    return (
                      <tr key={`${row.projectNo}-${idx}`}>
                        <td>{row.projectNo || '—'}</td>
                        <td>{row.lowest || '—'}</td>
                        <td>{row.highest || '—'}</td>
                        <td>{row.gapPct != null ? `${row.gapPct}%` : '—'}</td>
                        <td>{note.zh || '—'}</td>
                        <td className="cell-en">{note.en || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </ReportSection>
        )}

        {specIssues.length > 0 && (
          <ReportSection
            icon={<AlertTriangle size={16} />}
            title="规格问题 / Spec Issues"
            accent="warn"
          >
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>项目号</th>
                    <th>供应商</th>
                    <th>问题 ZH</th>
                    <th>Issue EN</th>
                  </tr>
                </thead>
                <tbody>
                  {specIssues.map((row, idx) => {
                    const issue = asBilingual(row.issue)
                    return (
                      <tr key={`${row.projectNo}-${idx}`}>
                        <td>{row.projectNo || '—'}</td>
                        <td>{row.supplier || '—'}</td>
                        <td>{issue.zh || '—'}</td>
                        <td className="cell-en">{issue.en || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </ReportSection>
        )}

        {(nextSteps.some(hasBilingualText) || risks.some(hasBilingualText)) && (
          <div className="report-two-col">
            {nextSteps.some(hasBilingualText) && (
              <ReportSection icon={<Target size={16} />} title="下一步 / Next Steps">
                <ul className="report-compact-list">
                  {nextSteps.map((step, idx) => {
                    const t = asBilingual(step)
                    if (!t.zh && !t.en) return null
                    return (
                      <li key={idx}>
                        {t.zh ? <span>{t.zh}</span> : null}
                        {t.en && t.en !== t.zh ? <span className="line-en">{t.en}</span> : null}
                      </li>
                    )
                  })}
                </ul>
              </ReportSection>
            )}
            {risks.some(hasBilingualText) && (
              <ReportSection
                icon={<AlertTriangle size={16} />}
                title="风险 / Risks"
                accent="warn"
              >
                <ul className="report-compact-list">
                  {risks.map((risk, idx) => {
                    const t = asBilingual(risk)
                    if (!t.zh && !t.en) return null
                    return (
                      <li key={idx}>
                        {t.zh ? <span>{t.zh}</span> : null}
                        {t.en && t.en !== t.zh ? <span className="line-en">{t.en}</span> : null}
                      </li>
                    )
                  })}
                </ul>
              </ReportSection>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** 兼容旧七章缓存 / 新表格结构 */
function normalizeClientReport(raw) {
  const r = raw || {}
  if (r.verdict || r.ranking || r.keyGaps) return r
  if (!r.executiveSummary && !r.priceAnalysis) return r
  return {
    verdict: asBilingual(r.executiveSummary),
    ranking: (r.priceAnalysis?.overallRanking || []).map((item, idx) => ({
      rank: item.rank || idx + 1,
      supplier: item.supplier || '',
      lowestWins: null,
      note: asBilingual(item.note || item.avgPriceLevel || ''),
    })),
    keyGaps: (r.priceAnalysis?.spreadInsights || []).slice(0, 6).map((s) => ({
      projectNo: '',
      lowest: '',
      highest: '',
      gapPct: null,
      note: asBilingual(s),
    })),
    specIssues: (r.specAudit || []).flatMap((audit) =>
      (audit.findings || []).map((f) => ({
        projectNo: audit.projectNo || '',
        supplier: f.supplier || '',
        issue: asBilingual(f.issue || ''),
      })),
    ),
    nextSteps: r.recommendation?.nextSteps
      ? [asBilingual(r.recommendation.nextSteps)]
      : r.recommendation?.selection
        ? [asBilingual(r.recommendation.selection)]
        : [],
    risks: (r.risks || []).slice(0, 3).map((x) => asBilingual(x)),
  }
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
