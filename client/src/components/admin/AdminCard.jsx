// highlight: 'none' | 'success' | 'warning' | 'danger'
// Each variant sets a distinct border + background so there's no Tailwind
// class-order conflict from merging two border-color utilities.
const HIGHLIGHT = {
  none:    { border: 'border-gray-200',   bg: 'bg-white' },
  success: { border: 'border-emerald-200', bg: 'bg-emerald-50/20' },
  warning: { border: 'border-amber-200',   bg: 'bg-amber-50/20' },
  danger:  { border: 'border-red-200',     bg: 'bg-white' },
}

export default function AdminCard({
  title,
  subtitle,
  action,
  children,
  footer,
  highlight = 'none',
  className = '',
  ...props
}) {
  const h = HIGHLIGHT[highlight] ?? HIGHLIGHT.none

  return (
    <div
      className={`${h.bg} rounded-xl border ${h.border} shadow-card overflow-hidden ${className}`}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-gray-900">{title}</h2>}
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="flex-shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="px-6 py-5">{children}</div>
      {footer && (
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
          {footer}
        </div>
      )}
    </div>
  )
}
