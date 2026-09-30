import { useState } from 'react'
import * as store from '../store'

/**
 * Shown after a sync so a note can be attached while the attempt is still
 * fresh. Also offers to grade anything that was solved or revised.
 */
export default function SyncNotesPanel({ items, onClose, onGrade }) {
  const [drafts, setDrafts] = useState({})
  const [saved, setSaved] = useState({})

  if (!items || items.length === 0) return null

  const save = slug => {
    const text = (drafts[slug] || '').trim()
    if (!text) return
    store.addNote(slug, text)
    setSaved(s => ({ ...s, [slug]: true }))
    setDrafts(d => ({ ...d, [slug]: '' }))
  }

  const saveAllAndClose = () => {
    for (const item of items) {
      const text = (drafts[item.slug] || '').trim()
      if (text) store.addNote(item.slug, text)
    }
    onClose()
  }

  return (
    <div
      className="tw fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={saveAllAndClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Add notes</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {items.length} problem{items.length !== 1 ? 's' : ''} synced. Capture what made it
              click while it is still fresh.
            </p>
          </div>
          <button
            className="-m-1 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={saveAllAndClose}
          >
            <span className="sr-only">Close</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {items.map(item => (
            <div key={item.slug} className="rounded-xl border border-slate-200 p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    item.type === 'new'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-violet-100 text-violet-700'
                  }`}
                >
                  {item.type}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                  {item.title || item.slug}
                </span>
                {saved[item.slug] && (
                  <span className="text-xs font-semibold text-emerald-600">saved</span>
                )}
              </div>

              <textarea
                rows={2}
                value={drafts[item.slug] || ''}
                onChange={e => setDrafts(d => ({ ...d, [item.slug]: e.target.value }))}
                placeholder="Trigger, invariant, edge case, what you got wrong..."
                className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
              />

              <div className="mt-2 flex justify-end gap-2">
                <button
                  onClick={() => onGrade(item.slug)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Grade attempt
                </button>
                <button
                  onClick={() => save(item.slug)}
                  disabled={!(drafts[item.slug] || '').trim()}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Save note
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button
            onClick={saveAllAndClose}
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
          >
            Save all &amp; close
          </button>
        </div>
      </div>
    </div>
  )
}
