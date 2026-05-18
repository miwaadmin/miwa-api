export function isTraineeCredential(therapist) {
  return therapist?.credential_type === 'trainee'
}

export function isAssociateCredential(therapist) {
  return therapist?.credential_type === 'associate'
}

export function isLicensedCredential(therapist) {
  return therapist?.credential_type === 'licensed'
}

export function isPreLicensedCredential(therapist) {
  return isTraineeCredential(therapist) || isAssociateCredential(therapist)
}

export function isClinicianCredential(therapist) {
  return isAssociateCredential(therapist) || isLicensedCredential(therapist)
}

export function effectiveWorkspaceMode(therapist) {
  if (isPreLicensedCredential(therapist)) {
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

// Trainee onboarding wizard gating - the 6-screen flow at /t/welcome.
// Associates have a separate supported-independence setup at /a/welcome.
const TRAINEE_ONBOARDING_COMPLETE_STEP = 7
const ASSOCIATE_ONBOARDING_COMPLETE_STEP = 6

export function needsTraineeOnboarding(therapist) {
  if (!therapist) return false
  if (!isTraineeCredential(therapist)) return false
  const step = typeof therapist.onboarding_step === 'number' ? therapist.onboarding_step : 0
  if (therapist.onboarded_at) return false
  return step < TRAINEE_ONBOARDING_COMPLETE_STEP
}

export function needsAssociateOnboarding(therapist) {
  if (!therapist) return false
  if (!isAssociateCredential(therapist)) return false
  const step = typeof therapist.associate_onboarding_step === 'number'
    ? therapist.associate_onboarding_step
    : 0
  if (therapist.associate_onboarded_at) return false
  return step < ASSOCIATE_ONBOARDING_COMPLETE_STEP
}
