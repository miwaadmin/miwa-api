import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import Supervisor from '../pages/Supervisor'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/server'

const refreshTherapistMock = vi.fn()

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    therapist: {
      id: 1,
      full_name: 'Valdrex Philippe',
      assistant_verbosity: 'concise',
    },
    refreshTherapist: refreshTherapistMock,
  }),
}))

function streamConsultResponse(text, conversationId = 'consult-1') {
  const encoder = new TextEncoder()
  const chunks = [
    `data: ${JSON.stringify({ text })}\n\n`,
    `data: ${JSON.stringify({ done: true, conversation_id: conversationId })}\n\n`,
  ]

  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  }), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('AI consult smoke tests', () => {
  beforeEach(() => {
    refreshTherapistMock.mockClear()
  })

  it('renders the consult page and sends a message through the mocked chat endpoint', async () => {
    const user = userEvent.setup()
    let capturedBody

    server.use(
      http.get('/api/ai/consult-conversations', () => HttpResponse.json([])),
      http.get('/api/patients', () => HttpResponse.json([])),
      http.post('/api/ai/chat', async ({ request }) => {
        capturedBody = await request.json()
        return streamConsultResponse('Here is a concise consult response.')
      })
    )

    renderWithProviders(<Supervisor />, { route: '/consult' })

    const input = await screen.findByPlaceholderText(/ask miwa a clinical question/i)
    await user.type(input, 'How should I think about this case?')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(await screen.findByText('How should I think about this case?')).toBeInTheDocument()
    expect(await screen.findByText('Here is a concise consult response.')).toBeInTheDocument()
    expect(capturedBody).toMatchObject({
      message: 'How should I think about this case?',
      contextType: null,
      contextId: null,
      responseStyle: 'concise',
    })
  })

  it('saves a treatment-plan-shaped consult response to the selected client profile', async () => {
    const user = userEvent.setup()
    let importBody

    server.use(
      http.get('/api/ai/consult-conversations', () => HttpResponse.json([])),
      http.get('/api/patients', () => HttpResponse.json([
        {
          id: 16,
          client_id: 'CLT-016',
          display_name: 'Val Likoit',
          presenting_concerns: 'Safety planning and IPV exposure',
        },
      ])),
      http.post('/api/ai/chat', () => (
        streamConsultResponse('Treatment Plan\nGoal 1: Improve safety planning.\nObjective: Identify supports.')
      )),
      http.post('/api/ai/treatment-plan/16/import', async ({ request }) => {
        importBody = await request.json()
        return HttpResponse.json({ goals_created: 1 })
      })
    )

    renderWithProviders(<Supervisor />, { route: '/consult' })

    await screen.findByPlaceholderText(/ask miwa a clinical question/i)

    const contextSelect = screen.getAllByRole('combobox').find(select =>
      Array.from(select.options).some(option => option.value === 'patient')
    )
    await user.selectOptions(contextSelect, 'patient')

    const patientSelect = screen.getAllByRole('combobox').find(select =>
      Array.from(select.options).some(option => option.textContent === 'Val Likoit')
    )
    await user.selectOptions(patientSelect, '16')

    const input = screen.getByPlaceholderText(/ask miwa a clinical question/i)
    await user.type(input, 'Draft a treatment plan.')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(await screen.findByText('Treatment Plan')).toBeInTheDocument()
    expect(screen.getByText('Goal 1:')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /save to client plan/i }))

    expect(await screen.findByText('Saved to client profile with 1 goals.')).toBeInTheDocument()
    await waitFor(() => {
      expect(importBody).toMatchObject({
        content: expect.stringContaining('Treatment Plan'),
        conversationId: 'consult-1',
      })
    })
  })
})
