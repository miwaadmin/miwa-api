import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { ClientRedeem } from '../pages/client/ClientPortalPages'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/server'

const clientAuth = vi.hoisted(() => ({
  login: vi.fn(),
}))

vi.mock('../context/ClientAuthContext', () => ({
  useClientAuth: () => ({ login: clientAuth.login }),
}))

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

describe('client invite redeem smoke tests', () => {
  beforeEach(() => {
    clientAuth.login.mockClear()
    navigateMock.mockClear()
  })

  it('formats the invite code while typing and blocks malformed codes', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ClientRedeem />, { route: '/portal/redeem' })

    const code = screen.getByTestId('redeem-code-input')
    await user.type(code, 'miwa7k3x9r2p')
    expect(code).toHaveValue('MIWA-7K3X-9R2P')

    await user.clear(code)
    await user.type(code, 'bad')
    expect(screen.getByTestId('redeem-submit')).toBeDisabled()
  })

  it('shows server errors for invalid, expired, or claimed codes', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/client-auth/redeem', () => HttpResponse.json({
        error: 'Invalid or expired code. Ask your clinician for a new one.',
      }, { status: 410 })),
    )

    renderWithProviders(<ClientRedeem />, { route: '/portal/redeem' })
    await user.type(screen.getByTestId('redeem-code-input'), 'MIWA-7K3X-9R2P')
    await user.type(screen.getByLabelText(/first name/i), 'Portal')
    await user.type(screen.getByLabelText(/last name/i), 'Client')
    await user.type(screen.getByLabelText(/email/i), 'portal@example.test')
    await user.type(screen.getByLabelText(/password/i), 'client-password-1234')
    await user.click(screen.getByTestId('redeem-submit'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or expired code/i)
  })

  it('logs the client in and redirects after a successful redeem', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/client-auth/redeem', () => HttpResponse.json({
        token: 'client-token',
        client: { id: 44, patient_id: 12, email: 'portal@example.test' },
      })),
    )

    renderWithProviders(<ClientRedeem />, { route: '/portal/redeem' })
    await user.type(screen.getByTestId('redeem-code-input'), 'MIWA-7K3X-9R2P')
    await user.type(screen.getByLabelText(/first name/i), 'Portal')
    await user.type(screen.getByLabelText(/last name/i), 'Client')
    await user.type(screen.getByLabelText(/email/i), 'portal@example.test')
    await user.type(screen.getByLabelText(/password/i), 'client-password-1234')
    await user.click(screen.getByTestId('redeem-submit'))

    await waitFor(() => {
      expect(clientAuth.login).toHaveBeenCalledWith(
        'client-token',
        expect.objectContaining({ patient_id: 12 }),
      )
      expect(navigateMock).toHaveBeenCalledWith('/client/home', { replace: true })
    })
  })
})
