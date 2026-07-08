import { Sparkles } from 'lucide-react'

function RecommendationPanel({ summary }) {
  return (
    <section className="panel recommendation-panel">
      <div className="recommendation-head">
        <div className="recommendation-icon">
          <Sparkles size={18} />
        </div>
        <h2>AI 采购建议</h2>
      </div>
      <p>{summary}</p>
    </section>
  )
}

export default RecommendationPanel
