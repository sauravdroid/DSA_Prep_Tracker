import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { treeRows, defaultCollapsed, dayOutcomes, nodeProgress, RESULT_LABEL, RESULT_TONE } from '../utils/decisionTree'

const LINE = {
  red: 'border-rose-400',
  amber: 'border-amber-400',
  emerald: 'border-emerald-400',
  slate: 'border-slate-300',
}

const PILL = {
  red: 'bg-rose-100 text-rose-700',
  amber: 'bg-amber-100 text-amber-800',
  emerald: 'bg-emerald-100 text-emerald-700',
  slate: 'bg-slate-100 text-slate-600',
}

const DOT = {
  taken: 'bg-slate-900',
  complete: 'bg-emerald-500',
  open: 'bg-white ring-1 ring-slate-300',
  'ruled-out': 'bg-slate-200',
}

const STATE_NOTE = {
  taken: 'the path your results took',
  open: 'still possible',
  'ruled-out': 'ruled out by what you recorded',
}

const RESULT_TEXT = {
  green: 'text-emerald-600',
  yellow: 'text-amber-600',
  red: 'text-rose-600',
}

const PEEK_WIDTH = 320
const PEEK_GAP = 10
const CLOSE_GRACE_MS = 120

/**
 * Trunks run through the middle of an indent column rather than its edge, so
 * that a branch descends from under the chevron of the node it belongs to.
 */
function Guides({ guides }) {
  return guides.map((on, i) => (
    <span key={i} className="relative w-6 shrink-0 self-stretch" aria-hidden="true">
      {on && <span className="absolute left-2.5 top-0 h-full border-l border-slate-300" />}
    </span>
  ))
}

/**
 * The elbow into this node. The trunk stays neutral because it is shared by
 * every sibling; only the stub reaching this node carries its result's colour.
 */
function Elbow({ tone, last, dashed, faded }) {
  const stub = `${LINE[tone] || LINE.slate} ${dashed ? 'border-dashed' : ''} ${faded ? 'opacity-30' : ''}`
  return (
    <span className="relative w-6 shrink-0 self-stretch" aria-hidden="true">
      <span className={`absolute left-2.5 top-0 border-l border-slate-300 ${last ? 'h-1/2' : 'h-full'}`} />
      <span className={`absolute left-2.5 right-0 top-1/2 border-t-2 ${stub}`} />
    </span>
  )
}

function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

function Workload({ workload }) {
  const w = workload
  if (!w || w.problems == null) return null
  if (w.problems === 0) return <>no problems</>
  return (
    <>
      {w.problems} problem{w.problems !== 1 ? 's' : ''}
      {w.timeComplete && ` · ${w.minutes} min`}
    </>
  )
}

/** How the day turned out, in the same colours the branches use. */
function Outcomes({ outcomes, className = '' }) {
  if (outcomes.length === 0) return null
  return outcomes.map(r => (
    <span key={r} className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${PILL[RESULT_TONE[r]]} ${className}`}>
      {RESULT_LABEL[r]}
    </span>
  ))
}

function PeekLine({ slug, title, meta, metaClass = 'text-slate-400', done, onOpen }) {
  const body = (
    <>
      <span className={`shrink-0 text-emerald-600 ${done ? '' : 'invisible'}`} aria-hidden="true">✓</span>
      <span className={`min-w-0 flex-1 truncate ${done ? 'text-slate-400 line-through decoration-slate-300' : ''}`}>{title}</span>
      <span className={`shrink-0 text-[10px] uppercase tracking-wide ${metaClass}`}>{meta}</span>
    </>
  )
  if (!slug) return <li className="flex items-baseline gap-2 px-1 py-0.5 text-xs text-slate-600">{body}</li>
  return (
    <li>
      <button
        onClick={() => onOpen(slug, title)}
        title="View problem details"
        className="flex w-full items-baseline gap-2 rounded-md border-0 bg-transparent px-1 py-0.5 text-left text-xs text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
      >
        {body}
      </button>
    </li>
  )
}

/** What a node holds, shown beside it so the tree reads without being clicked. */
function Peek({ node, done, arrived, at, onOpenProblem, onEnter, onLeave }) {
  const problems = node.items.filter(i => i.type === 'problem')
  const outcomes = arrived ? dayOutcomes(done) : []

  return createPortal(
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ top: at.top, left: at.left, width: PEEK_WIDTH }}
      className="peek-in fixed z-50 rounded-xl bg-white px-3 py-2.5 text-left shadow-2xl ring-1 ring-slate-900/10"
    >
      <p className="text-xs font-semibold text-slate-900">{node.label}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">
        {node.weekday} {node.date} · {STATE_NOTE[node.state]}
      </p>

      {arrived && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Recorded</span>
            <Outcomes outcomes={outcomes} />
            {outcomes.length === 0 && done.length > 0 && (
              <span className="text-[10px] text-slate-400">no grade</span>
            )}
          </div>
          {done.length === 0 ? (
            <p className="mt-0.5 px-1 text-xs text-slate-400">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-0.5 list-none space-y-0.5 pl-0">
              {done.map(e => {
                const graded = e.attempts[e.attempts.length - 1]
                const activity = [e.solved && 'solved', e.revised && 'revised'].filter(Boolean).join(' · ')
                return (
                  <PeekLine
                    key={e.key}
                    slug={e.slug}
                    title={e.problem?.title || e.slug}
                    done
                    meta={graded ? `${graded.mode} · ${graded.result}` : activity}
                    metaClass={graded ? RESULT_TEXT[graded.result] || 'text-slate-400' : 'text-slate-400'}
                    onOpen={onOpenProblem}
                  />
                )
              })}
            </ul>
          )}
        </>
      )}

      {arrived && <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Planned</p>}
      {problems.length === 0 ? (
        <p className={`${arrived ? 'mt-0.5' : 'mt-2'} px-1 text-xs text-slate-400`}>No problem work planned.</p>
      ) : (
        <ul className={`${arrived ? 'mt-0.5' : 'mt-2'} list-none space-y-0.5 pl-0`}>
          {problems.map(i => (
            <PeekLine
              key={i.key}
              slug={i.slug}
              title={i.title}
              done={i.done}
              meta={[i.kind, i.minutes != null ? `${i.minutes}m` : null].filter(Boolean).join(' · ')}
              onOpen={onOpenProblem}
            />
          ))}
        </ul>
      )}
    </div>,
    document.body
  )
}

function Row({ row, selectedId, onSelect, collapsed, onToggle, today, doneOn, onOpenProblem }) {
  const [at, setAt] = useState(null)
  const rowRef = useRef(null)
  const closing = useRef(null)

  const { node, guides, last, hasChildren, children } = row
  const out = node.state === 'ruled-out'
  const isToday = node.date === today
  // A day that has arrived is described by what it recorded; one still ahead
  // can only be described by what it plans.
  const arrived = node.date <= today
  const done = arrived ? doneOn?.(node.date) || [] : []
  const outcomes = arrived ? dayOutcomes(done) : []
  const progress = nodeProgress(node, today)
  const open = !collapsed.has(node.id)
  const selected = node.id === selectedId

  const hold = useCallback(() => clearTimeout(closing.current), [])

  const show = useCallback(() => {
    hold()
    const r = rowRef.current?.getBoundingClientRect()
    if (!r) return
    const right = r.right + PEEK_GAP
    const left = right + PEEK_WIDTH <= window.innerWidth - 12
      ? right
      : Math.max(12, r.left - PEEK_GAP - PEEK_WIDTH)
    setAt({ top: Math.min(r.top, window.innerHeight - 260), left })
  }, [hold])

  const hide = useCallback(() => {
    closing.current = setTimeout(() => setAt(null), CLOSE_GRACE_MS)
  }, [])

  // Fixed coordinates stop meaning anything once the page moves under them.
  useEffect(() => {
    if (!at) return
    const drop = () => setAt(null)
    window.addEventListener('scroll', drop, true)
    return () => window.removeEventListener('scroll', drop, true)
  }, [at])

  useEffect(() => () => clearTimeout(closing.current), [])

  return (
    <li>
      <div
        ref={rowRef}
        className="relative flex min-h-[2.25rem] items-stretch"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <Guides guides={guides} />
        {row.depth > 0 && (
          <Elbow tone={node.edge?.tone} last={last} dashed={node.state === 'open'} faded={out} />
        )}

        <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
          <button
            onClick={() => hasChildren && onToggle(node.id)}
            aria-expanded={hasChildren ? open : undefined}
            aria-label={hasChildren ? `${open ? 'Collapse' : 'Expand'} what follows ${node.label}` : undefined}
            disabled={!hasChildren}
            className={`flex size-5 shrink-0 items-center justify-center rounded border-0 bg-transparent text-slate-400 ${
              hasChildren ? 'cursor-pointer hover:bg-slate-100 hover:text-slate-700' : 'invisible'
            }`}
          >
            <Chevron open={open} />
          </button>

          <button
            onClick={() => onSelect(node.id)}
            onFocus={show}
            onBlur={hide}
            aria-current={selected ? 'true' : undefined}
            className={`min-w-0 flex-1 rounded-lg border-0 px-2 py-1 text-left transition ${
              selected ? 'bg-slate-900/5 ring-1 ring-slate-900/15' : 'bg-transparent hover:bg-slate-50'
            } ${out ? 'opacity-45' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${
                arrived && progress.complete && node.state === 'taken' ? DOT.complete : DOT[node.state]
              }`} aria-hidden="true" />
              {node.edge && (
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${PILL[node.edge.tone] || PILL.slate}`}>
                  {node.edge.label}
                </span>
              )}
              <span className={`min-w-0 flex-1 truncate text-xs ${
                node.state === 'taken' ? 'font-semibold text-slate-900' : 'text-slate-700'
              }`}>
                {node.label}
              </span>
            </span>

            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-4 text-[10px] text-slate-400">
              <span className={`font-semibold uppercase tracking-wider ${isToday ? 'text-slate-900' : ''}`}>
                {node.weekdayShort} {node.date.slice(5)}{isToday && ' · today'}
              </span>
              <Outcomes outcomes={outcomes} />
              <span className="tabular-nums">
                {!arrived
                  ? <Workload workload={node.workload} />
                  : progress.total > 0
                    ? `${progress.done} of ${progress.total} done`
                    : done.length === 0 ? 'nothing recorded' : `${done.length} recorded`}
              </span>
            </span>
          </button>
        </div>

        {at && (
          <Peek
            node={node}
            done={done}
            arrived={arrived}
            at={at}
            onOpenProblem={(slug, title) => { setAt(null); onOpenProblem?.(slug, title) }}
            onEnter={hold}
            onLeave={hide}
          />
        )}
      </div>

      {hasChildren && (
        // Animating the row track lets a subtree open to its own height without
        // anyone having to measure it first.
        <div
          inert={!open}
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        >
          <div className="overflow-hidden">
            <ul className="list-none pl-0">
              {children.map(child => (
                <Row
                  key={child.node.id}
                  row={child}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  today={today}
                  doneOn={doneOn}
                  onOpenProblem={onOpenProblem}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * The forecast as the branching structure it already is: one node per scenario,
 * one branch per result that would select it.
 */
export default function DecisionTree({ tree, selectedId, onSelect, today, doneOn, onOpenProblem }) {
  const [collapsed, setCollapsed] = useState(() => defaultCollapsed(tree.roots))

  // A newly adopted plan gets its own folds rather than inheriting the last one's.
  useEffect(() => setCollapsed(defaultCollapsed(tree.roots)), [tree])

  const rows = useMemo(() => treeRows(tree.roots), [tree])

  const toggle = id => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const visibleDepths = useMemo(() => {
    const seen = new Set()
    const walk = list => list.forEach(n => {
      seen.add(n.depth)
      if (!collapsed.has(n.id)) walk(n.children)
    })
    walk(tree.roots)
    return seen
  }, [tree, collapsed])

  // Hiding a date has to hide the ones after it too: their branches would
  // otherwise hang off a parent that is no longer on screen.
  const toggleDate = depth => setCollapsed(prev => {
    const next = new Set(prev)
    const shown = visibleDepths.has(depth)
    for (const node of tree.nodes) {
      if (shown && node.depth === depth - 1) next.add(node.id)
      else if (!shown && node.depth < depth) next.delete(node.id)
    }
    return next
  })

  const setAll = value => setCollapsed(value ? new Set(tree.nodes.map(n => n.id)) : new Set())

  if (tree.roots.length === 0) return null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2">
        {tree.dates.map(d => {
          const shown = visibleDepths.has(d.depth)
          const fixed = d.depth === 0
          return (
            <button
              key={d.date}
              onClick={() => !fixed && toggleDate(d.depth)}
              disabled={fixed}
              aria-pressed={fixed ? undefined : shown}
              title={fixed ? 'The first day is always shown' : `${shown ? 'Hide' : 'Show'} ${d.date} and after`}
              className={`flex items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                shown ? 'text-slate-700' : 'text-slate-300'
              } ${fixed ? 'cursor-default' : 'hover:bg-slate-100'}`}
            >
              {!fixed && <Chevron open={shown} />}
              {d.weekdayShort} {d.date.slice(5)}
            </button>
          )
        })}
        <span className="ml-auto flex items-center gap-1">
          <button onClick={() => setAll(false)}
            className="rounded-md border-0 bg-transparent px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
            Expand all
          </button>
          <button onClick={() => setAll(true)}
            className="rounded-md border-0 bg-transparent px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
            Collapse all
          </button>
        </span>
      </div>

      <ul className="mt-1 list-none pl-0">
        {rows.map(row => (
          <Row
            key={row.node.id}
            row={row}
            selectedId={selectedId}
            onSelect={onSelect}
            collapsed={collapsed}
            onToggle={toggle}
            today={today}
            doneOn={doneOn}
            onOpenProblem={onOpenProblem}
          />
        ))}
      </ul>
    </div>
  )
}
