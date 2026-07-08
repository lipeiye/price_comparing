import { FileSpreadsheet, Trash2 } from 'lucide-react'
import { formatFileSize } from '../utils/formatters.js'

function FileCard({ file, onRemove, disabled }) {
  return (
    <article className="file-card">
      <div className="file-preview spreadsheet-preview" aria-hidden="true">
        <FileSpreadsheet size={30} />
        <span>Excel</span>
      </div>
      <div className="file-info">
        <strong title={file.name}>{file.name}</strong>
        <div className="file-meta">
          <FileSpreadsheet size={14} />
          <span>{formatFileSize(file.size)}</span>
        </div>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={() => onRemove(file.id)}
        disabled={disabled}
        title="删除文件"
        aria-label={`删除 ${file.name}`}
      >
        <Trash2 size={16} />
      </button>
    </article>
  )
}

export default FileCard
