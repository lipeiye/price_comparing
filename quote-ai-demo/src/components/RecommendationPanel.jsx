import { Sparkles } from 'lucide-react'
import { asBilingual } from '../utils/bilingual.js'

function RecommendationPanel({ summary }) {
  const text = asBilingual(summary)

  return (
    <section className="panel recommendation-panel">
      <div className="recommendation-head">
        <div className="recommendation-icon">
          <Sparkles size={18} />
        </div>
        <h2>AI 采购建议 / Recommendation</h2>
      </div>
      {text.zh ? <p className="summary-zh">{text.zh}</p> : null}
      {text.en && text.en !== text.zh ? <p className="summary-en">{text.en}</p> : null}
      {!text.zh && !text.en ? <p className="summary-zh">暂无建议</p> : null}
    </section>
  )
}

export default RecommendationPanel
