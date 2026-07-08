const severityLabel = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

function WarningCard({ warning }) {
  return (
    <article className={`warning-card ${warning.severity}`}>
      <div className="warning-head">
        <strong>{warning.title}</strong>
        <span className="tag">{severityLabel[warning.severity] || '提示'}</span>
      </div>
      <p>{warning.message}</p>
    </article>
  )
}

export default WarningCard
