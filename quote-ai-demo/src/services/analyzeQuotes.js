import { mockResult } from '../data/mockResult.js'
import { extractWorkbook } from '../utils/extractWorkbooks.js'

const env = import.meta.env || {}
const USE_MOCK = env.VITE_USE_MOCK !== 'false'
const API_URL = env.VITE_ANALYZE_API_URL

export const isMockAnalysisMode = USE_MOCK || !API_URL

// 返回 { result, workbooks }：
// - result：比价结果（suppliers/items/warnings/summary），供页面展示
// - workbooks：浏览器端提取的表格 JSON，供「详细报告」接口复用，避免重复解析
export async function analyzeQuotes(files) {
  const workbooks = await Promise.all(
    files.map((item) => extractWorkbook(item.file, item.name)),
  )

  if (isMockAnalysisMode) {
    return { result: structuredClone(mockResult), workbooks }
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
