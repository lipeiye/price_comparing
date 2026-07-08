export function formatFileSize(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatCurrency(value) {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value)
}

// 紧凑价格：¥157.1，省空间，用于表格单元格内的总价
export function formatPrice(value) {
  if (value === null || value === undefined) return '-'
  const rounded = Math.round(value * 10) / 10
  return `¥${rounded.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}`
}
