const MAX_FILES = 8
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])
const ALLOWED_EXTENSIONS = new Set(['xlsx'])

export function buildUploadItem(file) {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    name: file.name,
    size: file.size,
    type: file.type,
  }
}

export function validateIncomingFiles(incomingFiles, currentFiles) {
  const accepted = []
  const errors = []
  const existingKeys = new Set(currentFiles.map((file) => getFileKey(file)))

  for (const file of incomingFiles) {
    if (currentFiles.length + accepted.length >= MAX_FILES) {
      errors.push(`最多只能上传 ${MAX_FILES} 份供应商报价单，第 ${MAX_FILES + 1} 份起已被拒绝。`)
      break
    }

    if (!isExcelFile(file)) {
      errors.push(`${file.name} 不是 XLSX Excel 文件，已被拒绝。`)
      continue
    }

    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name} 超过 10 MB，请压缩后再上传。`)
      continue
    }

    const key = getFileKey(file)
    if (existingKeys.has(key)) {
      errors.push(`${file.name} 已经上传过，请不要重复添加。`)
      continue
    }

    existingKeys.add(key)
    accepted.push(file)
  }

  return { accepted, errors }
}

export { MAX_FILES }

function getFileKey(file) {
  return `${file.name}-${file.size}-${file.type}`
}

function isExcelFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  return ALLOWED_EXTENSIONS.has(extension) || ALLOWED_TYPES.has(file.type)
}
