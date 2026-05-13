import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Register from '../pages/Register'
import { server } from '../test/server'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    therapist: null,
    login: vi.fn(),
  }),
}))

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Register />
    </MemoryRouter>,
  )
}

function renderRegisterAt(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Register />
    </MemoryRouter>,
  )
}

async function submitTier(user, tierName, fields = {}) {
  await user.click(screen.getByRole('button', { name: tierName }))
  await user.type(screen.getByLabelText(/first name/i), fields.firstName || 'Jane')
  await user.type(screen.getByLabelText(/last name/i), fields.lastName || 'Smoke')
  await user.type(screen.getByLabelText(/^email$/i), fields.email)
  await user.type(screen.getByLabelText(/^password$/i), fields.password || 'password123')
  await user.type(screen.getByLabelText(/confirm/i), fields.password || 'password123')

  if (fields.credentialNumber) {
    await user.type(screen.getByLabelText(/license number|associate number/i), fields.credentialNumber)
  }
  if (fields.schoolEmail) {
    await user.type(screen.getByLabelText(/school email/i), fields.schoolEmail)
  }

  await user.click(screen.getByRole('button', { name: /create account/i }))
}

describe('register tier smoke tests', () => {
  it('renders the three current clinician tier options', () => {
    renderRegister()

    expect(screen.getByRole('button', { name: /trainee \/ intern/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /associate/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /licensed therapist/i })).toBeInTheDocument()
    expect(screen.queryByText(/group practice/i)).not.toBeInTheDocument()
  })

  it('opens directly to a tier form when pricing passes a tier param', () => {
    renderRegisterAt('/register?tier=associate')

    expect(screen.getByText(/associate .* free trial/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/associate number/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /trainee \/ intern/i })).not.toBeInTheDocument()
  })

  it.each([
    {
      label: /trainee \/ intern/i,
      email: 'trainee@example.test',
      expected: { credential_type: 'trainee', school_email: 'trainee@university.test' },
      fields: { schoolEmail: 'trainee@university.test' },
    },
    {
      label: /associate/i,
      email: 'associate@example.test',
      expected: { credential_type: 'associate', credential_number: 'AMFT123456' },
      fields: { credentialNumber: 'AMFT123456' },
    },
    {
      label: /licensed therapist/i,
      email: 'licensed@example.test',
      expected: { credential_type: 'licensed', credential_number: 'LMFT123456' },
      fields: { credentialNumber: 'LMFT123456' },
    },
  ])('submits the correct credential payload for $expected.credential_type', async ({ label, email, expected, fields }) => {
    const user = userEvent.setup()
    let capturedBody

    server.use(
      http.post('/api/auth/register', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({
          ok: true,
          pendingVerification: true,
          message: 'Check your email.',
        })
      }),
    )

    renderRegister()
    await submitTier(user, label, { email, ...fields })

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(capturedBody).toMatchObject({
      first_name: 'Jane',
      last_name: 'Smoke',
      email,
      password: 'password123',
      ...expected,
    })
  })

  it('shows client-side validation before posting incomplete tier forms', async () => {
    const user = userEvent.setup()
    const registerMock = vi.fn()
    server.use(http.post('/api/auth/register', registerMock))

    renderRegister()
    await user.click(screen.getByRole('button', { name: /licensed therapist/i }))
    await user.type(screen.getByLabelText(/first name/i), 'Jane')
    await user.type(screen.getByLabelText(/last name/i), 'Smoke')
    await user.type(screen.getByLabelText(/^email$/i), 'licensed@example.test')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.type(screen.getByLabelText(/confirm/i), 'different123')
    await user.type(screen.getByLabelText(/license number/i), 'LMFT123456')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('renders backend validation errors from registration', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/register', () => (
        HttpResponse.json({ error: 'School or program email is required for trainee accounts.' }, { status: 400 })
      )),
    )

    renderRegister()
    await submitTier(user, /trainee \/ intern/i, {
      email: 'trainee-error@example.test',
      schoolEmail: 'trainee@university.test',
    })

    expect(await screen.findByText('School or program email is required for trainee accounts.')).toBeInTheDocument()
  })
})
