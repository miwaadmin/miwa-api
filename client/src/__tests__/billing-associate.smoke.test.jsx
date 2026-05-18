import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import Billing from '../pages/Billing'
import { server } from '../test/server'
import { renderWithProviders } from '../test/renderWithProviders'

const authState = vi.hoisted(() => ({
  therapist: { id: 1, email: 'clinician@example.test', credential_type: 'associate' },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ therapist: authState.therapist }),
}))

function mockBilling({ eligible }) {
  server.use(
    http.get('/api/billing/status', () => HttpResponse.json({
      is_active: true,
      subscription_status: 'active',
      subscription_tier: authState.therapist.credential_type === 'licensed' ? 'solo' : 'associate',
      workspace_uses: 0,
      trial_limit: 10,
      trial_remaining: 10,
    })),
    http.get('/api/billing/client-payments/status', () => HttpResponse.json({
      eligibility: eligible
        ? { eligible: true, reason: 'Licensed clinician billing is eligible.' }
        : { eligible: false, reason: 'Associate accounts cannot connect their own Stripe account or collect client payments directly.' },
      connect: { status: 'not_connected', charges_enabled: false, payouts_enabled: false },
      settings: {},
    })),
    http.get('/api/billing/client-payments/invoices', () => HttpResponse.json([])),
    http.get('/api/patients', () => HttpResponse.json([])),
  )
}

describe('billing credential gating smoke tests', () => {
  it('shows associate payment restriction and readiness guidance without Stripe client payment controls', async () => {
    authState.therapist = { id: 1, email: 'associate@example.test', credential_type: 'associate' }
    mockBilling({ eligible: false })

    renderWithProviders(<Billing />, { route: '/billing' })

    expect(await screen.findByText(/associate accounts cannot connect/i)).toBeInTheDocument()
    expect(screen.getByText(/direct client payments require licensed status/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create payment request/i })).not.toBeInTheDocument()
  })

  it('keeps licensed client payment controls available', async () => {
    authState.therapist = { id: 2, email: 'licensed@example.test', credential_type: 'licensed' }
    mockBilling({ eligible: true })

    renderWithProviders(<Billing />, { route: '/billing' })

    expect(await screen.findByRole('button', { name: /^connect$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create payment request/i })).toBeInTheDocument()
  })
})
