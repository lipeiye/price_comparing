import { useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileType,
  ListOrdered,
  MoveHorizontal,
  Target,
} from 'lucide-react'
import { asBilingual, hasBilingualText } from '../utils/bilingual.js'

async function getExporters() {
  return import('../utils/exportReport.js')
}

const copy = {
  zh: {
    tab: '中文报告',
    title: '采购决策报告',
    generated: '生成于',
    verdict: '采购结论',
    ranking: '供应商优先级',
    gaps: '重点价差',
    specs: '规格待核实',
    nextSteps: '下一步',
    risks: '风险提示',
    rank: '排名',
    supplier: '供应商',
    wins: '最低价项数',
    note: '采购判断',
    project: '项目号',
    lowest: '最低价方',
    highest: '最高价方',
    gap: '价差',
    issue: '待核实事项',
    scroll: '左右滑动查看完整表格',
    exportExcel: '导出 Excel',
    exportPdf: '导出 PDF',
  },
  en: {
    tab: 'English report',
    title: 'Procurement Decision Report',
    generated: 'Generated',
    verdict: 'Decision',
    ranking: 'Supplier Priority',
    gaps: 'Key Price Gaps',
    specs: 'Specification Checks',
    nextSteps: 'Next Steps',
    risks: 'Risks',
    rank: 'Rank',
    supplier: 'Supplier',
    wins: 'Lowest-price wins',
    note: 'Procurement view',
    project: 'Project',
    lowest: 'Lowest bidder',
    highest: 'Highest bidder',
    gap: 'Gap',
    issue: 'Item to verify',
    scroll: 'Scroll sideways to see the full table',
    exportExcel: 'Export Excel',
    exportPdf: 'Export PDF',
  },
}

// 报告只显示一种语言；中英文以独立视图呈现，避免同一表格双列堆叠。
function ReportPanel({ report, suppliers, items, procurementSummary, generatedAt }) {
  const [language, setLanguage] = useState('zh')
  const t = copy[language]
  const isLegacyReport = Boolean(
    report && !report.verdict && (report.executiveSummary || report.priceAnalysis),
  )
  const r = normalizeClientReport(report)
  const verdict = localized(r.verdict, language)
  const ranking = Array.isArray(r.ranking) ? r.ranking : []
  const keyGaps = Array.isArray(r.keyGaps) ? r.keyGaps : []
  const specIssues = Array.isArray(r.specIssues) ? r.specIssues : []
  const nextSteps = Array.isArray(r.nextSteps) ? r.nextSteps : []
  const risks = Array.isArray(r.risks) ? r.risks : []

  const handleExportExcel = async () => {
    const { exportReportToExcel } = await getExporters()
    exportReportToExcel(r, suppliers, items, procurementSummary)
  }

  return (
    <div className="report-panel printable">
      <div className="report-head no-print">
        <div className="report-head-left">
          <p className="eyebrow">{t.tab}</p>
          <h2>{t.title}</h2>
          {generatedAt ? (
            <p className="report-meta">
              {t.generated} {formatDateTime(generatedAt)} · DeepSeek V4 Flash
            </p>
          ) : null}
        </div>
        <div className="report-head-actions">
          <div className="report-language-switch" role="tablist" aria-label="Report language">
            {Object.entries(copy).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={language === key}
                className={language === key ? 'is-active' : ''}
                onClick={() => setLanguage(key)}
              >
                {label.tab}
              </button>
            ))}
          </div>
          <div className="report-export" data-onboarding="export-buttons">
            <button type="button" className="ghost-button report-export-btn" onClick={handleExportExcel}>
              <FileSpreadsheet size={16} />
              {t.exportExcel}
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
              {t.exportPdf}
            </button>
          </div>
        </div>
      </div>

      <div className="report-body" lang={language === 'zh' ? 'zh-CN' : 'en'}>
        {language === 'en' && isLegacyReport ? (
          <ReportSection icon={<AlertTriangle size={16} />} title="English content unavailable" accent="warn">
            <p className="verdict-main">
              This saved report was generated before bilingual content was introduced. Generate the
              report again to create the English version.
            </p>
          </ReportSection>
        ) : (
          <>
        {verdict && (
          <ReportSection icon={<Target size={16} />} title={t.verdict}>
            <p className="verdict-main">{verdict}</p>
          </ReportSection>
        )}

        {ranking.length > 0 && (
          <ReportSection icon={<ListOrdered size={16} />} title={t.ranking}>
            <ReportTable label={t.scroll}>
              <table className="report-table report-table-ranking">
                <thead>
                  <tr>
                    <th>{t.rank}</th>
                    <th>{t.supplier}</th>
                    <th>{t.wins}</th>
                    <th>{t.note}</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((row, idx) => (
                    <tr key={`${row.supplier}-${idx}`}>
                      <td>{row.rank ?? idx + 1}</td>
                      <td><strong>{row.supplier || '—'}</strong></td>
                      <td>{row.lowestWins ?? '—'}</td>
                      <td className="report-note-cell">{localized(row.note, language) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTable>
          </ReportSection>
        )}

        {keyGaps.length > 0 && (
          <ReportSection icon={<MoveHorizontal size={16} />} title={t.gaps}>
            <ReportTable label={t.scroll}>
              <table className="report-table report-table-gaps">
                <thead>
                  <tr>
                    <th>{t.project}</th>
                    <th>{t.lowest}</th>
                    <th>{t.highest}</th>
                    <th>{t.gap}</th>
                    <th>{t.note}</th>
                  </tr>
                </thead>
                <tbody>
                  {keyGaps.map((row, idx) => (
                    <tr key={`${row.projectNo}-${idx}`}>
                      <td><strong>{row.projectNo || '—'}</strong></td>
                      <td>{row.lowest || '—'}</td>
                      <td>{row.highest || '—'}</td>
                      <td>{row.gapPct != null ? `${row.gapPct}%` : '—'}</td>
                      <td className="report-note-cell">{localized(row.note, language) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTable>
          </ReportSection>
        )}

        {specIssues.length > 0 && (
          <ReportSection icon={<AlertTriangle size={16} />} title={t.specs} accent="warn">
            <ReportTable label={t.scroll}>
              <table className="report-table report-table-specs">
                <thead>
                  <tr>
                    <th>{t.project}</th>
                    <th>{t.supplier}</th>
                    <th>{t.issue}</th>
                  </tr>
                </thead>
                <tbody>
                  {specIssues.map((row, idx) => (
                    <tr key={`${row.projectNo}-${idx}`}>
                      <td>{row.projectNo || '—'}</td>
                      <td>{row.supplier || '—'}</td>
                      <td className="report-note-cell">{localized(row.issue, language) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTable>
          </ReportSection>
        )}

        {(nextSteps.some(hasBilingualText) || risks.some(hasBilingualText)) && (
          <div className="report-two-col">
            {nextSteps.some(hasBilingualText) && (
              <ReportSection icon={<Target size={16} />} title={t.nextSteps}>
                <CompactList entries={nextSteps} language={language} />
              </ReportSection>
            )}
            {risks.some(hasBilingualText) && (
              <ReportSection icon={<AlertTriangle size={16} />} title={t.risks} accent="warn">
                <CompactList entries={risks} language={language} />
              </ReportSection>
            )}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  )
}

function ReportTable({ label, children }) {
  return (
    <div className="report-table-wrap">
      <div className="report-table-scroll" tabIndex="0" aria-label={label}>
        {children}
      </div>
      <p className="report-scroll-hint">
        <ChevronLeft size={14} />
        {label}
        <ChevronRight size={14} />
      </p>
    </div>
  )
}

function CompactList({ entries, language }) {
  return (
    <ul className="report-compact-list">
      {entries.map((entry, idx) => {
        const text = localized(entry, language)
        return text ? <li key={idx}>{text}</li> : null
      })}
    </ul>
  )
}

function localized(value, language) {
  const text = asBilingual(value)
  return text[language] || text.zh || text.en || ''
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
