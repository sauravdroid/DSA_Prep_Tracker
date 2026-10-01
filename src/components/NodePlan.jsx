import { useState } from 'react'
import { dayOutcomes, RESULT_LABEL, RESULT_TONE } from '../utils/decisionTree'
import { Chip, ProblemLink } from './ui'

const KIND_STYLE = {
  new: 'bg-sky-100 text-sky-700',
  cold: 'bg-slate-900 text-white',
  repair: 'bg-rose-100 text-rose-700',
  warm: 'bg-amber-100 text-amber-800',
  learn: 'bg-violet-100 text-violet-700',
}

const ORDER_LABEL = ['First', 'Then', 'After that']

const STATE_CHIP = {
  taken: 'bg-slate-900 text-white',
  open: 'bg-amber-100 text-amber-800',
  'ruled-out': 'bg-slate-200 text-slate-500',
}

const STATE_LABEL = {
  taken: 'on this path',
  open: 'not decided yet',
  'ruled-out': 'ruled out',
}

const RESULT_DOT = {
  green: 'bg-emerald-500 text-white',
  yellow: 'bg-amber-400 text-amber-950',
  red: 'bg-rose-500 text-white',
}

const OUTCOME_CHIP = {
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-rose-100 text-rose-700',
  slate: 'bg-slate-200 text-slate-600',
}

/** Practice modes and plan kinds share a vocabulary, bar first exposure. */
const modeOf = kind => (kind === 'new' ? 'learn' : ['cold', 'warm', 'repair', 'learn'].includes(kind) ? kind : 'cold')

function Task({ item, order, canRecord, canOpen, onOpenProblem, onGrade }) {
  const [open, setOpen] = useState(false)

  return (
    <li className={`rounded-xl border px-4 py-3 ${item.done ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
          item.done ? 'bg-emerald-100 text-emerald-700' : order === 'First' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
        }`}>
          {item.done ? 'Done' : order}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {item.slug
              ? <ProblemLink slug={item.slug} title={item.title} onOpen={onOpenProblem} className="text-sm font-semibold text-slate-900" />
              : <span className="text-sm font-semibold text-slate-900">{item.title}</span>}
            {item.kind && <Chip className={KIND_STYLE[item.kind] || 'bg-slate-100 text-slate-600'}>{item.kind}</Chip>}
            {item.topic && <Chip className="bg-slate-100 text-slate-600">{item.topic}</Chip>}
          </div>
          {(item.purpose || item.why) && (
            <p className="mt-0.5 text-sm text-slate-500">{item.purpose || item.why}</p>
          )}
        </div>

        <span className="shrink-0 text-xs font-medium text-slate-400">
          {item.minutes != null ? `≤${item.minutes} min` : 'no time estimate'}
        </span>

        {item.slug && canOpen && (
          <a href={`https://leetcode.com/problems/${item.slug}/`} target="_blank" rel="noopener noreferrer"
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
            Open
          </a>
        )}
        {item.slug && canRecord && (
          <button onClick={() => onGrade(item.slug, modeOf(item.kind))}
            className={`shrink-0 rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
              item.done
                ? 'border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                : 'bg-slate-900 text-white hover:bg-slate-700'
            }`}>
            {item.done ? 'Update record' : 'Record attempt'}
          </button>
        )}
      </div>

      {item.detail && (
        <>
          <button onClick={() => setOpen(v => !v)} aria-expanded={open}
            className="mt-1.5 border-0 bg-transparent p-0 text-xs font-medium text-slate-500 underline-offset-2 hover:underline">
            {open ? 'Hide explanation' : 'Why this task?'}
          </button>
          {open && <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">{item.detail}</p>}
        </>
      )}
    </li>
  )
}

/**
 * One node of the forecast, as a plan. Recording is offered only where it would
 * mean something: today, on the path the recorded facts actually selected.
 */
export default function NodePlan({ node, today, doneOn, onOpenProblem, onGrade }) {
  if (!node) return null

  const view = node.dayView
  const isToday = node.date === today
  const past = node.date < today
  const canRecord = isToday && node.state === 'taken' && !!onGrade
  const canOpen = node.state !== 'ruled-out'
  const unresolved = node.state === 'taken' ? view.unresolved : null
  // A day that has been and gone is answered by the tracker, not by its plan.
  const done = past ? doneOn?.(node.date) || [] : []
  const outcomes = past ? dayOutcomes(done) : []

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">{node.weekday}</span>
        <span className="text-xs tabular-nums text-slate-400">{node.date}</span>
        {isToday && <Chip className="bg-slate-900 text-white">today</Chip>}
        {outcomes.map(r => (
          <Chip key={r} className={OUTCOME_CHIP[RESULT_TONE[r]]}>{RESULT_LABEL[r]}</Chip>
        ))}
        <Chip className={STATE_CHIP[node.state]}>{STATE_LABEL[node.state]}</Chip>
      </div>

      <h3 className="mt-1 text-base font-semibold tracking-tight text-slate-900">{node.label}</h3>

      {node.edge && (
        <p className="mt-1 text-xs text-slate-500">
          {node.state === 'taken' ? 'Reached because the result was ' : 'Applies if the result is '}
          <span className="font-semibold text-slate-700">{node.edge.label}</span>.
          {node.edgeApproximate && ' This link is inferred — the saved file does not state it outright.'}
        </p>
      )}
      {!node.edge && node.basis && <p className="mt-1 text-xs text-slate-500">{node.basis}</p>}
      {view.note && <p className="mt-1 text-xs text-slate-500">{view.note}</p>}

      {!isToday && !past && node.state !== 'ruled-out' && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          This is {node.weekday}'s plan. Results are recorded on the day they happen, so
          nothing here can be graded yet.
        </p>
      )}

      {past && (
        <section className="mt-3">
          <div className="flex items-center gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Recorded that day</h4>
            <span className="text-[11px] tabular-nums text-slate-400">{done.length}</span>
            {done.length > 0 && outcomes.length === 0 && (
              <span className="text-[11px] text-slate-400">no grade recorded</span>
            )}
            <span className="h-px flex-1 bg-slate-100" aria-hidden="true" />
          </div>
          {done.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Nothing was recorded on {node.date}.</p>
          ) : (
            <div className="mt-2 space-y-1.5 rounded-xl bg-slate-50 px-4 py-3">
              {done.map(e => (
                <div key={e.key} className="flex flex-wrap items-center gap-2 text-sm">
                  {e.kind === 'attempt' ? (
                    <span
                      title={`graded ${e.result}`}
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${RESULT_DOT[e.result] || 'bg-slate-200 text-slate-500'}`}
                    >
                      {(e.result || '?')[0].toUpperCase()}
                    </span>
                  ) : (
                    <Chip className="bg-emerald-100 text-emerald-700">{e.kind}</Chip>
                  )}
                  <ProblemLink slug={e.slug} title={e.problem?.title} onOpen={onOpenProblem} className="font-medium text-slate-800" />
                  {e.tracked?.map(t => <Chip key={t} className="bg-slate-100 text-slate-600">{t}</Chip>)}
                  {e.kind === 'attempt' && (
                    <span className="text-xs text-slate-400">
                      {e.mode}
                      {e.timeMinutes != null && ` · ${e.timeMinutes}m`}
                      {e.help && e.help !== 'none' && ` · ${e.help}`}
                      {e.sessionRepeat && ' · repeat'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {unresolved && (
        <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200/60">
          <p className="text-sm font-medium text-amber-900">{unresolved.message}</p>
          {unresolved.reason && <p className="mt-0.5 text-xs text-amber-800">{unresolved.reason}</p>}
          {unresolved.slug && isToday && onGrade && (
            <button onClick={() => onGrade(unresolved.slug, unresolved.mode || 'cold')}
              className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700">
              Record that result
            </button>
          )}
        </div>
      )}

      {node.items.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No work is planned on this branch.
        </p>
      ) : (
        <>
          {past && (
            <div className="mt-4 flex items-center gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">What was planned</h4>
              <span className="h-px flex-1 bg-slate-100" aria-hidden="true" />
            </div>
          )}
          <ol className="mt-3 list-none space-y-2 pl-0">
            {node.items.map((item, i) => (
              <Task
                key={item.key}
                item={item}
                order={ORDER_LABEL[i] || `Step ${i + 1}`}
                canRecord={canRecord}
                canOpen={canOpen}
                onOpenProblem={onOpenProblem}
                onGrade={onGrade}
              />
            ))}
          </ol>
        </>
      )}

      {node.followUps.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Follow-up</span>
          <ul className="mt-1 list-none space-y-0.5 pl-0">
            {node.followUps.map((f, i) => (
              <li key={i} className="text-xs text-slate-600">
                · {f.text}
                {f.date && <span className="ml-1 font-medium text-slate-500">({f.date})</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate-400">Not extra work for {node.weekdayShort}.</p>
        </div>
      )}
    </div>
  )
}
