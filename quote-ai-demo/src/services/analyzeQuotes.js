import cloudbase from '@cloudbase/js-sdk'
import { mockResult } from '../data/mockResult.js'

const env = import.meta.env || {}
const USE_MOCK = env.VITE_USE_MOCK !== 'false'
const API_URL = env.VITE_ANALYZE_API_URL
const CLOUDBASE_ENV_ID = env.VITE_CLOUDBASE_ENV_ID

let cloudbaseApp

export async function analyzeQuotes(files) {
  if (USE_MOCK || !API_URL) {
    if (!USE_MOCK && CLOUDBASE_ENV_ID) {
      return analyzeWithCloudFunction(files)
    }

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

async function analyzeWithCloudFunction(files) {
  try {
    const app = getCloudbaseApp()
    const cloudFiles = await Promise.all(files.map(fileToCloudPayload))
    const response = await app.callFunction({
      name: 'analyzeQuotes',
      data: {
        files: cloudFiles,
      },
    })

    const result = normalizeCloudFunctionResult(response.result)
    if (!result?.success) {
      throw new Error(result?.message || '真实 AI 分析失败')
    }

    return result
  } catch (error) {
    console.warn('真实 AI 分析暂时不可用，已切换至演示数据。', error)
    return {
      ...structuredClone(mockResult),
      summary: `真实 AI 分析暂时不可用，已切换至演示数据。${mockResult.summary}`,
    }
  }
}

function getCloudbaseApp() {
  if (!CLOUDBASE_ENV_ID) {
    throw new Error('缺少 VITE_CLOUDBASE_ENV_ID')
  }

  if (!cloudbaseApp) {
    cloudbaseApp = cloudbase.init({
      env: CLOUDBASE_ENV_ID,
    })
  }

  return cloudbaseApp
}

async function fileToCloudPayload(item) {
  return {
    filename: item.name,
    content: await fileToBase64(item.file),
    base64: true,
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function normalizeCloudFunctionResult(result) {
  if (result?.body && typeof result.body === 'string') {
    return JSON.parse(result.body)
  }

  return result
}
