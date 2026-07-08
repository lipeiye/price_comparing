import { Check, Loader2 } from 'lucide-react'
import { isMockAnalysisMode } from '../services/analyzeQuotes.js'

// 结构化对齐由代码秒级完成，AI 叙述生成通常需要 30–120 秒，最长约 4 分钟。
// 用一条随已用时渐进的进度条给用户真实反馈。指数逼近，封顶 96%，结果返回时由步骤收尾到完成。
function computePercent(elapsedMs) {
  return Math.min(96, Math.round(100 * (1 - Math.exp(-elapsedMs / 45000))))
}

function AnalysisProgress({ steps, activeStep, isAnalyzing, elapsedMs = 0 }) {
  const isRealWait = !isMockAnalysisMode && isAnalyzing && activeStep >= steps.length - 1
  const seconds = Math.floor(elapsedMs / 1000)
  const percent = computePercent(elapsedMs)

  return (
    <div className="progress-list">
      {steps.map((step, index) => {
        const isDone = activeStep > index
        const isActive = activeStep === index && isAnalyzing

        return (
          <div
            key={step}
            className={`progress-step ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}`}
          >
            <div className="step-dot" aria-hidden="true">
              {isActive ? <Loader2 className="spinner" size={16} /> : null}
              {isDone ? <Check size={16} /> : null}
              {!isActive && !isDone ? index + 1 : null}
            </div>
            <span>{step}</span>
          </div>
        )
      })}

      {isRealWait ? (
        <div className="ai-wait" aria-live="polite">
          <div className="ai-wait-head">
            <span>AI 正在逐项比对报价</span>
            <span className="ai-wait-timer">已用时 {seconds}s</span>
          </div>
          <div
            className="ai-wait-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="ai-wait-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="ai-wait-hint">
            结构化对齐已由代码完成，AI 正在生成采购建议与规格校验，通常需要 1 到 2 分钟，请保持页面打开。
          </p>
        </div>
      ) : null}

      <p className="helper-text">
        {isMockAnalysisMode
          ? '当前使用本地 Mock 数据，适合离线开发和界面调试。'
          : '系统会将 Excel 表格内容提交给后端云函数，并由 DeepSeek 生成结构化分析。'}
      </p>
    </div>
  )
}

export default AnalysisProgress
