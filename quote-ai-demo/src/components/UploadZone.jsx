import { useRef, useState } from 'react'
import { FileImage, Images, UploadCloud } from 'lucide-react'
import FileCard from './FileCard.jsx'
import { buildUploadItem, validateIncomingFiles } from '../utils/fileValidation.js'

function UploadZone({ files, setFiles, setError, disabled }) {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoadingDemo, setIsLoadingDemo] = useState(false)
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
      const target = current.find((item) => item.id === fileId)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.id !== fileId)
    })
    setError('')
  }

  async function loadDemoFiles() {
    if (disabled || isLoadingDemo) return

    setIsLoadingDemo(true)
    setError('')

    try {
      const demoFiles = await Promise.all(
        ['supplier-a.png', 'supplier-b.png', 'supplier-c.png'].map(async (name) => {
          const response = await fetch(`/demo/${name}`)
          const blob = await response.blob()
          return new File([blob], name, { type: blob.type || 'image/png' })
        }),
      )
      addFiles(demoFiles)
    } catch {
      setError('演示报价单加载失败，请刷新页面后重试。')
    } finally {
      setIsLoadingDemo(false)
    }
  }

  return (
    <div>
      <div
        className={`drop-zone ${isDragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          multiple
          disabled={disabled}
          onChange={(event) => addFiles(event.target.files)}
          aria-label="选择供应商报价单图片"
        />
        <div className="drop-content">
          <div className="drop-icon">
            <UploadCloud size={26} />
          </div>
          <h3>拖拽报价单图片到这里，或点击上传</h3>
          <p>仅支持 JPG、JPEG、PNG；最多 3 份；单份不超过 10 MB。</p>
          <div className="demo-links">
            <button
              className="demo-load-button"
              type="button"
              onClick={loadDemoFiles}
              disabled={disabled || isLoadingDemo || files.length >= 3}
            >
              <Images size={14} />
              载入演示文件
            </button>
            <a className="demo-file-link" href="/demo/supplier-a.png" download>
              <FileImage size={14} />
              示例 A
            </a>
            <a className="demo-file-link" href="/demo/supplier-b.png" download>
              <FileImage size={14} />
              示例 B
            </a>
            <a className="demo-file-link" href="/demo/supplier-c.png" download>
              <FileImage size={14} />
              示例 C
            </a>
          </div>
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
