// 详细分析报告服务：把快速比价的结果 + 原始表格发给 generateReport 云函数，
// 由更强的 AI 模型（deepseek-v4-pro，默认开启思考模式）生成多维深度报告。
//
// 设计要点：
// - 无状态：报告接口不重新算价格，直接复用快速比价已对齐的结果，避免重复劳动和口径漂移。
// - 暂存：报告结果按文件名指纹存 localStorage，刷新页面后若文件未变可恢复，避免重复消耗。
const env = import.meta.env || {}
const REPORT_API_URL = env.VITE_REPORT_API_URL

const REPORT_STORAGE_KEY = 'quote-report-cache'

// 生成本次上传文件的指纹（文件名 + 大小），用于报告缓存的 key
export function makeFilesFingerprint(files) {
  const sig = files.map((f) => `${f.name}:${f.size}`).sort().join('|')
  let hash = 0
  for (let i = 0; i < sig.length; i += 1) {
    hash = (hash << 5) - hash + sig.charCodeAt(i)
    hash |= 0
  }
  return `fp_${hash.toString(36)}`
}

export function loadCachedReport(files) {
  try {
    const fp = makeFilesFingerprint(files)
    const raw = localStorage.getItem(`${REPORT_STORAGE_KEY}:${fp}`)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function cacheReport(files, reportData) {
  try {
    const fp = makeFilesFingerprint(files)
    localStorage.setItem(`${REPORT_STORAGE_KEY}:${fp}`, JSON.stringify(reportData))
  } catch {
    // localStorage 满或不可用时静默跳过，不影响主流程
  }
}

export async function generateReport(alignedResult, workbooks, files) {
  if (!REPORT_API_URL) {
    throw new Error('详细报告接口未配置，请设置 VITE_REPORT_API_URL。')
  }

  const response = await fetch(REPORT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alignedResult,
      rawWorkbooks: workbooks,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.message || `详细报告请求失败：HTTP ${response.status}`)
  }
  if (!data?.success) {
    throw new Error(data?.message || '详细报告生成失败')
  }

  const reportData = { report: data.report, generatedAt: data.generatedAt }
  cacheReport(files, reportData)
  return reportData
}
