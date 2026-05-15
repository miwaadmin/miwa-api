export function effectiveWorkspaceMode(therapist) {
  if (isTraineeCredential(therapist)) {
    if (therapist?.workspace_mode) return therapist.workspace_mode
    return 'agency_companion'
  }
  return 'private_practice'
}

export function isAgencyCompanionMode(therapist) {
  return isTraineeCredential(therapist) && effectiveWorkspaceMode(therapist) === 'agency_companion'
}

export function needsWorkspaceModeOnboarding(therapist) {
  if (!therapist) return false
  return !therapist.workspace_mode_selected_at && !therapist.workspace_mode
}

// Trainee onboarding wizard gating — the 6-screen flow at /t/welcome.
// Anyone with credential_type 'trainee' (or 'associate', treated as a trainee
// here per spec) whose onboarding_step hasn't reached the complete sentinel
// (7) should be sent through the wizard on next sign-in. See
// pages/trainee/TraineeWelcome.jsx.
const TRAINEE_ONBOARDING_COMPLETE_STEP = 7

export function isTraineeCredential(therapist) {
  const t = therapist?.credential_type
  return t === 'trainee' || t === 'associate'
}

export function needsTraineeOnboarding(therapist) {
  if (!therapist) return false
  if (!isTraineeCredential(therapist)) return false
  const step = typeof therapist.onboarding_step === 'number' ? therapist.onboarding_step : 0
  if (therapist.onboarded_at) return false
  return step < TRAINEE_ONBOARDING_COMPLETE_STEP
}
