import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import Workspace from '../pages/Workspace'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/server'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    therapist: {
      id: 99,
      credential_type: 'trainee',
      workspace_mode: 'agency_companion',
    },
  }),
}))

const restoredDraft = {
  savedAt: '2026-05-13T20:15:00.000Z',
  sessionType: 'ongoing',
  form: {
    noteFormat: 'SOAP',
    caseType: 'individual',
    therapeuticOrientation: 'CBT',
    presentingProblem: 'Anxiety and sleep disruption',
    treatmentGoal: 'Improve coping and emotion regulation',
    sessionNotes: 'Restored bullet notes from local storage.',
    members: [],
  },
}

describe('trainee Workspace smoke tests', () => {
  it('restores local drafts, hides licensed-only controls, and keeps recent notes out of Session Workspace', async () => {
    localStorage.setItem('miwa.workspaceDraft:99:new', JSON.stringify(restoredDraft))

    server.use(
      http.get('/api/patients', () => HttpResponse.json([])),
      http.get('/api/sessions/unsigned', () => HttpResponse.json({
        sessions: [
          {
            id: 1,
            patient_id: 11,
            display_name: 'Draft Client',
            note_format: 'SOAP',
            session_date: '2026-05-12T12:00:00.000Z',
            preview: 'Still being reviewed.',
            copy_to_ehr_checklist_json: JSON.stringify({
              draft_completed: true,
              reviewed_by_trainee: true,
            }),
          },
          {
            id: 2,
            patient_id: 12,
            display_name: 'Ready Client',
            note_format: 'DAP',
            session_date: '2026-05-11T12:00:00.000Z',
            preview: 'Ready to copy.',
            copy_to_ehr_checklist_json: JSON.stringify({
              draft_completed: true,
              reviewed_by_trainee: true,
              risk_safety_checked: true,
            }),
          },
          {
            id: 3,
            patient_id: 13,
            display_name: 'Done Client',
            note_format: 'BIRP',
            session_date: '2026-05-10T12:00:00.000Z',
            preview: 'Already copied.',
            copy_to_ehr_checklist_json: JSON.stringify({
              draft_completed: true,
              reviewed_by_trainee: true,
              risk_safety_checked: true,
              copied_to_agency_ehr: true,
            }),
          },
        ],
      })),
    )

    renderWithProviders(<Workspace />, { route: '/t/workspace' })

    expect(await screen.findByTestId('workspace-draft-restored-banner')).toHaveTextContent(/draft restored/i)
    expect(screen.getByText(/last saved locally/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Restored bullet notes from local storage.')).toBeInTheDocument()
    expect(screen.getByText(/agency EHR remains the system of record/i)).toBeInTheDocument()
    expect(screen.queryByText(/send sms/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/share to client portal/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/billing line item/i)).not.toBeInTheDocument()

    expect(screen.queryByTestId('workspace-list-view')).not.toBeInTheDocument()
    expect(screen.queryByText('Your recent notes')).not.toBeInTheDocument()
    expect(screen.queryByText('Draft Client')).not.toBeInTheDocument()
  })
})
