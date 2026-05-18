import { screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import Sidebar from '../components/Sidebar'
import { renderWithProviders } from '../test/renderWithProviders'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    therapist: {
      id: 44,
      credential_type: 'associate',
      associate_onboarding_step: 6,
      associate_onboarded_at: '2026-05-18T12:00:00Z',
      workspace_mode: 'private_practice',
    },
  }),
}))

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}))

describe('associate navigation smoke tests', () => {
  it('renders associate sidebar with one-word supported-independence nav', () => {
    renderWithProviders(<Sidebar />, { route: '/a/dashboard' })

    const nav = screen.getByRole('navigation')
    const labels = within(nav).getAllByRole('link').map(link => link.textContent.trim())

    expect(labels).toEqual([
      'Dashboard',
      'Workspace',
      'Clients',
      'Schedule',
      'Consult',
      'Brief',
      'Outcomes',
      'Apps',
      'Portal',
      'Hours',
      'Billing',
      'Resources',
      'Settings',
    ])
    expect(within(nav).queryByText('Supervision')).not.toBeInTheDocument()
  })
})
