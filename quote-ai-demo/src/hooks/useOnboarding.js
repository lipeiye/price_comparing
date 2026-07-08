import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'quote_ai_onboarding_done_v1'
const TOTAL_STEPS = 4

// 步骤 key → 目标元素的 data-onboarding 属性值
const STEP_TARGETS = [
  'upload-zone',     // 0：上传区域
  'analyze-button',  // 1：开始比价按钮
  'report-button',   // 2：深度报告按钮
  'export-buttons',  // 3：导出按钮
]

// 检查某一步的目标元素是否存在于 DOM 中
function resolveTarget(stepIndex) {
  const selector = `[data-onboarding="${STEP_TARGETS[stepIndex]}"]`
  return document.querySelector(selector)
}

export function useOnboarding() {
  const [active, setActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  // 页面加载后检查 localStorage，没有标记就自动弹出
  useEffect(() => {
    const done =
      typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true'
    if (!done) {
      // 延迟一小段时间，确保 DOM 已渲染
      const id = setTimeout(() => setActive(true), 600)
      return () => clearTimeout(id)
    }
  }, [])

  // 切换步骤时尝试滚动目标到视口中央，并重新计算遮罩位置
  useEffect(() => {
    if (!active) return
    const target = resolveTarget(currentStep)
    if (target) {
      // 先检测是否在视口内，不在再滚动
      const rect = target.getBoundingClientRect()
      const isInView =
        rect.top >= 0 && rect.bottom <= window.innerHeight
      if (!isInView) {
        target.scrollIntoView({ block: 'center', behavior: 'instant' })
      }
    }
  }, [active, currentStep])

  const start = useCallback(() => {
    setCurrentStep(0)
    setActive(true)
  }, [])

  const next = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS - 1))
  }, [])

  const prev = useCallback(() => {
    setCurrentStep((p) => Math.max(p - 1, 0))
  }, [])

  const finish = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setActive(false)
  }, [])

  // 跳过：也写入标记（符合"下次不再弹"的产品预期）。用户可通过 ? 按钮重放。
  const skip = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setActive(false)
  }, [])

  return {
    active,
    currentStep,
    totalSteps: TOTAL_STEPS,
    start,
    next,
    prev,
    finish,
    skip,
  }
}

export { STEP_TARGETS, resolveTarget }
