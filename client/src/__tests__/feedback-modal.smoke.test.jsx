import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import FeedbackModal from '../components/FeedbackModal'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/server'

describe('FeedbackModal smoke tests', () => {
  it('submits feedback and shows ticket ID on success', async () => {
    const user = userEvent.setup()

    server.use(
      http.post('/api/feedback', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ id: 42, ticket_id: 'MIWA-FB-42' }, { status: 201 })
      }),
    )

    const onClose = vi.fn()
    renderWithProviders(
      <FeedbackModal isOpen onClose={onClose} />
    )

    // Fill out the form
    await user.selectOptions(screen.getByTestId('feedback-category'), 'bug')
    await user.type(screen.getByTestId('feedback-subject'), 'Something is broken')
    await user.type(screen.getByTestId('feedback-message'), 'The invite button throws a 500 error when I click it.')

    await user.click(screen.getByTestId('feedback-submit'))

    // Should show success state with ticket ID
    const success = await screen.findByTestId('feedback-success')
    expect(success).toBeInTheDocument()
    expect(success).toHaveTextContent('MIWA-FB-42')
  })

  it('shows an error if the API returns a non-ok response', async () => {
    const user = userEvent.setup()

    server.use(
      http.post('/api/feedback', () =>
        HttpResponse.json({ error: 'Rate limit reached.' }, { status: 429 }),
      ),
    )

    renderWithProviders(
      <FeedbackModal isOpen onClose={() => {}} />
    )

    await user.type(screen.getByTestId('feedback-message'), 'This is a message long enough to pass validation.')
    await user.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Rate limit reached.')
    })
  })

  it('validates that message has at least 10 characters', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <FeedbackModal isOpen onClose={() => {}} />
    )

    await user.type(screen.getByTestId('feedback-message'), 'Short')
    await user.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('10 characters')
    })
  })

  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <FeedbackModal isOpen={false} onClose={() => {}} />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('includes page context when the checkbox is checked', async () => {
    const user = userEvent.setup()

    let capturedBody = null
    server.use(
      http.post('/api/feedback', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 99, ticket_id: 'MIWA-FB-99' }, { status: 201 })
      }),
    )

    renderWithProviders(
      <FeedbackModal isOpen onClose={() => {}} />
    )

    await user.type(screen.getByTestId('feedback-message'), 'Long enough message to pass the minimum length check.')
    await user.click(screen.getByTestId('feedback-include-page'))
    await user.click(screen.getByTestId('feedback-submit'))

    await screen.findByTestId('feedback-success')

    expect(capturedBody?.context).toBeDefined()
    expect(capturedBody.context).toHaveProperty('page')
  })
})
