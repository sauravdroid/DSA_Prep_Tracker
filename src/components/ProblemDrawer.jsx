import { useEffect, useState, useCallback } from 'react'
import ProblemDetail from './ProblemDetail'

const ANIM_MS = 220

/**
 * Slide-in detail panel. Kept outside the `.tw` scope so ProblemDetail keeps
 * its own styling; only the drawer chrome uses Tailwind utilities.
 */
export default function ProblemDrawer({ problem, revisions, notice, onClose, children }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Let the slide-out finish before the parent unmounts us.
  const close = useCallback(() => {
    setShown(false)
    setTimeout(onClose, ANIM_MS)
  }, [onClose])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!problem) return null

  return (
    <div
      className={`fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-[2px] transition-opacity duration-200 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={close}
    >
      <aside
        className={`h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl transition-transform duration-200 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={close}
          className="mb-4 rounded-lg border-0 bg-transparent p-0 text-sm text-slate-500 hover:text-slate-900"
        >
          ✕ Close
        </button>

        {notice && (
          <p className="tw mb-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{notice}</p>
        )}

        <ProblemDetail problem={problem} revisions={revisions}>
          {children}
        </ProblemDetail>
      </aside>
    </div>
  )
}
