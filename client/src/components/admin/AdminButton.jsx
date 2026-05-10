export default function AdminButton({
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
    'inline-flex items-center gap-2 font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary:   'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-400',
    secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 focus:ring-brand-500',
    danger:    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
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
        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
      )}
      {children}
    </button>
  )
}
