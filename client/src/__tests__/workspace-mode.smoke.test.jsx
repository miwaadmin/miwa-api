import {
  effectiveWorkspaceMode,
  isAgencyCompanionMode,
} from '../lib/workspaceMode'

describe('workspace mode credential gates', () => {
  it('keeps licensed clinicians in the private-practice experience even if stale data says agency companion', () => {
    const therapist = {
      credential_type: 'licensed',
      workspace_mode: 'agency_companion',
    }

    expect(effectiveWorkspaceMode(therapist)).toBe('private_practice')
    expect(isAgencyCompanionMode(therapist)).toBe(false)
  })

  it('allows trainees and associates to use agency companion mode', () => {
    expect(isAgencyCompanionMode({
      credential_type: 'trainee',
      workspace_mode: 'agency_companion',
    })).toBe(true)
    expect(isAgencyCompanionMode({
      credential_type: 'associate',
      workspace_mode: 'agency_companion',
    })).toBe(true)
  })
})
