import { MiwaLogo } from '../Sidebar'
import WizardProgress from './WizardProgress'

// Full-page wrapper for the trainee onboarding wizard. The Sidebar/Layout's
// floating chat and tour overlays are suppressed because WizardLayout renders
// outside of the standard Layout chrome (see App.jsx routing for /t/welcome).
//
// The background uses a softer version of the trainee dashboard hero gradient
// so the wizard feels like the same product, not a popover modal.
export default function WizardLayout({
  step,
  totalSteps = 5,
  skippedSteps = [],
  children,
}) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background:
          'linear-gradient(135deg, #2a228a 0%, #1c1660 45%, #0f4f48 100%)',
      }}
    >
      <header className="px-6 sm:px-10 pt-6 pb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <MiwaLogo size={36} />
          <span className="text-white/80 text-sm font-semibold tracking-wide">Miwa · Trainee</span>
        </div>
        <WizardProgress total={totalSteps} currentStep={step} skippedSteps={skippedSteps} />
      </header>

      <main className="flex-1 flex items-start justify-center px-4 sm:px-6 pb-12">
        <div className="w-full max-w-2xl mt-6 sm:mt-10">{children}</div>
      </main>

      <footer className="px-6 sm:px-10 py-4 text-center text-white/40 text-xs">
        Miwa is your AI clinical workspace. Your agency's EHR remains the official record.
      </footer>
    </div>
  )
}
