// 精简双语报告服务：复用快速比价结果；按 contentHash 服务端缓存，避免重复烧 token。
const env = import.meta.env || {}
const REPORT_API_URL = env.VITE_REPORT_API_URL

const REPORT_STORAGE_KEY = 'quote-report-cache'
export const REPORT_CACHE_VERSION = 'v4-bilingual'

export function makeFilesFingerprint(files) {
  const sig = (files || []).map((f) => `${f.name}:${f.size}`).sort().join('|')
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
    const cached = JSON.parse(raw)
    return isCurrentReportCache(cached) ? cached : null
  } catch {
    return null
  }
}

export function isCurrentReportCache(reportData) {
  return Boolean(reportData?.cacheVersion === REPORT_CACHE_VERSION)
}

function cacheReportLocal(files, reportData) {
  try {
    if (!files?.length) return
    const fp = makeFilesFingerprint(files)
    localStorage.setItem(`${REPORT_STORAGE_KEY}:${fp}`, JSON.stringify(reportData))
  } catch {
    // ignore
  }
}

export async function generateReport(alignedResult, workbooks, files, contentHash) {
  if (!REPORT_API_URL) {
    throw new Error('详细报告接口未配置，请设置 VITE_REPORT_API_URL。')
  }

  const response = await fetch(REPORT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alignedResult,
      rawWorkbooks: workbooks,
      contentHash: contentHash || alignedResult?.contentHash || undefined,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.message || `详细报告请求失败：HTTP ${response.status}`)
  }
  if (!data?.success) {
    throw new Error(data?.message || '详细报告生成失败')
  }

  const reportData = {
    report: data.report,
    generatedAt: data.generatedAt,
    cacheHit: Boolean(data.cacheHit),
    contentHash: data.contentHash || contentHash || null,
    cacheVersion: REPORT_CACHE_VERSION,
  }
  cacheReportLocal(files, reportData)
  return reportData
}
