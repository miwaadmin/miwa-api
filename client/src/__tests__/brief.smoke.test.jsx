import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import Brief from '../pages/Brief'
import Sidebar from '../components/Sidebar'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/server'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    therapist: {
      id: 7,
      credential_type: 'licensed',
      workspace_mode: 'private_practice',
    },
  }),
}))

describe('brief page smoke tests', () => {
  it('renders current-week and saved sections with save and unsave actions', async () => {
    const user = userEvent.setup()
    let thisWeek = [{
      id: 1,
      title: 'Monday focus',
      content: '## Today\nKeep the consult close to the presenting question.',
      local_date: '2026-05-18',
      saved: false,
    }]
    let saved = [{
      id: 2,
      title: 'Saved supervision prompt',
      content: 'A question worth bringing to supervision.',
      local_date: '2026-05-12',
      saved: true,
      saved_at: '2026-05-12T12:00:00Z',
    }]

    server.use(
      http.get('/api/brief', () => HttpResponse.json({ this_week: thisWeek, saved })),
      http.post('/api/brief/1/save', () => {
        thisWeek = [{ ...thisWeek[0], saved: true, saved_at: '2026-05-18T12:00:00Z' }]
        saved = [thisWeek[0], ...saved]
        return HttpResponse.json({ brief: thisWeek[0] })
      }),
      http.post('/api/brief/2/unsave', () => {
        saved = saved.filter(brief => brief.id !== 2)
        return HttpResponse.json({
          brief: {
            id: 2,
            title: 'Saved supervision prompt',
            content: 'A question worth bringing to supervision.',
            local_date: '2026-05-12',
            saved: false,
            saved_at: null,
          },
        })
      }),
      http.post('/api/research/generate', () => {
        thisWeek = [{
          id: 3,
          title: 'Generated brief',
          content: 'Generated content',
          local_date: '2026-05-19',
          saved: false,
        }]
        return HttpResponse.json({ ok: true })
      }),
    )

    renderWithProviders(<Brief />, { route: '/brief' })

    expect(await screen.findByRole('heading', { name: /your brief/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /this week/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /saved briefs/i })).toBeInTheDocument()
    expect(await screen.findByText('Monday focus')).toBeInTheDocument()
    expect(await screen.findByText('Saved supervision prompt')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument()

    const savedSection = screen.getByRole('heading', { name: /saved briefs/i }).closest('section')
    await user.click(within(savedSection).getAllByRole('button', { name: /unsave/i })[1])
    await waitFor(() => {
      expect(screen.queryByText('Saved supervision prompt')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /generate brief/i }))
    expect(await screen.findByText('Generated brief')).toBeInTheDocument()
  })

  it('shows Brief in licensed sidebar navigation', async () => {
    server.use(
      http.get('/api/patients/alerts', () => HttpResponse.json([])),
    )

    renderWithProviders(<Sidebar />, { route: '/dashboard' })

    const nav = screen.getByRole('navigation')
    expect(within(nav).getByRole('link', { name: 'Brief' })).toHaveAttribute('href', '/brief')
  })
})
