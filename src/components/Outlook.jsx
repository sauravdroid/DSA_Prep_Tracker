import { useState, useMemo } from 'react'
import { resolveOutlookDay, STATUS, OUTCOMES, workloadOf } from '../utils/outlook'
import { Chip, ProblemLink } from './ui'

const STATUS_STYLE = {
  ready: 'bg-emerald-100 text-emerald-700',
  awaiting: 'bg-amber-100 text-amber-800',
  preview: 'bg-violet-100 text-violet-700',
  review: 'bg-rose-100 text-rose-700',
  complete: 'bg-slate-900 text-white',
}

const KIND_STYLE = {
  new: 'bg-sky-100 text-sky-700',
  cold: 'bg-slate-900 text-white',
  repair: 'bg-rose-100 text-rose-700',
  warm: 'bg-amber-100 text-amber-800',
  learn: 'bg-violet-100 text-violet-700',
}

const ORDER_LABEL = ['First', 'Then', 'After that']

const SCENARIO_TONE = {
  green: { dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800', ring: 'ring-emerald-300' },
  yellow: { dot: 'bg-amber-400', chip: 'bg-amber-100 text-amber-900', ring: 'ring-amber-300' },
  red: { dot: 'bg-rose-500', chip: 'bg-rose-100 text-rose-800', ring: 'ring-rose-300' },
  neutral: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700', ring: 'ring-slate-300' },
}

/**
 * Colour hint only. A V1 label is prose, so this is a reading aid and is never
 * allowed to select a branch — resolution ignores labels entirely.
 */
function toneOf(label = '') {
  const l = label.toLowerCase()
  if (l.includes('red')) return SCENARIO_TONE.red
  if (l.includes('yellow')) return SCENARIO_TONE.yellow
  if (l.includes('green')) return SCENARIO_TONE.green
  return SCENARIO_TONE.neutral
}

/** Everything explanatory about the day, kept behind the header's info icon. */
function NoteBlock({ notes }) {
  return (
    <div className="panel-in mt-3 rounded-xl border-l-4 border-slate-300 bg-slate-50 py-3 pl-4 pr-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Note</span>
      <ul className="mt-1 list-none space-y-1.5 pl-0">
        {notes.map(n => (
          <li key={n} className="text-sm leading-relaxed text-slate-600">{n}</li>
        ))}
      </ul>
    </div>
  )
}

function NotesToggle({ count, open, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${count} note${count !== 1 ? 's' : ''} about this day`}
      title={`${count} note${count !== 1 ? 's' : ''} about this day`}
      className={`ml-auto flex size-6 shrink-0 items-center justify-center rounded-full border-0 transition ${
        open ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}
    >
      <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 9v4.5M10 6.4v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  )
}

/* ---------- Timeline ---------- */

const MARK = {
  done: 'M5 10.5l3.2 3.2L15 7',
  failed: 'M6.5 6.5l7 7M13.5 6.5l-7 7',
  skipped: 'M6 10h8',
  unclear: 'M10 6v5M10 14v.5',
}

const NODE_STATE = {
  done: { ring: 'bg-emerald-500 text-white', label: 'complete' },
  failed: { ring: 'bg-rose-500 text-white', label: 'failed' },
  skipped: { ring: 'bg-slate-400 text-white', label: 'not completed' },
  unclear: { ring: 'bg-amber-400 text-amber-950', label: 'evidence unclear' },
  waiting: { ring: 'bg-white text-amber-500 ring-1 ring-amber-300', label: 'waiting for a result' },
  pending: { ring: 'bg-white text-slate-400 ring-1 ring-slate-300', label: 'pending' },
}

/**
 * Every stop occupies the same two rows — a fixed-height band for the marker
 * and one for the date — so mixed sizes stay on one axis.
 */
function Stop({ children, date }) {
  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="flex h-5 items-center">{children}</div>
      <span className="h-3.5 text-[10px] font-medium leading-[14px] tabular-nums text-slate-500">{date || ''}</span>
    </div>
  )
}

/** Status is carried by the icon; only dates are written out. */
function TimelineNode({ state, date, title, small, onClick, note }) {
  const s = NODE_STATE[state] || NODE_STATE.pending
  const mark = MARK[state]
  const label = `${title}: ${s.label}${note ? ` (${note})` : ''}`
  const Tag = onClick ? 'button' : 'span'

  return (
    <Stop date={date}>
      <Tag
        {...(onClick ? { onClick, type: 'button' } : { role: 'img' })}
        aria-label={label}
        title={label}
        className={`tl-node flex items-center justify-center rounded-full border-0 ${
          small ? 'size-3.5' : 'size-5'
        } ${s.ring} ${onClick ? 'cursor-pointer hover:brightness-95' : ''}`}
      >
        <svg viewBox="0 0 20 20" className={small ? 'size-2' : 'size-3'} fill="none" aria-hidden="true">
          {mark ? (
            <path d={mark} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="tl-mark" />
          ) : (
            <circle cx="10" cy="10" r="3.6" fill="currentColor" className="tl-wait" />
          )}
        </svg>
      </Tag>
    </Stop>
  )
}

function Link() {
  return (
    <Stop>
      <span className="tl-link h-px w-4 rounded-full bg-slate-300" aria-hidden="true" />
    </Stop>
  )
}

function dependencyState(fact) {
  if (fact.state === 'not_completed') return 'skipped'
  if (fact.state === 'ambiguous' || fact.state === 'malformed') return 'unclear'
  if (fact.state !== 'known') return 'waiting'
  if (fact.result === 'red') return 'failed'
  if (fact.result === 'yellow') return 'unclear'
  return 'done'
}

function dayState(view) {
  if (view.status.key === 'complete') return 'done'
  if (view.status.key === 'review') return 'unclear'
  if (view.status.key === 'awaiting') return 'waiting'
  return 'pending'
}

/**
 * What this day hangs off, and how much of it is finished. Earlier days of the
 * same forecast lead in, because each one's result feeds the next; declared
 * dependencies sit closest to the day, since those are the stated conditions.
 */
function Timeline({ view, priorDays = [], onSelectDay }) {
  const checkpoints = view.items.filter(i => i.type === 'problem')

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1 rounded-xl bg-slate-50 px-3 py-1.5">
      {priorDays.map(p => (
        <span key={p.date} className="flex items-center gap-1">
          <TimelineNode
            small
            state={dayState(p)}
            date={p.date}
            title={`${p.weekday}'s plan`}
            note="earlier day in this forecast"
            onClick={onSelectDay ? () => onSelectDay(p.date) : undefined}
          />
          <Link />
        </span>
      ))}

      {view.dependencies.map(d => (
        <span key={d.id} className="flex items-center gap-1">
          <TimelineNode state={dependencyState(d)} date={d.date} title={d.title} />
          <Link />
        </span>
      ))}

      <TimelineNode state={dayState(view)} date={view.date} title={`${view.weekday}'s plan`} />

      {checkpoints.length > 0 && <Link />}
      {checkpoints.map(c => (
        <TimelineNode key={c.key} small state={c.done ? 'done' : 'pending'} title={c.title} />
      ))}
    </div>
  )
}

/** One planned task. Longer reasoning stays behind a disclosure. */
function TaskCard({ item, order, problems, onOpenProblem }) {
  const [open, setOpen] = useState(false)
  const known = item.slug && problems[item.slug]

  return (
    <li className={`rounded-xl border px-4 py-3 ${item.done ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
          {order}
        </span>
        {item.slug ? (
          <ProblemLink slug={item.slug} title={item.title} onOpen={onOpenProblem} className="text-sm font-semibold text-slate-900" />
        ) : (
          <span className="text-sm font-semibold text-slate-900">{item.title}</span>
        )}
        {item.kind && <Chip className={KIND_STYLE[item.kind] || 'bg-slate-100 text-slate-600'}>{item.kind}</Chip>}
        {item.topic && <Chip className="bg-slate-100 text-slate-600">{item.topic}</Chip>}
        {item.slug && !known && <Chip className="bg-slate-100 text-slate-500">not solved yet</Chip>}
        {item.done && <Chip className="bg-emerald-100 text-emerald-700">done</Chip>}
        <span className="ml-auto shrink-0 text-xs font-medium text-slate-400">
          {item.minutes != null ? `≤${item.minutes} min` : 'time estimate missing'}
        </span>
      </div>

      {item.purpose && <p className="mt-1 text-xs font-medium text-slate-500">{item.purpose}</p>}
      {item.why && <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.why}</p>}

      {item.detail && (
        <>
          <button
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="mt-1.5 border-0 bg-transparent p-0 text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
          >
            {open ? 'Hide explanation' : 'Why this task?'}
          </button>
          {open && <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">{item.detail}</p>}
        </>
      )}
    </li>
  )
}

/** Compact map of how the plan would change, only the live path expanded. */
function DecisionMap({ view }) {
  const [open, setOpen] = useState(false)
  if (view.scenarios.length < 2) return null

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="rounded-lg border border-slate-200 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
      >
        {open ? 'Hide' : 'What changes this plan?'}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {view.dependencies.length > 0 && (
            <p className="text-xs text-slate-500">
              Depends on{' '}
              {view.dependencies.map(d => `${d.title} (${d.date}, ${d.mode})`).join(' and ')}.
            </p>
          )}
          {view.scenarios.map((s, index) => {
            const live = view.selected?.id === s.id
            const ruledOut = s.outcome === false && !view.preview
            const tone = toneOf(s.label)
            return (
              <div
                key={s.id}
                className={`rounded-lg bg-white px-3 py-2 ring-1 ${
                  live ? `ring-2 ${tone.ring}` : 'ring-slate-200'
                } ${ruledOut ? 'opacity-50' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tone.chip}`}>
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className={`size-2.5 shrink-0 rounded-full ${tone.dot}`} />
                  <span className="text-xs font-semibold text-slate-800">{s.label}</span>
                  <Chip className={
                    live ? (view.preview ? 'bg-violet-600 text-white' : 'bg-slate-900 text-white')
                      : ruledOut ? 'bg-slate-200 text-slate-500'
                        : 'bg-amber-100 text-amber-800'
                  }>
                    {live
                      ? (view.preview ? 'previewed' : 'selected by your result')
                      : ruledOut ? 'ruled out' : 'hypothetical'}
                  </Chip>
                  <span className="ml-auto text-xs text-slate-500">
                    {s.workload.problems} problem{s.workload.problems !== 1 ? 's' : ''}
                    {s.workload.timeComplete && ` · ${s.workload.minutes} min`}
                  </span>
                </div>
                {live && s.items.length > 0 && (
                  <ul className="mt-1.5 list-none space-y-0.5 pl-0">
                    {s.items.map(i => (
                      <li key={i.key} className="text-xs text-slate-600">· {i.title}</li>
                    ))}
                  </ul>
                )}
                {s.reason && !live && <p className="mt-1 text-xs text-slate-500">{s.reason}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Workload({ view }) {
  const w = view.workload
  if (w.range != null) {
    return (
      <span className="text-sm font-semibold text-slate-700">
        {w.range} problem{w.range === '1' ? '' : 's'} · awaiting result
      </span>
    )
  }
  if (w.problems === 0) {
    return <span className="text-sm font-semibold text-slate-700">No problem work planned</span>
  }
  return (
    <span className="text-sm font-semibold text-slate-700">
      {w.problems} problem{w.problems !== 1 ? 's' : ''}
      {w.steps > w.problems && ` · ${w.steps} steps`}
      {' · '}
      {w.timeComplete
        ? `${w.minutes} min of problem time`
        : w.minutes > 0
          ? `${w.minutes} min known, time estimate incomplete`
          : 'time estimate incomplete'}
    </span>
  )
}

function DayPanel({ day, ctx, problems, priorDays, onSelectDay, onOpenProblem, onGrade }) {
  const [previewResults, setPreviewResults] = useState(null)
  const [previewBranchId, setPreviewBranchId] = useState(null)
  const [notesOpen, setNotesOpen] = useState(false)

  const view = useMemo(
    () => resolveOutlookDay(day, { ...ctx, previewResults, previewBranchId }),
    [day, ctx, previewResults, previewBranchId]
  )

  const dep = view.dependencies[0] || null
  const previewing = view.preview

  // An unresolved state with a slug is actionable, so it keeps its own callout.
  // Everything else explanatory collapses into the note block below the plan.
  const actionable = view.unresolved?.slug ? view.unresolved : null
  const notes = [
    !actionable && view.unresolved?.message,
    view.note,
    ...view.reasons,
  ].filter(Boolean)

  const clearPreview = () => {
    setPreviewResults(null)
    setPreviewBranchId(null)
  }

  // "Actual" first, then each way the plan could go. Uniform styling: the tab
  // picks a path, it does not assert one.
  const paths = view.legacy
    ? view.scenarios.map((s, i) => ({ key: s.id, letter: String.fromCharCode(65 + i), label: s.label }))
    : OUTCOMES.map(o => ({ key: o.value, letter: null, label: o.label }))
  const activePath = view.legacy ? previewBranchId : (dep ? previewResults?.[dep.id] : null)

  const pickPath = key => {
    if (key === null) return clearPreview()
    if (view.legacy) { setPreviewResults(null); setPreviewBranchId(key) }
    else if (dep) { setPreviewBranchId(null); setPreviewResults({ [dep.id]: key }) }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">{view.date}</span>
        <span className="text-xs text-slate-400">{view.weekday}</span>
        <Chip className={STATUS_STYLE[view.status.key]}>{view.status.label}</Chip>
        {view.headline && <Chip className="bg-slate-100 text-slate-600">{view.headline}</Chip>}
        {notes.length > 0 && (
          <NotesToggle count={notes.length} open={notesOpen} onToggle={() => setNotesOpen(v => !v)} />
        )}
      </div>

      <Timeline view={view} priorDays={priorDays} onSelectDay={onSelectDay} />

      {(dep || view.legacy) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
            {[{ key: null, letter: null, label: 'Actual' }, ...paths].map(p => {
              const on = activePath === p.key
              return (
                <button
                  key={p.key ?? 'actual'}
                  onClick={() => pickPath(p.key)}
                  aria-pressed={on}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {p.letter && <span className="font-bold text-slate-400">{p.letter}</span>}
                  {p.label}
                </button>
              )
            })}
          </div>
          {previewing && <Chip className="bg-violet-600 text-white">Preview only</Chip>}
        </div>
      )}

      {/* Keyed so switching path or day re-runs the entrance animation. */}
      <div key={`${view.date}:${activePath ?? 'actual'}`} className="panel-in">
        <div className="mt-3" aria-live="polite">
          <Workload view={view} />
          {view.basis && <p className="mt-0.5 text-xs text-slate-500">{view.basis}</p>}
        </div>

        {actionable && (
          <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200/60">
            <p className="text-sm font-medium text-amber-900">{actionable.message}</p>
            {actionable.reason && <p className="mt-0.5 text-xs text-amber-800">{actionable.reason}</p>}
            {onGrade && (
              <button
                onClick={() => onGrade(actionable.slug, actionable.mode || 'cold')}
                className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
              >
                Record that result
              </button>
            )}
          </div>
        )}

        {previewing && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 ring-1 ring-violet-200/60">
            <span className="text-xs text-violet-900">
              Nothing is recorded, rescheduled or saved while previewing.
            </span>
            <button
              onClick={clearPreview}
              className="ml-auto rounded-lg border border-violet-300 bg-white px-3 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-100"
            >
              Return to actual plan
            </button>
          </div>
        )}

        {view.items.length > 0 && (
          <ol className="mt-3 list-none space-y-2 pl-0">
            {view.items.map((item, i) => (
              <TaskCard
                key={item.key}
                item={item}
                order={ORDER_LABEL[i] || `Step ${i + 1}`}
                problems={problems}
                onOpenProblem={onOpenProblem}
              />
            ))}
          </ol>
        )}

        {/* Follow-ups are information about later days, never tasks for this one. */}
        {view.followUps.length > 0 && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Follow-up</span>
            <ul className="mt-1 list-none space-y-0.5 pl-0">
              {view.followUps.map((f, i) => (
                <li key={i} className="text-xs text-slate-600">
                  · {f.text}
                  {f.date && <span className="ml-1 font-medium text-slate-500">({f.date})</span>}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-slate-400">Not extra work for {view.weekdayShort}.</p>
          </div>
        )}

        {notesOpen && notes.length > 0 && <NoteBlock notes={notes} />}
      </div>

      <DecisionMap view={view} />
    </div>
  )
}

/** Day picker, rendered inline with the Today / Next 3 days control. */
export function DayBreadcrumb({ days, selected, onSelect }) {
  if (!days?.length) return null
  const active = days.find(d => d.date === selected) || days[0]

  return (
    <nav aria-label="Outlook day" className="flex flex-wrap items-center gap-1">
      {days.map((d, i) => {
        const on = d.date === active.date
        return (
          <span key={d.date} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300" aria-hidden="true">›</span>}
            <button
              onClick={() => onSelect(d.date)}
              aria-current={on ? 'true' : undefined}
              className={`rounded-md px-2 py-1 text-sm transition ${
                on ? 'bg-slate-900/5 font-semibold text-slate-900' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              {new Date(d.date + 'T12:00:00').toLocaleDateString('default', { weekday: 'short' })}
              <span className={`ml-1.5 text-xs tabular-nums ${on ? 'text-slate-500' : 'text-slate-400'}`}>
                {d.date.slice(5)}
              </span>
            </button>
          </span>
        )
      })}
    </nav>
  )
}

/**
 * Three-day outlook. Each day shows one plan; alternatives live behind
 * explicit preview and explanation controls so the workload stays honest.
 */
export default function Outlook({ decision, validity, practiceLog, anchors, today, problems, dayDate, onSelectDay, onOpenProblem, onGrade }) {
  const days = decision?.nextThreeDays

  const ctx = useMemo(() => ({ practiceLog, anchors, today }), [practiceLog, anchors, today])

  // Earlier days resolve without any preview overrides, so a hypothetical never
  // leaks into the chain leading up to the selected day.
  const selected = days?.find(d => d.date === dayDate) || days?.[0]
  const priorDays = useMemo(() => {
    if (!days || !selected) return []
    const i = days.indexOf(selected)
    return days.slice(0, Math.max(0, i)).map(d => resolveOutlookDay(d, ctx))
  }, [days, selected, ctx])

  if (!days?.length) {
    return (
      <p className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
        No saved recommendation, so there is no forward plan yet. The outlook comes from the
        coaching file rather than being guessed by the app.
      </p>
    )
  }

  // Keep the chosen day by date across reloads, falling back to the first.
  const day = selected

  return (
    <div className="mt-4">
      {validity?.expired && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200/60">
          This forecast covers {validity.window.from} – {validity.window.to}, which has passed.
          Ask for refreshed coaching rather than reading these as the coming three days.
        </p>
      )}
      {!validity?.expired && validity?.needsReview && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200/60">
          <p className="font-medium">Something changed that this plan does not account for.</p>
          <ul className="mt-1 list-none space-y-0.5 pl-0">
            {validity.reasons.map(r => <li key={r} className="text-xs">· {r}</li>)}
          </ul>
        </div>
      )}

      <DayPanel
        key={day.date}
        day={day}
        ctx={ctx}
        problems={problems}
        priorDays={priorDays}
        onSelectDay={onSelectDay}
        onOpenProblem={onOpenProblem}
        onGrade={onGrade}
      />
    </div>
  )
}

export { STATUS, workloadOf }
