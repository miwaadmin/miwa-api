import { screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import Sidebar from '../components/Sidebar'
import { renderWithProviders } from '../test/renderWithProviders'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    therapist: {
      id: 99,
      credential_type: 'trainee',
      workspace_mode: 'agency_companion',
    },
  }),
}))

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}))

describe('trainee navigation smoke tests', () => {
  it('renders trainee sidebar in the signed-off order without Drafts or Transition', () => {
    renderWithProviders(<Sidebar />, { route: '/t/dashboard' })

    const nav = screen.getByRole('navigation')
    const labels = within(nav).getAllByRole('link').map(link => link.textContent.trim())

    expect(labels).toEqual([
      'Dashboard',
      'Session Workspace',
      'Consult',
      'Supervision',
      'Cases',
      'Hours',
      'Learning',
      'Resources',
    ])
    expect(within(nav).queryByText(/drafts/i)).not.toBeInTheDocument()
    expect(within(nav).queryByText(/transition/i)).not.toBeInTheDocument()
  })
})
