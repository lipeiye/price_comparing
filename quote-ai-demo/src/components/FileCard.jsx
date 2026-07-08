import { FileImage, Trash2 } from 'lucide-react'
import { formatFileSize } from '../utils/formatters.js'

function FileCard({ file, onRemove, disabled }) {
  return (
    <article className="file-card">
      <img className="file-preview" src={file.previewUrl} alt={`${file.name} 预览`} />
      <div className="file-info">
        <strong title={file.name}>{file.name}</strong>
        <div className="file-meta">
          <FileImage size={14} />
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
