import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Login from '../pages/Login'
import Register from '../pages/Register'
import ForgotPassword from '../pages/ForgotPassword'
import VerifyEmail from '../pages/VerifyEmail'
import { server } from '../test/server'

const loginMock = vi.fn()
let authState = {
  therapist: null,
  login: loginMock,
}

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}))

function renderWithRoutes(ui, initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={initialPath} element={ui} />
        <Route path="/dashboard" element={<div>Dashboard reached</div>} />
        <Route path="/login" element={<div>Login route</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('auth smoke tests', () => {
  beforeEach(() => {
    loginMock.mockClear()
    authState = {
      therapist: null,
      login: loginMock,
    }
  })

  it('logs in with entered credentials and navigates to the dashboard', async () => {
    const user = userEvent.setup()
    let capturedBody

    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({
          token: 'test-token',
          therapist: { id: 1, email: 'clinician@example.com' },
        })
      })
    )

    renderWithRoutes(<Login />, '/login')

    await user.type(screen.getByLabelText(/email/i), 'clinician@example.com')
    await user.type(screen.getByLabelText(/password/i), 'correct-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await screen.findByText('Dashboard reached')
    expect(capturedBody).toEqual({
      email: 'clinician@example.com',
      password: 'correct-password',
    })
    expect(loginMock).toHaveBeenCalledWith('test-token', { id: 1, email: 'clinician@example.com' })
  })

  it('shows a login error on failed credentials', async () => {
    const user = userEvent.setup()

    server.use(
      http.post('/api/auth/login', () => (
        HttpResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
      ))
    )

    renderWithRoutes(<Login />, '/login')

    await user.type(screen.getByLabelText(/email/i), 'clinician@example.com')
    await user.type(screen.getByLabelText(/password/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument()
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('registers a clinician and shows the email verification success state', async () => {
    const user = userEvent.setup()
    let capturedBody

    server.use(
      http.post('/api/auth/register', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true })
      })
    )

    renderWithRoutes(<Register />, '/register')

    await user.click(screen.getByRole('button', { name: /licensed therapist/i }))
    await user.type(screen.getByLabelText(/first name/i), 'Jane')
    await user.type(screen.getByLabelText(/last name/i), 'Smith')
    await user.type(screen.getByLabelText(/^email$/i), 'jane@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.type(screen.getByLabelText(/confirm/i), 'password123')
    await user.type(screen.getByLabelText(/license number/i), 'LMFT12345')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(capturedBody).toMatchObject({
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'jane@example.com',
      password: 'password123',
      credential_type: 'licensed',
      credential_number: 'LMFT12345',
    })
  })

  it('verifies email and can redirect after auth state flips without a hook-order crash', async () => {
    server.use(
      http.post('/api/auth/verify-email', () => (
        HttpResponse.json({
          token: 'verified-token',
          therapist: { id: 2, email: 'verified@example.com', credential_type: 'licensed' },
        })
      ))
    )

    const tree = (
      <MemoryRouter initialEntries={['/verify-email?token=abc123']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/dashboard" element={<div>Dashboard reached</div>} />
        </Routes>
      </MemoryRouter>
    )
    const view = render(tree)

    await screen.findByText('Email verified')
    expect(loginMock).toHaveBeenCalledWith('verified-token', expect.objectContaining({ email: 'verified@example.com' }))

    authState = {
      therapist: { id: 2, email: 'verified@example.com', credential_type: 'licensed' },
      login: loginMock,
    }
    expect(() => view.rerender(tree)).not.toThrow()
  })

  it('shows a registration error on a failed response', async () => {
    const user = userEvent.setup()

    server.use(
      http.post('/api/auth/register', () => (
        HttpResponse.json({ error: 'Email already registered' }, { status: 409 })
      ))
    )

    renderWithRoutes(<Register />, '/register')

    await user.click(screen.getByRole('button', { name: /licensed therapist/i }))
    await user.type(screen.getByLabelText(/first name/i), 'Jane')
    await user.type(screen.getByLabelText(/last name/i), 'Smith')
    await user.type(screen.getByLabelText(/^email$/i), 'jane@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.type(screen.getByLabelText(/confirm/i), 'password123')
    await user.type(screen.getByLabelText(/license number/i), 'LMFT12345')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Email already registered')).toBeInTheDocument()
  })

  it('sends a forgot-password request and shows the success state', async () => {
    const user = userEvent.setup()
    let capturedBody

    server.use(
      http.post('/api/auth/forgot-password', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true })
      })
    )

    renderWithRoutes(<ForgotPassword />, '/forgot-password')

    await user.type(screen.getByLabelText(/email address/i), 'clinician@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(capturedBody).toEqual({ email: 'clinician@example.com' })
  })

  it('shows a forgot-password error on a failed response', async () => {
    const user = userEvent.setup()

    server.use(
      http.post('/api/auth/forgot-password', () => (
        HttpResponse.json({ error: 'Unable to send reset link' }, { status: 500 })
      ))
    )

    renderWithRoutes(<ForgotPassword />, '/forgot-password')

    await user.type(screen.getByLabelText(/email address/i), 'clinician@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByText('Unable to send reset link')).toBeInTheDocument()
    })
  })
})
