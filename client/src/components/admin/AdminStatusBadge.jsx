const STATUS_CONFIG = {
  pass:      { label: 'Pass',      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warn:      { label: 'Warn',      classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  fail:      { label: 'Fail',      classes: 'bg-red-50 text-red-700 border-red-200' },
  active:    { label: 'Active',    classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  suspended: { label: 'Suspended', classes: 'bg-red-50 text-red-700 border-red-200' },
  trial:     { label: 'Trial',     classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  past_due:  { label: 'Past Due',  classes: 'bg-orange-50 text-orange-700 border-orange-200' },
}

export default function AdminStatusBadge({ status, label: labelOverride }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.warn
  const label = labelOverride ?? config.label

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${config.classes}`}
    >
      {label}
    </span>
  )
}
