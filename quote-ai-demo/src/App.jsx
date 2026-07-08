import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, CheckCircle2, FileSearch, RotateCcw, Sparkles, Loader2 } from 'lucide-react'
import Header from './components/Header.jsx'
import UploadZone from './components/UploadZone.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import AnalysisProgress from './components/AnalysisProgress.jsx'
import ComparisonTable from './components/ComparisonTable.jsx'
import WarningCard from './components/WarningCard.jsx'
import RecommendationPanel from './components/RecommendationPanel.jsx'
import ReportPanel from './components/ReportPanel.jsx'
import { analyzeQuotes, isMockAnalysisMode } from './services/analyzeQuotes.js'
import {
  generateReport,
  loadCachedReport,
} from './services/generateReport.js'
import { formatFileSize } from './utils/formatters.js'

const progressSteps = [
  '正在读取 Excel 工作表',
  '正在统一商品名称与规格',
  '正在检测价格和条款异常',
  '正在调用 DeepSeek 生成采购建议',
]

function App() {
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [activeStep, setActiveStep] = useState(-1)
  const [result, setResult] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  // 详细报告相关状态
  const [report, setReport] = useState(null)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportElapsedMs, setReportElapsedMs] = useState(0)

  // 持有最近一次分析使用的 workbooks，供详细报告接口复用
  const workbooksRef = useRef(null)
  const analyzedFilesRef = useRef([])

  // 快速比价等待计时
  useEffect(() => {
    if (!isAnalyzing) return undefined
    const start = Date.now()
    setElapsedMs(0)
    const id = setInterval(() => setElapsedMs(Date.now() - start), 250)
    return () => clearInterval(id)
  }, [isAnalyzing])

  // 详细报告等待计时
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

  const canAnalyze = files.length >= 2 && !isAnalyzing

  async function handleAnalyze() {
    if (!canAnalyze) {
      setError('请至少上传 2 份供应商 Excel 报价单后再开始分析。')
      return
    }

    setError('')
    setResult(null)
    setReport(null)
    setReportError('')
    setIsAnalyzing(true)
    setActiveStep(0)

    try {
      for (let index = 0; index < progressSteps.length; index += 1) {
        setActiveStep(index)
        await new Promise((resolve) => setTimeout(resolve, index === 0 ? 450 : 520))
      }

      const { result: analysisResult, workbooks } = await analyzeQuotes(files)
      setResult(analysisResult)
      workbooksRef.current = workbooks
      analyzedFilesRef.current = files
      setActiveStep(progressSteps.length)

      // 分析完成后，尝试恢复同份文件的历史报告缓存
      const cached = loadCachedReport(files)
      if (cached) setReport(cached)
    } catch (analysisError) {
      setError(analysisError.message || '分析失败，请删除文件后重新上传再试。')
      setActiveStep(-1)
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function handleGenerateReport() {
    if (!result || !workbooksRef.current) {
      setReportError('请先完成快速比价，再生成详细报告。')
      return
    }
    setReportError('')
    setIsGeneratingReport(true)
    setReport(null)

    try {
      const reportData = await generateReport(result, workbooksRef.current, analyzedFilesRef.current)
      setReport(reportData)
    } catch (reportError) {
      setReportError(reportError.message || '详细报告生成失败，请稍后重试。')
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
    workbooksRef.current = null
    analyzedFilesRef.current = []
  }

  return (
    <div className="app-shell">
      <Header />

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

            <UploadZone
              files={files}
              setFiles={setFiles}
              setError={setError}
              disabled={isAnalyzing}
            />

            <ErrorBanner message={error} />

            <div className="upload-summary" aria-live="polite">
              <span>{files.length}/3 份文件</span>
              <span>总大小 {formatFileSize(totalSize)}</span>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="primary-button"
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
                disabled={isAnalyzing || files.length === 0}
                title="重置上传文件"
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
                  已完成
                </span>
              ) : null}
            </div>

            <AnalysisProgress
              steps={progressSteps}
              activeStep={activeStep}
              isAnalyzing={isAnalyzing}
              elapsedMs={elapsedMs}
            />
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
                  <span className="status-pill">{result.items.length} 个商品</span>
                </div>
              </div>
              <ComparisonTable result={result} />

              <div className="report-trigger">
                <button
                  type="button"
                  className="report-button"
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport}
                >
                  {isGeneratingReport ? (
                    <>
                      <Loader2 className="spinner" size={18} />
                      正在生成详细分析报告…
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      生成详细分析报告（深度 AI）
                    </>
                  )}
                </button>
                {isGeneratingReport ? (
                  <span className="report-timer">
                    已用时 {Math.floor(reportElapsedMs / 1000)}s · 推理模型较慢，请耐心等待
                  </span>
                ) : (
                  <span className="report-hint">
                    使用更强模型做多维深度分析，可导出 Word/PDF
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
                  {result.warnings.map((warning) => (
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
              <h2>上传 2 到 3 份 Excel 报价单后开始分析</h2>
              <p>系统会读取表格内容，通过云函数调用 DeepSeek，并生成比价表、异常提示和采购建议。</p>
            </div>
          </section>
        )}

        {report ? (
          <section className="report-section-wrapper">
            <ReportPanel
              report={report.report}
              suppliers={result?.suppliers || []}
              items={result?.items || []}
              generatedAt={report.generatedAt}
            />
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default App
