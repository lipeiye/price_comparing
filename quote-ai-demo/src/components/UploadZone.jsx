import { useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import FileCard from './FileCard.jsx'
import { buildUploadItem, validateIncomingFiles } from '../utils/fileValidation.js'

function UploadZone({ files, setFiles, setError, disabled }) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)

  function addFiles(fileList) {
    const incoming = Array.from(fileList)
    const validation = validateIncomingFiles(incoming, files)

    if (validation.errors.length > 0) {
      setError(validation.errors[0])
    } else {
      setError('')
    }

    if (validation.accepted.length === 0) {
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    setFiles((current) => [...current, ...validation.accepted.map(buildUploadItem)])
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleDragOver(event) {
    event.preventDefault()
    if (!disabled) setIsDragging(true)
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    if (!disabled) addFiles(event.dataTransfer.files)
  }

  function removeFile(fileId) {
    setFiles((current) => {
      return current.filter((item) => item.id !== fileId)
    })
    setError('')
  }

  return (
    <div>
      <div
        className={`drop-zone ${isDragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
        data-onboarding="upload-zone"
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          disabled={disabled}
          onChange={(event) => addFiles(event.target.files)}
          aria-label="选择供应商 Excel 报价单"
        />
        <div className="drop-content">
          <div className="drop-icon">
            <UploadCloud size={26} />
          </div>
          <h3>拖拽 Excel 报价单到这里，或点击上传</h3>
          <p>仅支持 XLSX；最多 8 份；单份不超过 10 MB。</p>
        </div>
      </div>

      {files.length > 0 ? (
        <div className="file-grid">
          {files.map((file) => (
            <FileCard key={file.id} file={file} onRemove={removeFile} disabled={disabled} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default UploadZone
