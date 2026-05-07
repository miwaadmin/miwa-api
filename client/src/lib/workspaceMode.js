export function effectiveWorkspaceMode(therapist) {
  if (therapist?.workspace_mode) return therapist.workspace_mode
  if (therapist?.credential_type === 'trainee') return 'agency_companion'
  return 'private_practice'
}

export function isAgencyCompanionMode(therapist) {
  return effectiveWorkspaceMode(therapist) === 'agency_companion'
}

export function needsWorkspaceModeOnboarding(therapist) {
  if (!therapist) return false
  return !therapist.workspace_mode_selected_at && !therapist.workspace_mode
}
