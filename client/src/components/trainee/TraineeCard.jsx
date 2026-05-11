// Trainee primitive — a clean white card surface used inside the onboarding
// wizard and on trainee-only pages. Border + shadow are slightly softer than
// AdminCard so the wizard feels less utilitarian.
export default function TraineeCard({
  title,
  subtitle,
  action,
  children,
  footer,
  className = '',
  ...props
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden ${className}`}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 px-7 py-5 border-b border-gray-100">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold text-gray-900">{title}</h2>}
            {subtitle && <p className="text-sm text-gray-500 mt-1 leading-relaxed">{subtitle}</p>}
          </div>
          {action && <div className="flex-shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="px-7 py-6">{children}</div>
      {footer && (
        <div className="px-7 py-4 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
          {footer}
        </div>
      )}
    </div>
  )
}
