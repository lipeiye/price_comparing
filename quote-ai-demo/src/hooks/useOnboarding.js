import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'quote_ai_onboarding_done_v1'
const TOTAL_STEPS = 4

const STEP_TARGETS = [
  'upload-zone',
  'analyze-button',
  'report-button',
  'export-buttons',
]

export function resolveTarget(stepIndex) {
  const selector = `[data-onboarding="${STEP_TARGETS[stepIndex]}"]`
  return document.querySelector(selector)
}

// hasResult：快速比价是否已完成（步骤 3 的目标元素 report-button 是否已渲染）
export function useOnboarding({ hasResult } = {}) {
  const [active, setActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [waiting, setWaiting] = useState(false) // 前两步走完，等比价结果出来
  const hasResultRef = useRef(hasResult)
  hasResultRef.current = hasResult

  // 首次打开：没有 localStorage 标记就弹出引导
  useEffect(() => {
    const done =
      typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true'
    if (!done) {
      const id = setTimeout(() => setActive(true), 600)
      return () => clearTimeout(id)
    }
  }, [])

  // 等比价完成后自动从步骤 3 继续
  useEffect(() => {
    if (waiting && hasResult) {
      setWaiting(false)
      setCurrentStep(2)
      setActive(true)
    }
  }, [waiting, hasResult])

  // 切换步骤时尝试把目标滚到视口中央
  useEffect(() => {
    if (!active) return
    const target = resolveTarget(currentStep)
    if (target) {
      const rect = target.getBoundingClientRect()
      if (!(rect.top >= 0 && rect.bottom <= window.innerHeight)) {
        target.scrollIntoView({ block: 'center', behavior: 'instant' })
      }
    }
  }, [active, currentStep])

  const start = useCallback(() => {
    setWaiting(false)
    setCurrentStep(0)
    setActive(true)
  }, [])

  const next = useCallback(() => {
    setCurrentStep((prev) => {
      const nxt = prev + 1
      // 从步骤 1（0-indexed）进入步骤 2，再下一步就是步骤 3（index 2）
      // 如果比价还没跑，暂停引导，等比价完成自动恢复
      if (nxt === 2 && !hasResultRef.current) {
        setWaiting(true)
        setActive(false)
        return prev
      }
      return Math.min(nxt, TOTAL_STEPS - 1)
    })
  }, [])

  const prev = useCallback(() => {
    setCurrentStep((p) => Math.max(p - 1, 0))
  }, [])

  const finish = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setActive(false)
    setWaiting(false)
  }, [])

  const skip = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setActive(false)
    setWaiting(false)
  }, [])

  return {
    active,
    currentStep,
    totalSteps: TOTAL_STEPS,
    waiting,
    start,
    next,
    prev,
    finish,
    skip,
  }
}

export { STEP_TARGETS }
