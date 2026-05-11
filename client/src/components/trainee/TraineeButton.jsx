// Trainee primitive — mirrors the AdminButton API but uses the trainee brand
// (indigo-violet/teal accents from the trainee dashboard hero). Used inside the
// onboarding wizard and on trainee-only pages. See ../admin/README.md for the
// shared primitive philosophy.
export default function TraineeButton({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  ...props
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    // Primary uses the trainee brand gradient seen in the dashboard hero.
    primary:
      'text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-teal-500 hover:opacity-95 focus:ring-violet-400 shadow-sm',
    secondary:
      'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 focus:ring-violet-300',
    // Quiet variant for "Skip — I'll do this later" and similar de-emphasized actions.
    ghost:
      'bg-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-100 focus:ring-violet-300',
    danger:
      'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant] ?? variants.secondary} ${sizes[size] ?? sizes.md} ${className}`}
      {...props}
    >
      {loading && (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
      )}
      {children}
    </button>
  )
}
