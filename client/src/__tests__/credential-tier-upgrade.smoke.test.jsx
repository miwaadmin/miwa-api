import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import Settings from '../pages/Settings'
import { server } from '../test/server'
import { renderWithProviders } from '../test/renderWithProviders'

const assignMock = vi.fn()

const authState = vi.hoisted(() => ({
  therapist: {
    id: 1,
    email: 'trainee@example.test',
    credential_type: 'trainee',
    full_name: 'Trainee Tester',
  },
  refreshTherapist: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}))

vi.mock('../context/TourContext', () => ({
  useTour: () => ({ startTour: vi.fn(), tourCompleted: false }),
}))

describe('credential tier upgrade settings smoke test', () => {
  beforeEach(() => {
    assignMock.mockClear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignMock },
    })
    server.use(
      http.get('/api/settings', () => HttpResponse.json({
        credential_type: 'trainee',
        user_role: 'trainee',
        referral_code: 'MIWA-TEST',
      })),
      http.post('/api/billing/upgrade', async ({ request }) => {
        const body = await request.json()
        expect(body.plan).toBe('associate')
        expect(body.returnTo).toBe('/settings')
        return HttpResponse.json({ url: 'https://billing.stripe.test/portal' })
      }),
    )
  })

  it('renders tier cards and routes associate upgrades through confirmation', async () => {
    renderWithProviders(<Settings />, { route: '/settings' })

    expect(await screen.findByText(/Trainee \/ practicum/i)).toBeInTheDocument()
    expect(screen.getByText(/Associate \/ registered intern/i)).toBeInTheDocument()
    expect(screen.getByText(/Current/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /upgrade to associate/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/starts a 14-day trial/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }))

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith('https://billing.stripe.test/portal')
    })
  })
})
