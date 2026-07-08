import { Check, Loader2 } from 'lucide-react'

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
      <p className="helper-text">Mock 模式不依赖网络，适合现场稳定演示。</p>
    </div>
  )
}

export default AnalysisProgress
