// Trainee primitive — top-of-wizard progress indicator. Renders `total` dots,
// with steps <= currentStep filled. Skipped steps render as a dashed outline so
// the trainee can see at a glance what they bypassed.
export default function WizardProgress({ total, currentStep, skippedSteps = [] }) {
  const skipped = new Set(Array.isArray(skippedSteps) ? skippedSteps : [])
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${currentStep} of ${total}`}>
      {Array.from({ length: total }).map((_, idx) => {
        const stepNum = idx + 1
        const done = stepNum < currentStep
        const active = stepNum === currentStep
        const wasSkipped = skipped.has(stepNum)
        const base = 'h-2 rounded-full transition-all'
        let cls
        if (active) {
          cls = `${base} w-10 bg-white shadow-[0_0_8px_rgba(255,255,255,0.45)]`
        } else if (done) {
          cls = wasSkipped
            ? `${base} w-6 border border-dashed border-white/60 bg-transparent`
            : `${base} w-6 bg-white/85`
        } else {
          cls = `${base} w-6 bg-white/25`
        }
        return <span key={stepNum} className={cls} />
      })}
      <span className="ml-3 text-xs uppercase tracking-widest text-white/80 font-semibold">
        Step {currentStep} of {total}
      </span>
    </div>
  )
}
