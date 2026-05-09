import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import Patients from '../pages/Patients'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/server'

const jane = {
  id: 1,
  client_id: 'CLT-001',
  first_name: 'Jane',
  last_name: 'Smith',
  display_name: 'Jane Smith',
  email: 'jane@example.com',
  phone: '',
  age: 34,
  gender: 'Female',
  presenting_concerns: 'Anxiety and disrupted sleep',
  diagnoses: 'F41.1',
  notes: 'Initial intake complete',
  client_type: 'individual',
  preferred_contact_method: 'email',
  sms_consent: 0,
  session_count: 2,
  updated_at: '2026-05-01T12:00:00.000Z',
}

function mockPatientList(initialPatients = [jane]) {
  let patients = [...initialPatients]
  const calls = {
    created: null,
    updated: null,
    deleted: null,
  }

  server.use(
    http.get('/api/patients', () => HttpResponse.json(patients)),
    http.post('/api/patients', async ({ request }) => {
      calls.created = await request.json()
      const created = {
        id: 2,
        client_id: calls.created.client_id || 'CLT-002',
        display_name: calls.created.display_name || `${calls.created.first_name} ${calls.created.last_name}`,
        updated_at: '2026-05-02T12:00:00.000Z',
        session_count: 0,
        ...calls.created,
      }
      patients = [created, ...patients]
      return HttpResponse.json(created)
    }),
    http.put('/api/patients/1', async ({ request }) => {
      calls.updated = await request.json()
      patients = patients.map(patient => patient.id === 1 ? { ...patient, ...calls.updated } : patient)
      return HttpResponse.json(patients.find(patient => patient.id === 1))
    }),
    http.delete('/api/patients/1', () => {
      calls.deleted = 1
      patients = patients.filter(patient => patient.id !== 1)
      return HttpResponse.json({ ok: true })
    })
  )

  return calls
}

describe('patient list CRUD smoke tests', () => {
  it('renders patients returned by the API', async () => {
    mockPatientList()

    renderWithProviders(<Patients />, { route: '/patients' })

    expect(await screen.findByText('Jane Smith')).toBeInTheDocument()
    expect(screen.getByText('CLT-001')).toBeInTheDocument()
    expect(screen.getByText(/Anxiety and disrupted sleep/i)).toBeInTheDocument()
  })

  it('creates a client with the entered payload', async () => {
    const user = userEvent.setup()
    const calls = mockPatientList([])

    renderWithProviders(<Patients />, { route: '/patients' })

    await screen.findByText('No patients yet. Add your first patient.')
    await user.click(screen.getByRole('button', { name: /add patient/i }))
    await user.type(screen.getByPlaceholderText('e.g. Sarah'), 'Sarah')
    await user.type(screen.getByPlaceholderText('e.g. Martinez'), 'Kim')
    await user.type(screen.getByPlaceholderText('client@example.com'), 'sarah@example.com')
    await user.click(screen.getByRole('button', { name: /^email$/i }))
    await user.type(screen.getByPlaceholderText(/anxiety, depression/i), 'Panic symptoms')
    await user.click(screen.getByRole('button', { name: /add client/i }))

    await waitFor(() => {
      expect(calls.created).toMatchObject({
        first_name: 'Sarah',
        last_name: 'Kim',
        email: 'sarah@example.com',
        presenting_concerns: 'Panic symptoms',
        preferred_contact_method: 'email',
      })
    })
  })

  it('edits a client with the changed payload', async () => {
    const user = userEvent.setup()
    const calls = mockPatientList()

    renderWithProviders(<Patients />, { route: '/patients' })

    await screen.findByText('Jane Smith')
    await user.click(screen.getByTitle('Edit'))
    await user.clear(screen.getByDisplayValue('Jane'))
    await user.type(screen.getByPlaceholderText('e.g. Sarah'), 'Janet')
    await user.clear(screen.getByPlaceholderText(/anxiety, depression/i))
    await user.type(screen.getByPlaceholderText(/anxiety, depression/i), 'Improved sleep, ongoing anxiety')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(calls.updated).toMatchObject({
        id: 1,
        first_name: 'Janet',
        last_name: 'Smith',
        presenting_concerns: 'Improved sleep, ongoing anxiety',
      })
    })
  })

  it('archives a client through the delete endpoint', async () => {
    const user = userEvent.setup()
    const calls = mockPatientList()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderWithProviders(<Patients />, { route: '/patients' })

    await screen.findByText('Jane Smith')
    await user.click(screen.getByTitle('Archive'))

    await waitFor(() => {
      expect(calls.deleted).toBe(1)
    })
  })
})
