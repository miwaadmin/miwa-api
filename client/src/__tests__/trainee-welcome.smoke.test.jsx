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

  // ── Screen 2 — Introduce yourself to Miwa ────────────────────────────────

  it('screen 2 renders the intro text and question fields', async () => {
    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 1 }))),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    expect(await screen.findByRole('heading', { name: /introduce yourself to miwa/i })).toBeInTheDocument()
    // Intro blurb
    expect(screen.getByText(/the more miwa knows/i)).toBeInTheDocument()
    // At least one textarea from the 10-question form
    expect(screen.getByTestId('soul-q1')).toBeInTheDocument()
  })

  it('filling a textarea on screen 2 and clicking Next fires POST to /api/onboarding/soul', async () => {
    const user = userEvent.setup()
    let soulPosted = false
    let stepAdvanced = false

    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 1 }))),
      http.post('/api/onboarding/soul', async () => {
        soulPosted = true
        return HttpResponse.json({ ok: true, soul_markdown: '## Identity\nSam', message: 'Got it!' })
      }),
      http.put('/api/onboarding/step/2', async () => {
        stepAdvanced = true
        return HttpResponse.json(makeState({ step: 2 }))
      }),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    await screen.findByRole('heading', { name: /introduce yourself to miwa/i })

    // Type something in Q1
    await user.type(screen.getByTestId('soul-q1'), 'I want to help families heal.')

    // Click Next — advances immediately, soul POST is fire-and-forget
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    // step advance must happen
    await waitFor(() => expect(stepAdvanced).toBe(true))
    // soul post should have fired too (fire-and-forget but still fires)
    await waitFor(() => expect(soulPosted).toBe(true))
  })

  it('clicking Skip for now on screen 2 advances without posting to soul', async () => {
    const user = userEvent.setup()
    let soulPosted = false
    let skipCalled = false

    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 1 }))),
      http.post('/api/onboarding/soul', async () => {
        soulPosted = true
        return HttpResponse.json({ ok: true })
      }),
      http.post('/api/onboarding/skip/2', () => {
        skipCalled = true
        return HttpResponse.json(makeState({ step: 2, skipped_steps: [2] }))
      }),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    await screen.findByRole('heading', { name: /introduce yourself to miwa/i })

    await user.click(screen.getByRole('button', { name: /skip for now/i }))

    await waitFor(() => expect(skipCalled).toBe(true))
    // Soul endpoint must NOT have been called
    expect(soulPosted).toBe(false)
    // Advances to screen 3 — school + training
    expect(await screen.findByRole('heading', { name: /tell us about your training/i })).toBeInTheDocument()
  })

  it('Q5 documentation style button-group — clicking SOAP selects it', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 1 }))),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    await screen.findByRole('heading', { name: /introduce yourself to miwa/i })

    // The SOAP pill button should be present
    const soapButton = screen.getByRole('button', { name: /^soap$/i })
    expect(soapButton).toBeInTheDocument()

    // Click it — should gain selected styling (bg-indigo-600)
    await user.click(soapButton)

    // After click the same button is still in the DOM and the selection state
    // is reflected via className — test that the button is now "selected"
    // by confirming it has the indigo class applied.
    await waitFor(() =>
      expect(soapButton.className).toMatch(/bg-indigo-600/)
    )
  })

  // ── Existing screens (renumbered) ─────────────────────────────────────────

  it('skips screen 3 (school) and records the skip server-side', async () => {
    const user = userEvent.setup()
    let skipCalled = false

    server.use(
      // step 2 saved → next screen is 3 (school)
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 2 }))),
      http.post('/api/onboarding/skip/3', () => {
        skipCalled = true
        return HttpResponse.json(makeState({ step: 3, skipped_steps: [3] }))
      }),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    expect(await screen.findByRole('heading', { name: /tell us about your training/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /skip for now/i }))
    await waitFor(() => expect(skipCalled).toBe(true))
    // Wizard advances to screen 4 (hours tracking) after skipping screen 3.
    expect(await screen.findByRole('heading', { name: /hours tracking/i })).toBeInTheDocument()
  })

  it('screen 6 offers real / sample / skip and completes the wizard on skip', async () => {
    const user = userEvent.setup()
    let stepSixSaved = false
    let completed = false

    server.use(
      // step 5 saved → next screen is 6 (first case)
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 5 }))),
      http.put('/api/onboarding/step/6', () => {
        stepSixSaved = true
        return HttpResponse.json(makeState({ step: 6 }))
      }),
      http.post('/api/onboarding/complete', () => {
        completed = true
        return HttpResponse.json(
          makeState({ step: 7, completed: true, onboarded_at: '2026-05-14T00:00:00.000Z' }),
        )
      }),
      http.get('/api/auth/me', () => HttpResponse.json({ id: 42, onboarding_step: 7 })),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    expect(await screen.findByRole('heading', { name: /add a case to start/i })).toBeInTheDocument()
    // All three case options are rendered as equally-weighted buttons.
    expect(screen.getByRole('button', { name: /add a real case/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use a sample case/i })).toBeInTheDocument()
    const skipButton = screen.getByRole('button', { name: /skip — i'll add a case later/i })

    await user.click(skipButton)
    await waitFor(() => expect(stepSixSaved).toBe(true))
    await waitFor(() => expect(completed).toBe(true))
  })

  it('sample-case option calls the sample-case endpoint and completes the wizard', async () => {
    const user = userEvent.setup()
    let sampleCreated = false
    let completed = false

    server.use(
      http.get('/api/onboarding/state', () => HttpResponse.json(makeState({ step: 5 }))),
      http.post('/api/onboarding/sample-case', () => {
        sampleCreated = true
        return HttpResponse.json({
          ok: true,
          patient: { id: 99, client_id: 'SXYZAB', display_name: 'Sample Client — M.G.', is_sample: 1 },
        })
      }),
      http.put('/api/onboarding/step/6', () => HttpResponse.json(makeState({ step: 6 }))),
      http.post('/api/onboarding/complete', () => {
        completed = true
        return HttpResponse.json(makeState({ step: 7, completed: true, onboarded_at: '2026-05-14T00:00:00.000Z' }))
      }),
      http.get('/api/auth/me', () => HttpResponse.json({ id: 42, onboarding_step: 7 })),
    )

    renderWithProviders(<TraineeWelcome />, { route: '/t/welcome' })

    expect(await screen.findByRole('heading', { name: /add a case to start/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /use a sample case/i }))
    await waitFor(() => expect(sampleCreated).toBe(true))
    await waitFor(() => expect(completed).toBe(true))
  })
})
