import { useMemo, useState, useEffect } from 'react'
import { flattenTree, defaultCollapsed } from '../utils/decisionTree'

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
  open: 'bg-white ring-1 ring-slate-300',
  'ruled-out': 'bg-slate-200',
}

const STATE_NOTE = {
  taken: 'the path your results took',
  open: 'still possible',
  'ruled-out': 'ruled out by what you recorded',
}

/**
 * Trunks run through the middle of an indent column rather than its edge, so
 * that a branch descends from under the node it belongs to.
 */
function Guides({ guides }) {
  return guides.map((on, i) => (
    <span key={i} className="relative w-6 shrink-0 self-stretch" aria-hidden="true">
      {on && <span className="absolute left-2 top-0 h-full border-l border-slate-300" />}
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
      <span className={`absolute left-2 top-0 border-l border-slate-300 ${last ? 'h-1/2' : 'h-full'}`} />
      <span className={`absolute left-2 right-0 top-1/2 border-t-2 ${stub}`} />
    </span>
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

/** The node's own plan, shown on hover so the tree can be read without clicking. */
function Peek({ node }) {
  const problems = node.items.filter(i => i.type === 'problem')
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-full z-20 mt-1 rounded-xl bg-slate-900 px-3 py-2 text-left shadow-lg">
      <p className="text-[11px] font-semibold text-white">{node.label}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">
        {node.weekday} {node.date} · {STATE_NOTE[node.state]}
      </p>
      {problems.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-slate-400">No problem work planned.</p>
      ) : (
        <ul className="mt-1.5 list-none space-y-1 pl-0">
          {problems.map(i => (
            <li key={i.key} className="flex items-baseline gap-2 text-[11px] text-slate-200">
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              {i.kind && <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{i.kind}</span>}
              {i.minutes != null && <span className="shrink-0 tabular-nums text-slate-400">{i.minutes}m</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ row, selected, onSelect, expanded, onToggle, today }) {
  const [peek, setPeek] = useState(false)
  const { node, guides, last, hasChildren } = row
  const out = node.state === 'ruled-out'
  const isToday = node.date === today

  return (
    <li>
      <div
        className="relative flex min-h-[2.25rem] items-stretch"
        onMouseEnter={() => setPeek(true)}
        onMouseLeave={() => setPeek(false)}
      >
        <Guides guides={guides} />
        {row.depth > 0 && (
          <Elbow tone={node.edge?.tone} last={last} dashed={node.state === 'open'} faded={out} />
        )}

        <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
          <button
            onClick={() => hasChildren && onToggle(node.id)}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-label={hasChildren ? `${expanded ? 'Collapse' : 'Expand'} what follows ${node.label}` : undefined}
            disabled={!hasChildren}
            className={`flex size-4 shrink-0 items-center justify-center rounded border-0 bg-transparent text-[9px] text-slate-400 ${
              hasChildren ? 'cursor-pointer hover:bg-slate-100 hover:text-slate-700' : 'invisible'
            }`}
          >
            {expanded ? '▾' : '▸'}
          </button>

          <button
            onClick={() => onSelect(node.id)}
            onFocus={() => setPeek(true)}
            onBlur={() => setPeek(false)}
            aria-current={selected ? 'true' : undefined}
            className={`min-w-0 flex-1 rounded-lg border-0 px-2 py-1 text-left transition ${
              selected ? 'bg-slate-900/5 ring-1 ring-slate-900/15' : 'bg-transparent hover:bg-slate-50'
            } ${out ? 'opacity-45' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${DOT[node.state]}`} aria-hidden="true" />
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

            <span className="mt-0.5 flex items-center gap-1.5 pl-4 text-[10px] text-slate-400">
              <span className={`font-semibold uppercase tracking-wider ${isToday ? 'text-slate-900' : ''}`}>
                {node.weekdayShort} {node.date.slice(5)}{isToday && ' · today'}
              </span>
              <span className="tabular-nums"><Workload workload={node.workload} /></span>
            </span>
          </button>
        </div>

        {peek && <Peek node={node} />}
      </div>
    </li>
  )
}

/**
 * The forecast as the branching structure it already is: one node per scenario,
 * one branch per result that would select it.
 */
export default function DecisionTree({ tree, selectedId, onSelect, today }) {
  const [collapsed, setCollapsed] = useState(() => defaultCollapsed(tree.roots))

  // A newly adopted plan gets its own folds rather than inheriting the last one's.
  useEffect(() => setCollapsed(defaultCollapsed(tree.roots)), [tree])

  const rows = useMemo(
    () => flattenTree(tree.roots, id => !collapsed.has(id)),
    [tree, collapsed]
  )

  const toggle = id => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const visibleDepths = useMemo(() => new Set(rows.map(r => r.depth)), [rows])

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
              className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                shown ? 'text-slate-700' : 'text-slate-300'
              } ${fixed ? 'cursor-default' : 'hover:bg-slate-100'}`}
            >
              {!fixed && <span className="mr-1 text-[9px]">{shown ? '▾' : '▸'}</span>}
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
            today={today}
            selected={row.node.id === selectedId}
            onSelect={onSelect}
            expanded={!collapsed.has(row.node.id)}
            onToggle={toggle}
          />
        ))}
      </ul>
    </div>
  )
}
