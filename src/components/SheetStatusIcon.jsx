const RESULT_FILL = { green: '#00b8a3', yellow: '#ffb800', red: '#ff375f' }

function shortDate(d) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** What a status icon means, for its tooltip. */
export function statusLabel(attempt, solvedOn) {
  if (attempt) return `Recorded ${attempt.result}`
  if (solvedOn) return `Accepted on LeetCode ${shortDate(solvedOn)}, not graded yet`
  return 'Not attempted'
}

/**
 * A graded attempt shows its result; an Accepted LeetCode submission with no
 * grade yet shows LeetCode's plain solved check; otherwise an empty ring.
 */
export default function SheetStatusIcon({ attempt, solvedOn, className = 'size-4' }) {
  const label = statusLabel(attempt, solvedOn)
  if (attempt) {
    const fill = RESULT_FILL[attempt.result] || '#94a3b8'
    return (
      <svg viewBox="0 0 16 16" className={className} role="img" aria-label={label}>
        <title>{label}</title>
        <circle cx="8" cy="8" r="7" fill={fill} />
        {attempt.result === 'green' && <path d="M4.8 8.3l2.1 2.1 4.3-4.6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        {attempt.result === 'yellow' && <path d="M5 8h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
        {attempt.result === 'red' && <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
      </svg>
    )
  }
  if (solvedOn) {
    return (
      <svg viewBox="0 0 16 16" className={className} role="img" aria-label={label}>
        <title>{label}</title>
        <path d="M3 8.4l3.3 3.3L13 4.8" stroke="#00b8a3" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
    </svg>
  )
}
