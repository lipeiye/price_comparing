/** 统一读取双语字段：支持 { zh, en } 或旧版纯字符串 */
export function asBilingual(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      zh: typeof value.zh === 'string' ? value.zh : '',
      en: typeof value.en === 'string' ? value.en : '',
    }
  }
  if (typeof value === 'string' && value.trim()) {
    return { zh: value, en: value }
  }
  return { zh: '', en: '' }
}

export function hasBilingualText(value) {
  const b = asBilingual(value)
  return Boolean(b.zh || b.en)
}
