import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const TourContext = createContext(null)

export const TOUR_STEPS = [
  {
    id: 'sidebar',
    target: '[data-tour="sidebar"]',
    title: 'Your Navigation',
    description: 'Access all features from the sidebar — your command center for patients, sessions, outcomes, and more.',
    placement: 'right',
  },
  {
    id: 'workspace',
    target: '[data-tour="workspace"]',
    title: 'Session Workspace',
    description: 'Dictate or type session recaps. Miwa generates SOAP, BIRP, DAP, or GIRP notes automatically.',
    placement: 'right',
  },
  {
    id: 'patients',
    target: '[data-tour="patients"]',
    title: 'Patient Records',
    description: 'Manage client profiles, view assessment history, and send SMS assessments directly.',
    placement: 'right',
  },
  {
    id: 'outcomes',
    target: '[data-tour="outcomes"]',
    title: 'Outcomes Dashboard',
    description: 'Track PHQ-9, GAD-7, and PCL-5 scores across your caseload. Spot trends and at-risk clients.',
    placement: 'right',
  },
  {
    id: 'schedule',
    target: '[data-tour="schedule"]',
    title: 'Schedule',
    description: 'View and manage your appointments in day or week view. Miwa can book sessions for you too.',
    placement: 'right',
  },
  {
    id: 'miwa-chat',
    target: '[data-tour="miwa-chat"]',
    title: 'Miwa — Your AI Copilot',
    description: 'Ask questions, search resources, send assessments, generate reports, or get help with anything in the app.',
    placement: 'left',
  },
]

export function TourProvider({ children }) {
  const [isTourActive, setIsTourActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [tourCompleted, setTourCompleted] = useState(() => {
    try { return localStorage.getItem('miwa_tour_completed') === 'true' } catch { return false }
  })

  const startTour = useCallback(() => {
    setCurrentStep(0)
    setIsTourActive(true)
  }, [])

  const nextStep = useCallback(() => {
    setCurrentStep(prev => {
      if (prev >= TOUR_STEPS.length - 1) {
        // Tour complete
        setIsTourActive(false)
        setTourCompleted(true)
        try { localStorage.setItem('miwa_tour_completed', 'true') } catch {}
        return 0
      }
      return prev + 1
    })
  }, [])

  const prevStep = useCallback(() => {
    setCurrentStep(prev => Math.max(0, prev - 1))
  }, [])

  const endTour = useCallback(() => {
    setIsTourActive(false)
    setTourCompleted(true)
    try { localStorage.setItem('miwa_tour_completed', 'true') } catch {}
  }, [])

  const skipTour = useCallback(() => {
    setIsTourActive(false)
  }, [])

  // Listen for external trigger (from MiwaChat etc.)
  useEffect(() => {
    const handler = () => startTour()
    window.addEventListener('miwa-start-tour', handler)
    return () => window.removeEventListener('miwa-start-tour', handler)
  }, [startTour])

  return (
    <TourContext.Provider value={{
      isTourActive,
      currentStep,
      tourCompleted,
      startTour,
      nextStep,
      prevStep,
      endTour,
      skipTour,
    }}>
      {children}
    </TourContext.Provider>
  )
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used inside TourProvider')
  return ctx
}
