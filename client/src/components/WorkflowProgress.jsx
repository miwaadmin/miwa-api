import { useState } from 'react'

const STATUS_STYLES = {
  completed: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: '✓' },
  running: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', icon: '⟳' },
  pending: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-400', icon: '○' },
  failed: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: '✗' },
  awaiting_approval: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: '⏸' },
}

/**
 * Inline workflow progress tracker for MiwaChat.
 * Shows a compact step-by-step view of an executing workflow.
 *
 * Props:
 *   workflow: { id, label, status, steps: [{ step_number, tool_name, description, status }], progress: "2/5" }
 *   onApprove: (workflowId, stepNumber) => void
 */
export default function WorkflowProgress({ workflow, onApprove }) {
  const [expanded, setExpanded] = useState(false)

  if (!workflow) return null

  const isActive = ['running', 'paused'].includes(workflow.status)
  const completedCount = workflow.steps?.filter(s => s.status === 'completed').length || 0
  const totalSteps = workflow.steps?.length || 0
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 my-2">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-left"
      >
        <div className="flex-shrink-0">
          {isActive ? (
            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          ) : workflow.status === 'completed' ? (
            <span className="text-emerald-500 text-lg">✓</span>
          ) : (
            <span className="text-red-500 text-lg">✗</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 truncate">{workflow.label || 'Workflow'}</span>
            <span className="text-xs text-gray-400">{workflow.progress || `${completedCount}/${totalSteps}`}</span>
          </div>
          {/* Progress bar */}
          <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                workflow.status === 'completed' ? 'bg-emerald-400' :
                workflow.status === 'failed' ? 'bg-red-400' : 'bg-indigo-400'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded steps */}
      {expanded && (
        <div className="mt-3 space-y-1.5 pl-7">
          {(workflow.steps || []).map((step, i) => {
            const style = STATUS_STYLES[step.status] || STATUS_STYLES.pending
            return (
              <div key={i} className={`flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 ${style.bg} border ${style.border}`}>
                <span className={`font-bold ${style.text}`}>{style.icon}</span>
                <span className={`flex-1 ${step.status === 'pending' ? 'text-gray-400' : 'text-gray-700'}`}>
                  {step.description || step.tool_name}
                </span>
                {step.status === 'awaiting_approval' && onApprove && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onApprove(workflow.id, step.step_number) }}
                    className="px-2 py-0.5 rounded-md bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors"
                  >
                    Approve
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
