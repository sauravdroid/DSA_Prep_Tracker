import { useEffect, useState, useCallback } from 'react'
import ProblemNotes from './ProblemNotes'
import { LIST_LABEL } from '../utils/worklist'

const ANIM_MS = 200

const DIFF_PILL = {
  Easy: 'bg-[#e7f8f4] text-[#00876f]',
  Medium: 'bg-[#fff6dc] text-[#b77f00]',
  Hard: 'bg-[#ffe8ed] text-[#e0244b]',
}
const RESULT_TONE = { green: 'text-[#00b8a3]', yellow: 'text-[#d99a00]', red: 'text-[#ff375f]' }
const HELP_LABEL = { none: 'unaided', hint: 'hint', solution: 'saw solution' }

function shortDate(d) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function idDate(id) {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(id || '')
  return m ? shortDate(`${m[1]}-${m[2]}-${m[3]}`) : null
}

/**
 * Everything about one worklist item: the coach's instruction first, then your
 * own history with the problem. Record and Open are the only actions.
 */
export default function WorklistDrawer({ item, problem, attempts, unseen, onRecord, onClose }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const close = useCallback(() => {
    setShown(false)
    setTimeout(onClose, ANIM_MS)
  }, [onClose])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const difficulty = item.difficulty || problem?.difficulty
  const tags = problem?.tags || []
  const url = problem?.url || `https://leetcode.com/problems/${item.slug}/`
  const history = [...attempts].sort((a, b) => (b.at || b.date).localeCompare(a.at || a.date))
  const added = idDate(item.addedIn)
  const modified = item.modifiedIn && item.modifiedIn !== item.addedIn ? idDate(item.modifiedIn) : null

  return (
    <div
      className={`fixed inset-0 z-[45] flex justify-end bg-slate-900/20 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      onClick={close}
    >
      <aside
        className={`tw h-full w-full max-w-[540px] overflow-y-auto border-l border-slate-200 bg-white px-6 py-5 shadow-[-16px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-200 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 text-xs text-slate-500">
          <span>{LIST_LABEL[item.list] || ''}</span>
          <span className="size-[3px] rounded-full bg-slate-300" aria-hidden="true" />
          <span>{item.pattern}</span>
          <button
            onClick={close}
            className="ml-auto flex size-7 items-center justify-center rounded-md border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <span className="sr-only">Close</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <h2 className="mt-3 text-xl font-bold text-slate-900">
          {item.number ? `${item.number}. ` : ''}{item.title}
        </h2>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {difficulty && <span className={`rounded-full px-2.5 py-0.5 text-xs ${DIFF_PILL[difficulty] || 'bg-slate-100 text-slate-600'}`}>{difficulty}</span>}
          {item.flag === 'repair' && <span className="rounded-full bg-[#ffe8ed] px-2.5 py-0.5 text-xs text-[#e0244b]">Repair</span>}
          {tags.slice(0, 5).map(t => (
            <span key={t} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{t}</span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={onRecord}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Record attempt
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 no-underline transition hover:bg-slate-50"
          >
            Open in LeetCode ↗
          </a>
        </div>

        {unseen && (
          <p className="mt-3 text-xs text-slate-500">
            You recorded <span className={`font-semibold ${RESULT_TONE[unseen.result]}`}>{unseen.result}</span> on {shortDate(unseen.date)}.
            The coach will see it on its next update.
          </p>
        )}

        <section className="mt-6">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Coach</h3>
          <div className="rounded-lg border border-l-[3px] border-[#ffe7c2] border-l-[#ffa116] bg-[#fffaf2] px-4 py-3.5">
            <p className="text-sm leading-relaxed text-slate-900">{item.reason}</p>
            {item.detail && <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700">{item.detail}</p>}
            {item.checklist?.length > 0 && (
              <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-zinc-700">
                {item.checklist.map(c => <li key={c}>{c}</li>)}
              </ul>
            )}
            <p className="mt-2.5 text-xs text-slate-400">
              {[
                item.minutes && `${item.minutes} min`,
                added && `Added ${added}`,
                modified && `modified ${modified}`,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </section>

        <section className="mt-6">
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Your attempts</h3>
          {history.length === 0 ? (
            <p className="py-2 text-sm text-slate-400">No graded attempts yet.</p>
          ) : (
            history.slice(0, 8).map(a => (
              <div key={a.id} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2.5 border-b border-slate-100 py-2 text-[13px] text-slate-700 last:border-b-0">
                <span className="text-xs text-slate-400">{shortDate(a.date)}</span>
                <span>
                  {[a.mode, HELP_LABEL[a.help] || a.help, a.timeMinutes != null && `${a.timeMinutes} min`].filter(Boolean).join(' · ')}
                </span>
                <span className={`text-xs font-semibold capitalize ${RESULT_TONE[a.result] || 'text-slate-400'}`}>{a.result}</span>
              </div>
            ))
          )}
        </section>

        <ProblemNotes key={item.slug} slug={item.slug} />
      </aside>
    </div>
  )
}
