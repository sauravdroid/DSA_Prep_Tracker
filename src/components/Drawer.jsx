import { useEffect, useState, useCallback } from 'react'

const ANIM_MS = 220

/**
 * The right-hand slide-in panel shared by every drawer in the app: backdrop,
 * slide animation, Escape and a Close button. Kept outside the `.tw` scope so
 * legacy-styled content keeps its own styling; only the chrome uses Tailwind.
 */
export default function Drawer({ onClose, label, children }) {
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

  return (
    <div
      className={`fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-[2px] transition-opacity duration-200 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={close}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
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
        {children}
      </aside>
    </div>
  )
}
