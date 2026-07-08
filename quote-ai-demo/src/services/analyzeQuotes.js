import { mockResult } from '../data/mockResult.js'

const env = import.meta.env || {}
const USE_MOCK = env.VITE_USE_MOCK !== 'false'
const API_URL = env.VITE_ANALYZE_API_URL

export async function analyzeQuotes(files) {
  if (USE_MOCK || !API_URL) {
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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    if (!data?.success) {
      throw new Error(data?.message || '真实 AI 分析失败')
    }

    return data
  } catch (error) {
    console.warn('真实 AI 分析暂时不可用，已切换至演示数据。', error)
    return {
      ...structuredClone(mockResult),
      summary: `真实 AI 分析暂时不可用，已切换至演示数据。${mockResult.summary}`,
    }
  }
}
