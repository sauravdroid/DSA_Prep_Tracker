import { useState } from 'react'
import * as store from '../store'

export default function ProblemNotes({ slug }) {
  const [notes, setNotes] = useState(() => store.getNotesForSlug(slug))
  const [draft, setDraft] = useState('')

  const add = () => {
    if (!draft.trim()) return
    store.addNote(slug, draft)
    setNotes(store.getNotesForSlug(slug))
    setDraft('')
  }

  return (
    <div className="tw mt-4 border-t border-slate-200 pt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Notes</h4>

      {notes.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {notes.map(n => (
            <div key={n.ts} className="group rounded-lg bg-slate-100 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500">{n.date}</span>
                <button
                  onClick={() => {
                    store.removeNote(slug, n.ts)
                    setNotes(store.getNotesForSlug(slug))
                  }}
                  title="Delete note"
                  className="rounded p-0.5 text-slate-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{n.text}</p>
            </div>
          ))}
        </div>
      )}

      <textarea
        rows={2}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Trigger, invariant, edge case..."
        className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed outline-none transition placeholder:text-slate-300 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Add note
        </button>
      </div>
    </div>
  )
}
