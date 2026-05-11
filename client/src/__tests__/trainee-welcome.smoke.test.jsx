import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import TraineeWelcome from '../pages/trainee/TraineeWelcome'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/server'

const refreshTherapistMock = vi.fn()

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    therapist: {
      id: 42,
      first_name: 'Sam',
      full_name: 'Sam Patel',
      credential_type: 'trainee',
      onboarding_step: 0,
      created_at: '2026-05-09T00:00:00.000Z',
    },
    refreshTherapist: refreshTherapistMock,
  }),
}))

// MiwaLogo pulls in @capacitor/* via a deep import. Stub it for tests.
vi.mock('../components/Sidebar', () => ({
  MiwaLogo: () => <span data-testid="miwa-logo" />,
}))

function makeState(overrides = {}) {
  return {
    step: 0,
    completed: false,
    onboarded_at: null,
    skipped_steps: [],
    credential_type: 'trainee',
    data: {
      first_name: 'Sam',
      last_name: 'Patel',
      full_name: 'Sam Patel',
      school_email: null,
      school_email_verified: false,
      training_program: null,
      expected_graduation_year: null,
      supervisors: [],
    },
    ...overrides,
  }
}

describe('trainee onboarding wizard', () => {
  beforeEach(() => {
    refreshTherapistMock.mockClear()
  })

  it('renders screen 1 for a fresh trainee and gates Next on the acknowledgment', async () => {
    const user = userEvent.setup()
    let stepCalledWith = null

    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState())),
      http.put('/api/onboarding/step/1', async ({ request }) => {
        stepCalledWith = await request.json()
        return HttpResponse.json(makeState({ step: 1 }))
      }),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    expect(await screen.findByRole('heading', { name: /welcome to miwa, sam/i })).toBeInTheDocument()

    const nextButton = screen.getByRole('button', { name: /^next$/i })
    expect(nextButton).toBeDisabled()

    const ack = screen.getByRole('checkbox')
    await user.click(ack)
    expect(nextButton).not.toBeDisabled()

    await user.click(nextButton)
    await waitFor(() => expect(stepCalledWith).toEqual({ acknowledged: true }))
  })

  it('skips a screen and records the skip server-side', async () => {
    const user = userEvent.setup()
    let skipCalled = false

    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 1 }))),
      http.post('/api/onboarding/skip/2', () => {
        skipCalled = true
        return HttpResponse.json(makeState({ step: 2, skipped_steps: [2] }))
      }),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    // We're on screen 2 (step 1 saved → next screen index is 2)
    expect(await screen.findByRole('heading', { name: /tell us about your training/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /skip for now/i }))
    await waitFor(() => expect(skipCalled).toBe(true))
    // Wizard advances to the hours screen after skipping screen 2.
    expect(await screen.findByRole('heading', { name: /hours tracking/i })).toBeInTheDocument()
  })

  it('screen 5 offers real / sample / skip and completes the wizard on skip', async () => {
    const user = userEvent.setup()
    let stepFiveSaved = false
    let completed = false

    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 4 }))),
      http.put('/api/onboarding/step/5', () => {
        stepFiveSaved = true
        return HttpResponse.json(makeState({ step: 5 }))
      }),
      http.post('/api/onboarding/complete', () => {
        completed = true
        return HttpResponse.json(
          makeState({ step: 6, completed: true, onboarded_at: '2026-05-11T00:00:00.000Z' }),
        )
      }),
      http.get('/api/auth/me', () => HttpResponse.json({ id: 42, onboarding_step: 6 })),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    expect(await screen.findByRole('heading', { name: /add a case to start/i })).toBeInTheDocument()
    // All three case options are rendered as equally-weighted buttons.
    expect(screen.getByRole('button', { name: /add a real case/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use a sample case/i })).toBeInTheDocument()
    const skipButton = screen.getByRole('button', { name: /skip — i'll add a case later/i })

    await user.click(skipButton)
    await waitFor(() => expect(stepFiveSaved).toBe(true))
    await waitFor(() => expect(completed).toBe(true))
  })

  it('sample-case option calls the sample-case endpoint and completes the wizard', async () => {
    const user = userEvent.setup()
    let sampleCreated = false
    let completed = false

    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 4 }))),
      http.post('/api/onboarding/sample-case', () => {
        sampleCreated = true
        return HttpResponse.json({
          ok: true,
          patient: { id: 99, client_id: 'SXYZAB', display_name: 'Sample Client — M.G.', is_sample: 1 },
        })
      }),
      http.put('/api/onboarding/step/5', () => HttpResponse.json(makeState({ step: 5 }))),
      http.post('/api/onboarding/complete', () => {
        completed = true
        return HttpResponse.json(makeState({ step: 6, completed: true, onboarded_at: '2026-05-11T00:00:00.000Z' }))
      }),
      http.get('/api/auth/me', () => HttpResponse.json({ id: 42, onboarding_step: 6 })),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    expect(await screen.findByRole('heading', { name: /add a case to start/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /use a sample case/i }))
    await waitFor(() => expect(sampleCreated).toBe(true))
    await waitFor(() => expect(completed).toBe(true))
  })
})
