import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import Portal from '../pages/Portal'
import { server } from '../test/server'
import { renderWithProviders } from '../test/renderWithProviders'

const authState = vi.hoisted(() => ({
  therapist: { id: 1, credential_type: 'associate' },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ therapist: authState.therapist }),
}))

describe('portal surface smoke tests', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/patients', () => HttpResponse.json([
        { id: 22, client_id: 'C22', display_name: 'Portal Client' },
      ])),
    )
  })

  it('shows invite-code workflows for associates', async () => {
    authState.therapist = { id: 1, credential_type: 'associate' }
    renderWithProviders(<Portal />, { route: '/portal' })

    expect(await screen.findByRole('heading', { name: 'Portal' })).toBeInTheDocument()
    expect(screen.getByText(/open chart to generate or review invite code/i)).toBeInTheDocument()
  })

  it('keeps trainees on Apps and Portal but blocks invite-code generation copy', async () => {
    authState.therapist = { id: 2, credential_type: 'trainee' }
    renderWithProviders(<Portal />, { route: '/portal' })

    expect(await screen.findByText(/portal access is available for trainee mode/i)).toBeInTheDocument()
    expect(screen.getByText(/trainees remain blocked from invite-code generation/i)).toBeInTheDocument()
  })
})
