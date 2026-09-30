import { useState } from 'react'
import { RESULTS, previewNextDue } from '../utils/retention'
import { todayStr } from '../utils/dateUtils'

const RESULT_META = {
  green: {
    label: 'Green',
    criteria: [
      'Recognised the approach yourself',
      'No hint and no solution looked at',
      'Invariant and edge cases correct',
      'Finished inside the time box',
    ],
    idle: 'border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-600',
    active: 'border-emerald-500 bg-emerald-500 text-white shadow-sm',
  },
  yellow: {
    label: 'Yellow',
    criteria: [
      'Knew the pattern but stalled',
      'Needed a small nudge, not the answer',
      'Invariant or edge cases took several tries',
      'Took significantly longer than the box',
    ],
    idle: 'border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600',
    active: 'border-amber-500 bg-amber-400 text-amber-950 shadow-sm',
  },
  red: {
    label: 'Red',
    criteria: [
      'Could not derive the key idea',
      'Needed the solution or the key insight',
      'Would not have finished unaided',
    ],
    idle: 'border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600',
    active: 'border-rose-500 bg-rose-500 text-white shadow-sm',
  },
}

const MODE_META = {
  cold: { label: 'Cold', blurb: 'No notes, no old code, nothing seen recently. The only mode that moves the spacing ladder.' },
  warm: { label: 'Warm', blurb: 'Recently seen, or reproducing a solution you just read. Recorded, but does not reschedule.' },
  repair: { label: 'Repair', blurb: 'Deliberate rework after a failure. Clears the repair flag; a later cold test still has to confirm it.' },
  learn: { label: 'Learn', blurb: 'First exposure while learning the idea.' },
}

const HELP_META = {
  none: { label: 'None', blurb: 'Solved entirely unaided' },
  hint: { label: 'Small hint', blurb: 'A nudge — a reminder of the pattern or one edge case' },
  solution: { label: 'Solution shown', blurb: 'The key insight or the code itself was revealed' },
}

export default function ColdTestModal({
  problem,
  slug,
  coldTests = [],
  defaultMode = 'cold',
  existing = null,
  onClose,
  onSave,
}) {
  const [result, setResult] = useState(existing?.result || '')
  const [mode, setMode] = useState(existing?.mode || defaultMode)
  const [timeMinutes, setTimeMinutes] = useState(existing?.timeMinutes ?? '')
  const [help, setHelp] = useState(existing?.help || 'none')
  const [invariant, setInvariant] = useState(existing?.notes?.invariant || '')
  const [whyHelp, setWhyHelp] = useState(existing?.notes?.whyHelp || '')
  const [clicked, setClicked] = useState(existing?.notes?.clicked || '')

  const today = todayStr()
  // Today's own record is being rewritten, so it must not also count as the
  // history this grade is measured against.
  const priorTests = existing ? coldTests.filter(t => t.id !== existing.id) : coldTests
  const movesLadder = mode === 'cold'
  const preview = result && movesLadder ? previewNextDue(priorTests, result, today) : null

  const budget = problem?.difficulty === 'Hard' ? 35 : problem?.difficulty === 'Easy' ? 15 : 30
  const overBudget = timeMinutes !== '' && Number(timeMinutes) > budget

  // A green that needed help or blew the time box contradicts its own criteria.
  let contradiction = null
  if (result === 'green' && help === 'solution') {
    contradiction = 'The solution was shown — that is a Red, not a Green.'
  } else if (result === 'green' && help === 'hint') {
    contradiction = 'A hint means it was not unaided. This is usually a Yellow.'
  } else if (result === 'green' && overBudget) {
    contradiction = `Over the ${budget} min box for a ${problem?.difficulty || 'Medium'} — usually a Yellow.`
  } else if (result === 'red' && help === 'none') {
    contradiction = 'A Red usually means the solution or key insight was revealed.'
  }

  const submit = () => {
    if (!result) return
    onSave({
      slug,
      mode,
      result,
      timeMinutes: timeMinutes === '' ? null : Number(timeMinutes),
      help,
      notes: { invariant, whyHelp, clicked },
    })
  }

  return (
    <div
      className="tw fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {existing ? "Update today's record" : 'Record attempt'}
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-500">{problem?.title || slug}</p>
          </div>
          <button
            className="-m-1 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
          >
            <span className="sr-only">Close</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {existing && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
              You already recorded this problem today. Saving replaces that record rather than
              adding a second one, so the day keeps one honest result.
            </p>
          )}
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Practice mode</span>
            <div className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
              {Object.keys(MODE_META).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-2 py-1.5 text-sm font-medium transition ${
                    mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {MODE_META[m].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{MODE_META[mode].blurb}</p>
          </div>

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Result</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {RESULTS.map(r => (
                <button
                  key={r}
                  onClick={() => setResult(r)}
                  className={`rounded-xl border-2 py-2.5 text-sm font-semibold transition ${
                    result === r ? RESULT_META[r].active : RESULT_META[r].idle
                  }`}
                >
                  {RESULT_META[r].label}
                </button>
              ))}
            </div>
            <ul className="mt-3 space-y-1">
              {(result ? RESULT_META[result].criteria : ['Pick the grade that matches how the attempt actually went.']).map(c => (
                <li key={c} className="flex gap-2 text-xs leading-relaxed text-slate-500">
                  {result && <span className="text-slate-300">·</span>}
                  {c}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Help used</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {Object.keys(HELP_META).map(h => (
                <button
                  key={h}
                  onClick={() => setHelp(h)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                    help === h
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {HELP_META[h].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">{HELP_META[help].blurb}</p>
          </div>

          <div className="flex items-end gap-6">
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Minutes</span>
              <input
                type="number"
                min="0"
                value={timeMinutes}
                onChange={e => setTimeMinutes(e.target.value)}
                placeholder={String(budget)}
                className="mt-1.5 w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none transition placeholder:text-slate-300 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
              />
            </label>
            <span className="pb-2 text-xs text-slate-400">Time box for this difficulty: {budget} min</span>
          </div>

          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Learning notes
            </span>
            {[
              { v: invariant, set: setInvariant, label: 'Which invariant did you struggle with?', ph: 'e.g. why the stack stays strictly decreasing' },
              { v: whyHelp, set: setWhyHelp, label: 'Why did you need help?', ph: 'Leave blank if you did not' },
              { v: clicked, set: setClicked, label: 'What became clear?', ph: 'e.g. the sentinel removes the trailing-flush special case' },
            ].map(f => (
              <label key={f.label} className="block">
                <span className="block text-xs font-medium text-slate-600">{f.label}</span>
                <textarea
                  rows={2}
                  value={f.v}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.ph}
                  className="mt-1 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none transition placeholder:text-slate-300 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
                />
              </label>
            ))}
          </div>

          {contradiction && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200/60">
              {contradiction}
            </p>
          )}

          {result === 'red' && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-900 ring-1 ring-rose-200/60">
              After a Red: do repair practice now, then a <strong>cold retest on a later day</strong>.
              Reproducing the solution straight away is Warm practice, not a pass.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <div className="min-w-0 text-xs">
            {preview ? (
              <span className="text-slate-600">
                Next cold test <strong className="font-semibold text-slate-900">{preview.due}</strong>
                <span className="text-slate-400"> ({preview.interval}d interval)</span>
              </span>
            ) : result ? (
              <span className="text-slate-400">This mode does not reschedule the anchor.</span>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200/60"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!result}
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {existing ? 'Update record' : 'Record attempt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
