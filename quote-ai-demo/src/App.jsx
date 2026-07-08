import { useMemo, useState } from 'react'
import { BrainCircuit, CheckCircle2, FileSearch, RotateCcw } from 'lucide-react'
import Header from './components/Header.jsx'
import UploadZone from './components/UploadZone.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import AnalysisProgress from './components/AnalysisProgress.jsx'
import ComparisonTable from './components/ComparisonTable.jsx'
import WarningCard from './components/WarningCard.jsx'
import RecommendationPanel from './components/RecommendationPanel.jsx'
import { analyzeQuotes } from './services/analyzeQuotes.js'
import { formatFileSize } from './utils/formatters.js'

const progressSteps = [
  '正在读取 Excel 工作表',
  '正在统一商品名称与规格',
  '正在检测价格和条款异常',
  '正在生成采购建议',
]

function App() {
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [activeStep, setActiveStep] = useState(-1)
  const [result, setResult] = useState(null)

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
    setIsAnalyzing(true)
    setActiveStep(0)

    try {
      for (let index = 0; index < progressSteps.length; index += 1) {
        setActiveStep(index)
        await new Promise((resolve) => setTimeout(resolve, index === 0 ? 450 : 520))
      }

      const analysisResult = await analyzeQuotes(files)
      setResult(analysisResult)
      setActiveStep(progressSteps.length)
    } catch (analysisError) {
      setError(analysisError.message || '分析失败，请删除文件后重新上传再试。')
      setActiveStep(-1)
    } finally {
      setIsAnalyzing(false)
    }
  }

  function handleReset() {
    setFiles([])
    setError('')
    setResult(null)
    setActiveStep(-1)
    setIsAnalyzing(false)
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
              <span className="status-pill">Mock 演示模式</span>
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
                <span className="status-pill">{result.items.length} 个商品</span>
              </div>
              <ComparisonTable result={result} />
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
              <p>系统会读取表格内容，并生成比价表、异常提示和采购建议。</p>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
