const MAX_FILES = 3
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg'])

export function buildUploadItem(file) {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    previewUrl: URL.createObjectURL(file),
  }
}

export function validateIncomingFiles(incomingFiles, currentFiles) {
  const accepted = []
  const errors = []
  const existingKeys = new Set(currentFiles.map((file) => getFileKey(file)))

  for (const file of incomingFiles) {
    if (currentFiles.length + accepted.length >= MAX_FILES) {
      errors.push('最多只能上传 3 份供应商报价单，第 4 份已被拒绝。')
      break
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      errors.push(`${file.name} 不是 JPG、JPEG 或 PNG 图片，已被拒绝。`)
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

function getFileKey(file) {
  return `${file.name}-${file.size}-${file.type}`
}
