// Compact horizontal 4-dot indicator for a session's copy-to-EHR pipeline:
//   1. draft_completed
//   2. reviewed_by_trainee
//   3. risk_safety_checked
//   4. copied_to_agency_ehr (or copied_to_ehr_at on the session row)
//
// Used inline in case-scoped note lists to surface where each note sits in the
// 4-step pipeline at a glance. Pass either the raw session row
// (which has the per-step *_at timestamps and copy_to_ehr_checklist_json) or
// a pre-computed `steps` boolean array of length 4.
const STEP_LABELS = ['Draft', 'Reviewed', 'Risk check', 'Copied to EHR']

export function sessionPipelineSteps(session) {
  if (!session) return [false, false, false, false]
  let checklist = {}
  if (session.copy_to_ehr_checklist_json) {
    try { checklist = JSON.parse(session.copy_to_ehr_checklist_json) || {} } catch {}
  }
  return [
    !!(checklist.draft_completed || session.draft_completed_at),
    !!(checklist.reviewed_by_trainee || session.reviewed_by_trainee_at),
    !!(checklist.risk_safety_checked || session.risk_safety_checked_at),
    !!(checklist.copied_to_agency_ehr || session.copied_to_ehr_at),
  ]
}

export default function WorkspaceStatusDots({ session, steps, className = '' }) {
  const resolved = Array.isArray(steps) && steps.length === 4 ? steps : sessionPipelineSteps(session)
  const done = resolved.filter(Boolean).length
  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      title={`${done}/4 steps complete`}
      aria-label={`${done} of 4 copy-to-EHR steps complete`}
    >
      {resolved.map((on, idx) => (
        <span
          key={idx}
          title={STEP_LABELS[idx]}
          className={`inline-block w-2.5 h-2.5 rounded-full border ${
            on
              ? 'bg-emerald-500 border-emerald-600'
              : 'bg-white border-gray-300'
          }`}
        />
      ))}
      <span className="ml-1.5 text-[11px] font-semibold text-gray-500 tabular-nums">{done}/4</span>
    </div>
  )
}
