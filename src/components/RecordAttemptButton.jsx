/** The app's one "Record an attempt" button, shared by every problem view. */
export default function RecordAttemptButton({ onClick, className = '' }) {
  return (
    <div className={`tw ${className}`}>
      <button
        onClick={onClick}
        className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
      >
        Record an attempt
      </button>
    </div>
  )
}
