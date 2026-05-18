import {
  effectiveWorkspaceMode,
  isAgencyCompanionMode,
  isAssociateCredential,
  isClinicianCredential,
  isPreLicensedCredential,
  isTraineeCredential,
  needsAssociateOnboarding,
  needsTraineeOnboarding,
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

  it('keeps associate mode distinct from trainee agency companion routing', () => {
    expect(isAgencyCompanionMode({
      credential_type: 'trainee',
      workspace_mode: 'agency_companion',
    })).toBe(true)
    expect(isAgencyCompanionMode({
      credential_type: 'associate',
      workspace_mode: 'agency_companion',
    })).toBe(false)
  })

  it('separates trainee, associate, pre-licensed, and clinician helpers', () => {
    const trainee = { credential_type: 'trainee', onboarding_step: 0 }
    const associate = { credential_type: 'associate', associate_onboarding_step: 0 }
    const licensed = { credential_type: 'licensed' }

    expect(isTraineeCredential(trainee)).toBe(true)
    expect(isTraineeCredential(associate)).toBe(false)
    expect(isAssociateCredential(associate)).toBe(true)
    expect(isPreLicensedCredential(trainee)).toBe(true)
    expect(isPreLicensedCredential(associate)).toBe(true)
    expect(isClinicianCredential(associate)).toBe(true)
    expect(isClinicianCredential(licensed)).toBe(true)
    expect(needsTraineeOnboarding(associate)).toBe(false)
    expect(needsAssociateOnboarding(associate)).toBe(true)
  })
})
