import { useEffect, useState, useCallback } from 'react'
import { useTour, TOUR_STEPS } from '../context/TourContext'

export default function AppTour() {
  const { isTourActive, currentStep, nextStep, prevStep, skipTour } = useTour()
  const [rect, setRect] = useState(null)
  const [ready, setReady] = useState(false)

  const positionSpotlight = useCallback(() => {
    if (!isTourActive) return
    const step = TOUR_STEPS[currentStep]
    if (!step) return
    const el = document.querySelector(step.target)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      // Small delay for scroll to settle
      setTimeout(() => {
        setRect(el.getBoundingClientRect())
        setReady(true)
      }, 250)
    } else {
      setRect(null)
      setReady(true)
    }
  }, [isTourActive, currentStep])

  useEffect(() => {
    setReady(false)
    positionSpotlight()
  }, [positionSpotlight])

  // Re-position on resize
  useEffect(() => {
    if (!isTourActive) return
    const handler = () => positionSpotlight()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [isTourActive, positionSpotlight])

  // ESC to close
  useEffect(() => {
    if (!isTourActive) return
    const handler = (e) => {
      if (e.key === 'Escape') skipTour()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isTourActive, skipTour])

  if (!isTourActive || !ready) return null

  const step = TOUR_STEPS[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === TOUR_STEPS.length - 1
  const pad = 8

  // Calculate tooltip position
  const getTooltipStyle = () => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

    const tooltipWidth = 320
    const tooltipHeight = 220  // approximate height
    const tooltipGap = 16
    let placement = step.placement || 'right'
    const padding = 16

    // Check if preferred placement fits, otherwise adjust
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    // For bottom placement, check if it goes off-screen
    if (placement === 'bottom' && rect.bottom + tooltipGap + tooltipHeight > viewportHeight) {
      placement = 'top'  // Switch to top if bottom doesn't fit
    }
    // For top placement, check if it goes off-screen
    if (placement === 'top' && rect.top - tooltipGap - tooltipHeight < 0) {
      placement = 'right'  // Switch to right if top doesn't fit
    }

    if (placement === 'right') {
      const topPos = Math.max(padding, Math.min(
        rect.top + rect.height / 2 - tooltipHeight / 2,
        viewportHeight - tooltipHeight - padding
      ))
      let leftPos = rect.right + tooltipGap
      // Check if right side goes off-screen
      if (leftPos + tooltipWidth > viewportWidth - padding) {
        leftPos = Math.max(padding, rect.left - tooltipWidth - tooltipGap)
      }
      return {
        top: topPos,
        left: leftPos,
      }
    }
    if (placement === 'left') {
      const topPos = Math.max(padding, Math.min(
        rect.top + rect.height / 2 - tooltipHeight / 2,
        viewportHeight - tooltipHeight - padding
      ))
      const leftPos = Math.max(padding, rect.left - tooltipWidth - tooltipGap)
      return {
        top: topPos,
        left: leftPos,
      }
    }
    if (placement === 'top') {
      const topPos = Math.max(padding, rect.top - tooltipGap - tooltipHeight)
      const leftPos = Math.max(padding, Math.min(
        rect.left + rect.width / 2 - tooltipWidth / 2,
        viewportWidth - tooltipWidth - padding
      ))
      return {
        top: topPos,
        left: leftPos,
      }
    }
    // bottom (default)
    const leftPos = Math.max(padding, Math.min(
      rect.left + rect.width / 2 - tooltipWidth / 2,
      viewportWidth - tooltipWidth - padding
    ))
    return {
      top: rect.bottom + tooltipGap,
      left: leftPos,
    }
  }

  const tooltipStyle = getTooltipStyle()

  return (
    <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: 'auto' }}>
      {/* Click overlay to dismiss */}
      <div
        className="absolute inset-0"
        onClick={skipTour}
        style={{ background: 'transparent' }}
      />

      {/* Spotlight cutout */}
      {rect && (
        <div
          className="absolute rounded-xl transition-all duration-300 ease-out"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="absolute w-80 rounded-2xl p-5 shadow-2xl border border-white/10 transition-all duration-300 ease-out"
        style={{
          ...tooltipStyle,
          background: 'linear-gradient(135deg, #1a1456 0%, #0f0c22 100%)',
          zIndex: 2,
          pointerEvents: 'auto',
        }}
      >
        {/* Step indicator dots */}
        <div className="flex items-center gap-1.5 mb-3">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all duration-200"
              style={{
                width: i === currentStep ? 20 : 6,
                background: i === currentStep
                  ? 'linear-gradient(90deg, #6047EE, #2dd4bf)'
                  : i < currentStep
                    ? 'rgba(96,71,238,0.4)'
                    : 'rgba(255,255,255,0.1)',
              }}
            />
          ))}
          <span className="text-[10px] text-white/30 ml-auto">
            {currentStep + 1} / {TOUR_STEPS.length}
          </span>
        </div>

        <h3 className="text-base font-bold text-white mb-1.5">{step.title}</h3>
        <p className="text-sm text-white/55 leading-relaxed mb-5">{step.description}</p>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between">
          <button
            onClick={skipTour}
            className="text-xs text-white/30 hover:text-white/55 transition-colors font-medium"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {!isFirst && (
              <button
                onClick={prevStep}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white border border-white/10 hover:border-white/20 transition-all"
              >
                Back
              </button>
            )}
            <button
              onClick={nextStep}
              className="px-4 py-1.5 rounded-lg text-xs font-bold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #6047EE, #2dd4bf)' }}
            >
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
