import { mockResult } from '../data/mockResult.js'

const env = import.meta.env || {}
const USE_MOCK = env.VITE_USE_MOCK !== 'false'
const API_URL = env.VITE_ANALYZE_API_URL

export const isMockAnalysisMode = USE_MOCK || !API_URL

export async function analyzeQuotes(files) {
  if (isMockAnalysisMode) {
    return structuredClone(mockResult)
  }

  const formData = new FormData()
  files.forEach((item) => {
    formData.append('files', item.file, item.name)
  })

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: formData,
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data?.message || `AI 接口请求失败：HTTP ${response.status}`)
    }

    if (!data?.success) {
      throw new Error(data?.message || '真实 AI 分析失败')
    }

    return data
  } catch (error) {
    console.error('真实 AI 分析失败。', error)
    throw error
  }
}
