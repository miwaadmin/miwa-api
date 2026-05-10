export default function AdminStat({ label, value, onClick, className = '' }) {
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wide text-gray-400 font-medium leading-none">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900 tabular-nums leading-none">{value}</p>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`card p-5 text-left w-full hover:border-brand-300 hover:shadow-card-md transition-all ${className}`}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={`card p-5 ${className}`}>
      {inner}
    </div>
  )
}
