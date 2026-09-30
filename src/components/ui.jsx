/** Small presentational pieces shared by the Debt page and its outlook. */

export function Chip({ className, title, children }) {
  return (
    <span title={title} className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${className}`}>
      {children}
    </span>
  )
}

/** Problem title that opens the detail drawer. */
export function ProblemLink({ slug, title, onOpen, className = '' }) {
  return (
    <button
      onClick={() => onOpen(slug, title)}
      title="View problem details"
      className={`truncate border-0 bg-transparent p-0 text-left underline-offset-2 hover:underline ${className}`}
    >
      {title || slug}
    </button>
  )
}
