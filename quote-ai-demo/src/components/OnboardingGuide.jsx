import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from 'lucide-react'
import { useOnboarding, STEP_TARGETS, resolveTarget } from '../hooks/useOnboarding.js'

// 每一步的内容定义
const STEPS = [
  {
    title: '上传供应商报价单',
    body: '拖拽或点击上传 2–3 份 XLSX 文件，单份不超过 10 MB。系统会自动解析表格内容，保留全部工作表和列。',
  },
  {
    title: '一键比价',
    body: '上传完成后点击这里。系统自动对齐各家的项目号、计算最低价、检测漏报和量级异常。大约 30 秒。',
  },
  {
    title: '深度分析报告',
    body: '比价表出来后，可以继续点这里调用更强的模型，输出七章多维分析报告——规格逐项核对、成本拆解、谈判建议。',
  },
  {
    title: '导出报告',
    body: '深度报告生成后，可导出为 Word 文档（支持二次编辑、盖章），或直接打印 PDF。',
  },
]

// 定位策略：优先用 data-onboarding 属性，回退到特定选择器
function getTargetRect(stepIndex) {
  const target = resolveTarget(stepIndex)
  if (target) return target.getBoundingClientRect()

  // 步骤 2（报告按钮）和步骤 3（导出按钮）可能尚未渲染
  // 回退到页面中央，显示占位提示
  if (stepIndex === 2 || stepIndex === 3) {
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    return {
      left: cx - 140,
      top: cy - 20,
      width: 280,
      height: 40,
      right: cx + 140,
      bottom: cy + 20,
    }
  }

  return null
}

// 判断当前步骤目标是否存在
function isTargetPresent(stepIndex) {
  return resolveTarget(stepIndex) !== null
}

export default function OnboardingGuide() {
  const { active, currentStep, totalSteps, next, prev, finish, skip, start } = useOnboarding()
  const [rect, setRect] = useState(null)
  const rafRef = useRef(null)

  // 监听 resize 和 scroll，实时更新高亮框位置
  useEffect(() => {
    if (!active) {
      setRect(null)
      return undefined
    }

    function update() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const r = getTargetRect(currentStep)
        if (r) setRect(r)
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [active, currentStep])

  const targetPresent = isTargetPresent(currentStep)
  const step = STEPS[currentStep]
  const isLast = currentStep === totalSteps - 1

  // 遮罩四个矩形的样式：围绕目标区域留出窗口
  function maskStyle(side) {
    if (!rect) return { display: 'none' }
    const pad = 6 // 窗口内边距，让高亮框比目标略大
    switch (side) {
      case 'top':
        return { top: 0, left: 0, right: 0, height: Math.max(0, rect.top - pad) }
      case 'bottom':
        return { top: rect.bottom + pad, left: 0, right: 0, bottom: 0 }
      case 'left':
        return { top: Math.max(0, rect.top - pad), left: 0, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 }
      case 'right':
        return { top: Math.max(0, rect.top - pad), left: rect.right + pad, right: 0, height: rect.height + pad * 2 }
      default:
        return {}
    }
  }

  const tooltipSide = getTooltipSide(rect)

  const content = (
    <>
      {/* 遮罩层 */}
      {active && rect ? (
        <div className="onboard-overlay">
          <div className="onboard-mask" style={maskStyle('top')} />
          <div className="onboard-mask" style={maskStyle('bottom')} />
          <div className="onboard-mask" style={maskStyle('left')} />
          <div className="onboard-mask" style={maskStyle('right')} />
          {/* 高亮边框 */}
          <div
            className="onboard-highlight"
            style={{
              left: rect.left - 6,
              top: rect.top - 6,
              width: rect.width + 12,
              height: rect.height + 12,
            }}
          />
        </div>
      ) : null}

      {/* 气泡卡片 */}
      {active && rect ? (
        <div
          className={`onboard-tooltip onboard-tooltip--${tooltipSide}`}
          style={tooltipPosition(rect, tooltipSide)}
        >
          <div className="onboard-tooltip-step">
            {currentStep + 1} / {totalSteps}
          </div>
          <h3 className="onboard-tooltip-title">{step.title}</h3>
          <p className="onboard-tooltip-body">
            {!targetPresent && (currentStep === 2 || currentStep === 3)
              ? `比价完成后，你就可以在这里看到${currentStep === 2 ? '深度报告生成入口' : '导出按钮'}。现在先继续往下看。`
              : step.body}
          </p>
          <div className="onboard-tooltip-actions">
            <button type="button" className="onboard-btn onboard-btn--skip" onClick={skip}>
              跳过
            </button>
            <div className="onboard-tooltip-nav">
              {currentStep > 0 ? (
                <button type="button" className="onboard-btn onboard-btn--prev" onClick={prev}>
                  上一步
                </button>
              ) : null}
              {isLast ? (
                <button type="button" className="onboard-btn onboard-btn--primary" onClick={finish}>
                  知道了
                </button>
              ) : (
                <button type="button" className="onboard-btn onboard-btn--primary" onClick={next}>
                  下一步
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* 右下角重放按钮：引导完成后常驻 */}
      {!active ? (
        <button
          type="button"
          className="onboard-replay"
          onClick={start}
          title="查看使用指引"
          aria-label="查看使用指引"
        >
          <CircleHelp size={20} />
        </button>
      ) : null}
    </>
  )

  return createPortal(content, document.body)
}

// 判断气泡放在目标的哪一侧（上/下/左/右），优先放下方
function getTooltipSide(rect) {
  if (!rect) return 'bottom'
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  const tooltipH = 260
  if (spaceBelow >= tooltipH + 20) return 'bottom'
  if (spaceAbove >= tooltipH + 20) return 'top'
  if (rect.left > window.innerWidth / 2) return 'left'
  return 'right'
}

function tooltipPosition(rect, side) {
  const gap = 16
  switch (side) {
    case 'bottom':
      return { left: rect.left, top: rect.bottom + gap }
    case 'top':
      return { left: rect.left, bottom: window.innerHeight - rect.top + gap }
    case 'left':
      return { right: window.innerWidth - rect.left + gap, top: rect.top }
    case 'right':
      return { left: rect.right + gap, top: rect.top }
    default:
      return { left: rect.left, top: rect.bottom + gap }
  }
}
