import { mockResult } from '../data/mockResult.js'
import { extractWorkbook } from '../utils/extractWorkbooks.js'

const env = import.meta.env || {}
const USE_MOCK = env.VITE_USE_MOCK !== 'false'
const API_URL = env.VITE_ANALYZE_API_URL

export const isMockAnalysisMode = USE_MOCK || !API_URL

// 返回 { result, workbooks }：
// - result：比价结果（含 contentHash / cacheHit）
// - workbooks：解析后的表格 JSON
export async function analyzeQuotes(files) {
  const workbooks = await Promise.all(
    files.map((item) => extractWorkbook(item.file, item.name)),
  )

  if (isMockAnalysisMode) {
    return {
      result: {
        ...structuredClone(mockResult),
        cacheHit: false,
        contentHash: 'mock-local',
      },
      workbooks,
    }
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workbooks }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.message || `AI 接口请求失败：HTTP ${response.status}`)
  }
  if (!data?.success) {
    throw new Error(data?.message || '真实 AI 分析失败')
  }

  return { result: data, workbooks }
}

/** 仅用 contentHash 从云端恢复（无需重新上传文件） */
export async function restoreByContentHash(contentHash) {
  if (isMockAnalysisMode) {
    throw new Error('Mock 模式不支持云端恢复。')
  }
  if (!API_URL) {
    throw new Error('比价接口未配置。')
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'lookup', contentHash }),
  })

  const data = await response.json()
  if (!response.ok || !data?.success) {
    throw new Error(data?.message || '云端缓存未命中或已过期')
  }
  return data
}
