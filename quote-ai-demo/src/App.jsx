import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BrainCircuit,
  CheckCircle2,
  FileSearch,
  RotateCcw,
  Sparkles,
  Loader2,
  History,
  Zap,
} from 'lucide-react'
import Header from './components/Header.jsx'
import UploadZone from './components/UploadZone.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import AnalysisProgress from './components/AnalysisProgress.jsx'
import ComparisonTable from './components/ComparisonTable.jsx'
import WarningCard from './components/WarningCard.jsx'
import RecommendationPanel from './components/RecommendationPanel.jsx'
import ReportPanel from './components/ReportPanel.jsx'
import OnboardingGuide from './components/OnboardingGuide.jsx'
import {
  analyzeQuotes,
  isMockAnalysisMode,
  restoreByContentHash,
} from './services/analyzeQuotes.js'
import {
  generateReport,
  isCurrentReportCache,
  loadCachedReport,
  REPORT_CACHE_VERSION,
} from './services/generateReport.js'
import { formatFileSize } from './utils/formatters.js'
import {
  saveSession,
  loadSession,
  clearSession,
  patchSessionReport,
} from './utils/sessionStore.js'

const progressSteps = [
  '正在读取 Excel 工作表',
  '正在统一商品名称与规格',
  '正在检测价格和条款异常',
  '正在生成快速采购结论',
]

function App() {
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [activeStep, setActiveStep] = useState(-1)
  const [result, setResult] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [cacheBanner, setCacheBanner] = useState('')

  const [report, setReport] = useState(null)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportElapsedMs, setReportElapsedMs] = useState(0)

  const [savedSession, setSavedSession] = useState(() => loadSession())

  const workbooksRef = useRef(null)
  const analyzedFilesRef = useRef([])
  const contentHashRef = useRef(null)

  useEffect(() => {
    if (!isAnalyzing) return undefined
    const start = Date.now()
    setElapsedMs(0)
    const id = setInterval(() => setElapsedMs(Date.now() - start), 250)
    return () => clearInterval(id)
  }, [isAnalyzing])

  useEffect(() => {
    if (!isGeneratingReport) return undefined
    const start = Date.now()
    setReportElapsedMs(0)
    const id = setInterval(() => setReportElapsedMs(Date.now() - start), 250)
    return () => clearInterval(id)
  }, [isGeneratingReport])

  const totalSize = useMemo(
    () => files.reduce((sum, item) => sum + item.size, 0),
    [files],
  )
  const sortedWarnings = useMemo(
    () => sortWarnings(result?.warnings || []),
    [result],
  )

  const canAnalyze = files.length >= 2 && !isAnalyzing

  async function handleAnalyze() {
    if (!canAnalyze) {
      setError('请至少上传 2 份供应商 Excel 报价单后再开始分析。')
      return
    }

    setError('')
    setCacheBanner('')
    setResult(null)
    setReport(null)
    setReportError('')
    setIsAnalyzing(true)
    setActiveStep(0)

    try {
      for (let index = 0; index < progressSteps.length; index += 1) {
        setActiveStep(index)
        await new Promise((resolve) => setTimeout(resolve, index === 0 ? 350 : 400))
      }

      const { result: analysisResult, workbooks } = await analyzeQuotes(files)
      applyAnalysisResult(analysisResult, workbooks, files)

      // 本地报告指纹缓存（同文件名大小）
      if (!analysisResult.cachedReport) {
        const localReport = loadCachedReport(files)
        if (localReport) setReport(localReport)
      }

      setActiveStep(progressSteps.length)
    } catch (analysisError) {
      setError(analysisError.message || '分析失败，请删除文件后重新上传再试。')
      setActiveStep(-1)
    } finally {
      setIsAnalyzing(false)
    }
  }

  function applyAnalysisResult(analysisResult, workbooks, sourceFiles) {
    setResult(analysisResult)
    workbooksRef.current = workbooks
    analyzedFilesRef.current = sourceFiles || []
    contentHashRef.current = analysisResult.contentHash || null

    if (analysisResult.cacheHit) {
      setCacheBanner('命中历史结果，未再次调用 AI（已省 token）')
    } else {
      setCacheBanner('')
    }

    if (analysisResult.cachedReport?.report) {
      setReport({
        report: analysisResult.cachedReport.report,
        generatedAt: analysisResult.cachedReport.generatedAt,
        cacheHit: true,
        cacheVersion: REPORT_CACHE_VERSION,
      })
    }

    const session = {
      contentHash: analysisResult.contentHash,
      fileNames: (sourceFiles || []).map((f) => f.name).filter(Boolean),
      result: analysisResult,
      workbooks,
      report: analysisResult.cachedReport?.report
        ? {
          report: analysisResult.cachedReport.report,
          generatedAt: analysisResult.cachedReport.generatedAt,
          cacheHit: true,
          cacheVersion: REPORT_CACHE_VERSION,
        }
        : null,
      cacheHit: Boolean(analysisResult.cacheHit),
    }
    // 若 sourceFiles 无 name（云端恢复），用 result 里没有文件名时用已有
    if (!session.fileNames.length && analysisResult.fileNames) {
      session.fileNames = analysisResult.fileNames
    }
    saveSession(session)
    setSavedSession(loadSession())
  }

  async function handleRestoreLocal() {
    const session = loadSession()
    if (!session?.result) {
      setError('没有可恢复的本机记录。')
      setSavedSession(null)
      return
    }
    setError('')
    setResult(session.result)
    workbooksRef.current = session.workbooks
    contentHashRef.current = session.contentHash
    analyzedFilesRef.current = []
    const restoredReport = isCurrentReportCache(session.report) ? session.report : null
    setReport(restoredReport)
    setCacheBanner(
      session.report && !restoredReport
        ? '已恢复上次比价；旧版报告请重新生成以获得完整中英文内容'
        : session.cacheHit
        ? '已恢复上次比价（来自本机快照 · 当时命中云端缓存）'
        : '已恢复上次比价（来自本机快照）',
    )
    setActiveStep(progressSteps.length)
  }

  async function handleRestoreCloud() {
    const session = loadSession()
    const hash = session?.contentHash
    if (!hash || hash === 'mock-local') {
      setError('没有可用的云端 contentHash，请用本机恢复或重新上传。')
      return
    }
    setError('')
    setIsAnalyzing(true)
    setCacheBanner('')
    try {
      const data = await restoreByContentHash(hash)
      applyAnalysisResult(data, session.workbooks || data.rawWorkbooks || null, [])
      if (!data.cachedReport && isCurrentReportCache(session.report)) {
        setReport(session.report)
      }
      setCacheBanner('已从云端缓存恢复，未调用 AI')
      setActiveStep(progressSteps.length)
    } catch (err) {
      setError(err.message || '云端恢复失败')
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function handleGenerateReport() {
    if (!result) {
      setReportError('请先完成快速比价，再生成详细报告。')
      return
    }
    if (!workbooksRef.current) {
      setReportError('缺少原始表格数据。请重新上传文件后比价，或使用本机快照恢复（需含表格）。')
      return
    }
    setReportError('')
    setIsGeneratingReport(true)
    setReport(null)

    try {
      const reportData = await generateReport(
        result,
        workbooksRef.current,
        analyzedFilesRef.current,
        contentHashRef.current || result.contentHash,
      )
      setReport(reportData)
      patchSessionReport(reportData)
      setSavedSession(loadSession())
      if (reportData.cacheHit) {
        setCacheBanner('报告命中缓存，未再次调用 AI')
      }
    } catch (reportErr) {
      setReportError(reportErr.message || '详细报告生成失败，请稍后重试。')
    } finally {
      setIsGeneratingReport(false)
    }
  }

  function handleReset() {
    setFiles([])
    setError('')
    setResult(null)
    setActiveStep(-1)
    setIsAnalyzing(false)
    setReport(null)
    setReportError('')
    setIsGeneratingReport(false)
    setCacheBanner('')
    workbooksRef.current = null
    analyzedFilesRef.current = []
    contentHashRef.current = null
  }

  function handleClearSaved() {
    clearSession()
    setSavedSession(null)
  }

  const sessionLabel = savedSession
    ? formatSessionLabel(savedSession)
    : ''

  return (
    <div className="app-shell">
      <Header />
      <OnboardingGuide hasResult={!!result} />

      <main className="app-main">
        <section className="workspace">
          <div className="panel upload-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">报价单上传</p>
                <h2>供应商文件</h2>
              </div>
              <span className="status-pill">
                {isMockAnalysisMode ? '本地 Mock 模式' : '真实 AI 分析'}
              </span>
            </div>

            {savedSession && !result ? (
              <div className="session-restore">
                <div className="session-restore-text">
                  <History size={16} />
                  <div>
                    <strong>发现上次比价记录</strong>
                    <p>{sessionLabel}</p>
                  </div>
                </div>
                <div className="session-restore-actions">
                  <button type="button" className="ghost-button" onClick={handleRestoreLocal}>
                    本机恢复
                  </button>
                  {!isMockAnalysisMode && savedSession.contentHash ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={handleRestoreCloud}
                      disabled={isAnalyzing}
                    >
                      云端恢复
                    </button>
                  ) : null}
                  <button type="button" className="text-button" onClick={handleClearSaved}>
                    清除
                  </button>
                </div>
              </div>
            ) : null}

            <UploadZone
              files={files}
              setFiles={setFiles}
              setError={setError}
              disabled={isAnalyzing}
            />

            <ErrorBanner message={error} />

            <div className="upload-summary" aria-live="polite">
              <span>{files.length}/8 份文件</span>
              <span>总大小 {formatFileSize(totalSize)}</span>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="primary-button"
                data-onboarding="analyze-button"
                disabled={!canAnalyze}
                onClick={handleAnalyze}
              >
                <BrainCircuit size={18} />
                开始智能比价
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={handleReset}
                disabled={isAnalyzing || (files.length === 0 && !result)}
                title="重置"
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </div>

          <div className="panel process-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">分析过程</p>
                <h2>AI 处理状态</h2>
              </div>
              {result ? (
                <span className="success-badge">
                  <CheckCircle2 size={16} />
                  {result.cacheHit ? '缓存命中' : '已完成'}
                </span>
              ) : null}
            </div>

            <AnalysisProgress
              steps={progressSteps}
              activeStep={activeStep}
              isAnalyzing={isAnalyzing}
              elapsedMs={elapsedMs}
            />

            {cacheBanner ? (
              <div className="cache-banner" role="status">
                <Zap size={15} />
                <span>{cacheBanner}</span>
              </div>
            ) : null}
          </div>
        </section>

        {result ? (
          <section className="results-grid">
            <div className="panel table-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">结构化结果</p>
                  <h2>报价比价表</h2>
                </div>
                <div className="panel-heading-right">
                  {result.cacheHit ? (
                    <span className="status-pill cache-pill">云端缓存 · 0 token</span>
                  ) : null}
                  <span className="status-pill">{result.items.length} 个商品</span>
                </div>
              </div>
              <ComparisonTable result={result} />

              <div className="report-trigger">
                <button
                  type="button"
                  className="report-button"
                  data-onboarding="report-button"
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport || !workbooksRef.current}
                >
                  {isGeneratingReport ? (
                    <>
                      <Loader2 className="spinner" size={18} />
                      正在生成精简双语报告…
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      生成精简双语报告
                    </>
                  )}
                </button>
                {isGeneratingReport ? (
                  <span className="report-timer">
                    已用时 {Math.floor(reportElapsedMs / 1000)}s · Flash 模型
                  </span>
                ) : report?.cacheHit ? (
                  <span className="report-hint">报告来自缓存，未消耗 AI</span>
                ) : (
                  <span className="report-hint">
                    表格化中英对比 · 可导出 Excel / PDF
                    {!workbooksRef.current ? ' · 需含原始表格才能生成报告' : ''}
                  </span>
                )}
              </div>

              <ErrorBanner message={reportError} />
            </div>

            <aside className="insight-column">
              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">异常检测</p>
                    <h2>需关注事项</h2>
                  </div>
                  <FileSearch size={20} />
                </div>
                <div className="warning-list">
                  {sortedWarnings.map((warning) => (
                    <WarningCard key={warning.id} warning={warning} />
                  ))}
                </div>
              </div>

              <RecommendationPanel summary={result.summary} />
            </aside>
          </section>
        ) : (
          <section className="empty-state">
            <FileSearch size={28} />
            <div>
              <h2>上传 2 到 8 份 Excel 报价单后开始分析</h2>
              <p>
                系统会按表格内容指纹缓存结果：关页后再传相同文件，或点「恢复」，不会重复消耗 AI。
              </p>
            </div>
          </section>
        )}

        {report ? (
          <section className="report-section-wrapper">
            <ReportPanel
              report={report.report}
              suppliers={result?.suppliers || []}
              items={result?.items || []}
              procurementSummary={result?.procurementSummary || null}
              generatedAt={report.generatedAt}
            />
          </section>
        ) : null}
      </main>
    </div>
  )
}

function formatSessionLabel(session) {
  const when = session.savedAt
    ? new Date(session.savedAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
  const names = (session.fileNames || []).slice(0, 3).join('、')
  const more =
    (session.fileNames || []).length > 3 ? ` 等 ${session.fileNames.length} 份` : ''
  const items = session.result?.items?.length || 0
  return [when, names ? `${names}${more}` : null, items ? `${items} 个项目` : null]
    .filter(Boolean)
    .join(' · ')
}

function sortWarnings(warnings) {
  const priority = { critical: 0, high: 1, medium: 2, low: 3 }
  return warnings
    .map((warning, index) => ({ warning, index }))
    .sort(
      (a, b) =>
        (priority[a.warning.severity] ?? 4) - (priority[b.warning.severity] ?? 4) ||
        a.index - b.index,
    )
    .map(({ warning }) => warning)
}

export default App
