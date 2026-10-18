import { LIST_LABEL } from '../utils/worklist'

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
 * What a prep sheet adds to the shared problem drawer: the coach's note for
 * this problem, a way to record an attempt, and the graded attempts so far.
 * Everything else (link, tags, revisions, notes) comes from ProblemDetail.
 */
export default function SheetItemDetail({ item, attempts, solvedOn, onRecord }) {
  const history = [...attempts].sort((a, b) => (b.at || b.date).localeCompare(a.at || a.date))
  const added = idDate(item.addedIn)
  const modified = item.modifiedIn && item.modifiedIn !== item.addedIn ? idDate(item.modifiedIn) : null

  return (
    <>
      <div className="tw mt-4">
        {solvedOn && (
          <p className="mb-2 flex items-start gap-2 rounded-lg bg-[#effaf8] px-3 py-2 text-[13px] leading-snug text-slate-700">
            <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0" aria-hidden="true">
              <path d="M3 8.4l3.3 3.3L13 4.8" stroke="#00b8a3" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              <span className="font-semibold text-[#00897b]">Accepted on LeetCode {shortDate(solvedOn)}.</span>{' '}
              Record how it went so the coach can judge it.
            </span>
          </p>
        )}
        <button
          onClick={onRecord}
          className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Record an attempt
        </button>
      </div>

      <div className="tw mt-4 space-y-4 border-t border-slate-200 pt-4">
        <section>
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Coach</h4>
            <span className="text-xs text-slate-400">· {LIST_LABEL[item.list] || ''} · {item.pattern}</span>
            {item.flag === 'repair' && (
              <span className="rounded-full bg-[#ffe8ed] px-2 py-px text-[11px] font-medium text-[#e0244b]">Repair</span>
            )}
          </div>
          <div className="mt-2 rounded-lg border border-l-[3px] border-[#ffe7c2] border-l-[#ffa116] bg-[#fffaf2] px-3.5 py-3">
            <p className="text-sm leading-relaxed text-slate-900">{item.reason}</p>
            {item.detail && <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700">{item.detail}</p>}
            {item.checklist?.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-zinc-700">
                {item.checklist.map(c => <li key={c}>{c}</li>)}
              </ul>
            )}
            {(item.minutes || added || modified) && (
              <p className="mt-2 text-xs text-slate-400">
                {[item.minutes && `${item.minutes} min`, added && `Added ${added}`, modified && `changed ${modified}`].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Graded attempts</h4>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">None recorded yet.</p>
          ) : (
            <div className="mt-1">
              {history.slice(0, 8).map(a => (
                <div key={a.id} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2.5 border-b border-slate-100 py-2 text-[13px] text-slate-700 last:border-b-0">
                  <span className="text-xs text-slate-400">{shortDate(a.date)}</span>
                  <span>{[a.mode, HELP_LABEL[a.help] || a.help, a.timeMinutes != null && `${a.timeMinutes} min`].filter(Boolean).join(' · ')}</span>
                  <span className={`text-xs font-semibold capitalize ${RESULT_TONE[a.result] || 'text-slate-400'}`}>{a.result}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
