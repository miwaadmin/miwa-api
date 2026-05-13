import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import ForgotPassword from '../pages/ForgotPassword'
import ResetPassword from '../pages/ResetPassword'
import { server } from '../test/server'

function renderAt(ui, route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {ui}
    </MemoryRouter>,
  )
}

describe('forgot password smoke tests', () => {
  it('validates email input before submitting the forgot-password form', () => {
    renderAt(<ForgotPassword />, '/forgot-password')

    const email = screen.getByLabelText(/email address/i)
    expect(email).toBeRequired()
    expect(email).toHaveAttribute('type', 'email')
  })

  it('submits forgot-password requests and shows confirmation state', async () => {
    const user = userEvent.setup()
    let capturedBody

    server.use(
      http.post('/api/auth/forgot-password', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )

    renderAt(<ForgotPassword />, '/forgot-password')
    await user.type(screen.getByLabelText(/email address/i), 'clinician@example.test')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(screen.getByText(/clinician@example\.test/i)).toBeInTheDocument()
    expect(capturedBody).toEqual({ email: 'clinician@example.test' })
  })

  it('renders forgot-password backend errors', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/forgot-password', () => (
        HttpResponse.json({ error: 'Unable to send reset link' }, { status: 500 })
      )),
    )

    renderAt(<ForgotPassword />, '/forgot-password')
    await user.type(screen.getByLabelText(/email address/i), 'clinician@example.test')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByText('Unable to send reset link')).toBeInTheDocument()
  })

  it('validates and submits the reset-password form with the token', async () => {
    const user = userEvent.setup()
    let capturedBody

    server.use(
      http.post('/api/auth/reset-password', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true, message: 'Password updated successfully.' })
      }),
    )

    renderAt(<ResetPassword />, '/reset-password?token=reset-token-123')

    const [password, confirm] = screen.getAllByDisplayValue('')
    await user.type(password, 'short')
    await user.type(confirm, 'different')
    await user.click(screen.getByRole('button', { name: /update password/i }))
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()

    await user.clear(password)
    await user.clear(confirm)
    await user.type(password, 'new-password-1234')
    await user.type(confirm, 'new-password-1234')
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(await screen.findByText('Password updated!')).toBeInTheDocument()
    await waitFor(() => {
      expect(capturedBody).toEqual({
        token: 'reset-token-123',
        password: 'new-password-1234',
      })
    })
  })

  it('renders reset-password backend errors', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/reset-password', () => (
        HttpResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 })
      )),
    )

    renderAt(<ResetPassword />, '/reset-password?token=expired-token')
    const [password, confirm] = screen.getAllByDisplayValue('')
    await user.type(password, 'new-password-1234')
    await user.type(confirm, 'new-password-1234')
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(await screen.findByText('This reset link is invalid or has expired.')).toBeInTheDocument()
  })
})
