import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import ClinicianInvitePanel from '../components/ClinicianInvitePanel'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/server'

describe('clinician invite panel smoke tests', () => {
  it('lets a licensed clinician generate, copy, and revoke a portal invite code', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    let invites = []
    server.use(
      http.get('/api/client-invites', () => HttpResponse.json({ invites })),
      http.post('/api/client-invites', async () => {
        invites = [{
          id: 7,
          patient_id: 123,
          status: 'pending',
          code: 'MIWA-7K3X-9R2P',
          expires_at: '2026-05-27T12:00:00.000Z',
        }]
        return HttpResponse.json({ invite: invites[0] }, { status: 201 })
      }),
      http.delete('/api/client-invites/7', () => {
        invites = [{ ...invites[0], status: 'revoked' }]
        return HttpResponse.json({ invite: invites[0] })
      }),
    )

    renderWithProviders(<ClinicianInvitePanel patientId={123} patientName="Val Likoit" />)

    await user.click(await screen.findByTestId('invite-generate-button'))
    expect(await screen.findByTestId('invite-pending-state')).toBeInTheDocument()
    expect(screen.getByTestId('invite-code')).toHaveTextContent('MIWA-7K3X-9R2P')

    await user.click(screen.getByRole('button', { name: /copy code/i }))
    expect(writeText).toHaveBeenCalledWith('MIWA-7K3X-9R2P')

    await user.click(screen.getByRole('button', { name: /revoke/i }))
    await waitFor(() => {
      expect(screen.getByTestId('invite-generate-button')).toBeInTheDocument()
    })
  })
})
