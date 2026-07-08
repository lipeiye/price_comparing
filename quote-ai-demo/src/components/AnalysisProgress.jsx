import { Check, Loader2 } from 'lucide-react'
import { isMockAnalysisMode } from '../services/analyzeQuotes.js'

function AnalysisProgress({ steps, activeStep, isAnalyzing }) {
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
      <p className="helper-text">
        {isMockAnalysisMode
          ? '当前使用本地 Mock 数据，适合离线开发和界面调试。'
          : '系统会将 Excel 表格内容提交给后端云函数，并由 DeepSeek 生成结构化分析。'}
      </p>
    </div>
  )
}

export default AnalysisProgress
