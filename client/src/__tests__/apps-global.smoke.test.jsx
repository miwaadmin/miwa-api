import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import Apps from '../pages/Apps'
import { server } from '../test/server'
import { renderWithProviders } from '../test/renderWithProviders'

const authState = vi.hoisted(() => ({
  therapist: { id: 1, credential_type: 'licensed' },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ therapist: authState.therapist }),
}))

describe('global Apps smoke tests', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/patients', () => HttpResponse.json([
        { id: 10, client_id: 'C10', display_name: 'Client Ten' },
      ])),
    )
  })

  it.each(['trainee', 'associate', 'licensed'])('lets %s clinicians access shared Apps', async (credentialType) => {
    authState.therapist = { id: 1, credential_type: credentialType }

    renderWithProviders(<Apps />, { route: '/apps' })

    expect(await screen.findByRole('heading', { name: 'Apps' })).toBeInTheDocument()
    expect(screen.getByText('Genogram')).toBeInTheDocument()
    expect(screen.getByText('Portal Readiness')).toBeInTheDocument()
  })
})
