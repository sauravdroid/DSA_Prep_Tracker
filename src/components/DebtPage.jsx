import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { computeRetention, daysBetween, HEALTH, ROLES, suggestAnchors } from '../utils/retention'
import { loadDecision, saveDecision, loadDays, decisionStaleness, forecastValidity, trackerSnapshot } from '../utils/coaching'
import { pullCoaching, coachingHistory, backupIfConnected, getRepo } from '../utils/github'
import { getSyncState } from '../utils/dataFile'
import { todayStr } from '../utils/dateUtils'
import { buildDayTree } from '../utils/decisionTree'
import { decisionToDays } from '../utils/days'
import ColdTestModal from './ColdTestModal'
import ProblemDrawer from './ProblemDrawer'
import DecisionTree from './DecisionTree'
import NodePlan from './NodePlan'
import RemoteFreshness from './RemoteFreshness'
import { Chip, ProblemLink } from './ui'
import * as store from '../store'

const HEALTH_STYLE = {
  unmeasured: 'bg-slate-200 text-slate-600',
  fragile: 'bg-rose-100 text-rose-700',
  maintained: 'bg-amber-100 text-amber-800',
  stable: 'bg-emerald-100 text-emerald-700',
}

const ROLE_STYLE = {
  focus: 'bg-sky-100 text-sky-700',
  maintenance: 'bg-violet-100 text-violet-700',
  paused: 'bg-slate-200 text-slate-500',
}

const MODE_STYLE = {
  EXPANSION: { bar: 'bg-emerald-500', text: 'text-emerald-600' },
  MIXED: { bar: 'bg-amber-500', text: 'text-amber-600' },
  CONSOLIDATION: { bar: 'bg-rose-500', text: 'text-rose-600' },
}

const RESULT_DOT = {
  green: 'bg-emerald-500 text-white',
  yellow: 'bg-amber-400 text-amber-950',
  red: 'bg-rose-500 text-white',
  none: 'bg-slate-200 text-slate-500',
}

const ANCHOR_STATE_STYLE = {
  'unmeasured': 'bg-slate-100 text-slate-600',
  'failed cold test': 'bg-rose-100 text-rose-700',
  'due for validation': 'bg-amber-100 text-amber-800',
  'scheduled': 'bg-emerald-50 text-emerald-700',
}

function SectionHeading({ label, count }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</h3>
      {count != null && <span className="text-[11px] tabular-nums text-slate-400">{count}</span>}
      <span className="h-px flex-1 bg-slate-100" aria-hidden="true" />
    </div>
  )
}

function dueLabel(anchor, today) {
  if (!anchor.isDue) {
    const d = daysBetween(today, anchor.due)
    return d === 1 ? 'in 1 day' : `in ${d} days`
  }
  if (anchor.daysOverdue === 0) return 'due today'
  return `${anchor.daysOverdue}d overdue`
}

/* ---------- Headline ---------- */

/**
 * The grade is already saved locally by the time this shows, so a failed backup
 * is reported as unpublished work rather than as a lost attempt.
 */
function BackupNote({ backup, onDismiss }) {
  if (!backup) return null

  const tone = backup.state === 'failed'
    ? 'bg-amber-50 text-amber-900 ring-amber-200'
    : 'bg-slate-50 text-slate-600 ring-slate-200'

  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ring-1 ${tone}`}>
      <span className="flex-1">
        {backup.state === 'running' && 'Publishing to the data repository…'}
        {backup.state === 'done' && (
          <>Recorded and published{backup.commit ? <> · <code className="font-mono">{backup.commit}</code></> : null}. The coach can read it.</>
        )}
        {backup.state === 'failed' && (
          <>Recorded and saved locally, but publishing failed: {backup.error}. The coach will not see it until this is pushed.</>
        )}
      </span>
      {backup.state !== 'running' && (
        <button onClick={onDismiss} className="shrink-0 border-0 bg-transparent p-0 font-medium underline-offset-2 hover:underline">
          Dismiss
        </button>
      )}
    </div>
  )
}
function TodayHeadline({ retention, decision, dayPlans, staleness, validity, practiceLog, today, onGrade, onOpenSetup, onOpenProblem, onOpenCoaching }) {
  const { mode, modeProvisional, plan, totalDebt, debtCalculable, agenda, doneToday, trackedCount } = retention
  const roleOf = name => retention.topics.find(t => t.name === name)?.role
  const ms = MODE_STYLE[mode.key]
  const d = decision

  // Day files are the record of what was planned for each date, so they stand
  // whatever the latest assessment says. Converting the adopted decision is the
  // fallback for a store that has not been filled yet.
  const dayList = useMemo(() => {
    const stored = Object.values(dayPlans || {})
    if (stored.length > 0) return stored
    return d && !staleness.stale ? decisionToDays(d) : []
  }, [dayPlans, d, staleness.stale])

  const tree = useMemo(
    () => buildDayTree(dayList, { practiceLog, anchors: retention.anchorList, today }),
    [dayList, practiceLog, retention.anchorList, today]
  )
  const coached = tree.roots.length > 0

  // Today is the day you can act on, so it opens on the branch the facts picked.
  const defaultNodeId = useMemo(() => {
    const onToday = tree.nodes.filter(n => n.date === today)
    return (onToday.find(n => n.state === 'taken') || onToday[0] || tree.roots[0])?.id || null
  }, [tree, today])

  const [pickedId, setPickedId] = useState(null)
  useEffect(() => setPickedId(null), [defaultNodeId])
  const selectedId = pickedId || defaultNodeId
  const selectedNode = tree.nodes.find(n => n.id === selectedId) || null

  const headline = d?.mode?.headline
    || (trackedCount === 0 ? 'Set up your topics' : `${mode.label}${modeProvisional ? ' (provisional)' : ''} — ${plan.retentionCount > 0 ? 'baseline validation' : 'keep learning'}`)

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
      <div className={`h-1 ${ms.bar}`} />
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Today · {today}
            </span>
            <h2 className={`mt-0.5 text-2xl font-bold tracking-tight ${ms.text}`}>{headline}</h2>
          </div>

          <div className="shrink-0 text-right">
            {debtCalculable ? (
              <>
                <div className="text-3xl font-bold leading-none tracking-tight text-slate-900">
                  {totalDebt}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">retention debt</div>
              </>
            ) : (
              <div className="text-[11px] leading-tight text-slate-400">
                debt not yet
                <br />
                calculable
              </div>
            )}
          </div>
        </div>

        {!debtCalculable && trackedCount > 0 && (
          <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            No tracked anchor has an eligible cold test yet, so retention debt is unknown
            rather than zero. Mode is provisional until one is recorded.
          </p>
        )}

        {coached && validity?.expired && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200/60">
            This forecast covers {validity.window.from} – {validity.window.to}, which has passed.
            Ask for refreshed coaching rather than reading these as the coming days.
          </p>
        )}
        {coached && !validity?.expired && validity?.needsReview && (
          <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200/60">
            <p className="font-medium">Something changed that this plan does not account for.</p>
            <ul className="mt-1 list-none space-y-0.5 pl-0">
              {validity.reasons.map(r => <li key={r} className="text-xs">· {r}</li>)}
            </ul>
          </div>
        )}

        {coached ? (
          <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(21rem,27rem)]">
            {/* Keyed so moving between branches animates rather than snapping. */}
            <div key={selectedId} className="panel-in min-w-0">
              <NodePlan node={selectedNode} today={today} doneOn={retention.doneOn} onOpenProblem={onOpenProblem} onGrade={onGrade} />
            </div>
            <div className="min-w-0 2xl:border-l 2xl:border-slate-100 2xl:pl-5">
              <DecisionTree tree={tree} selectedId={selectedId} onSelect={setPickedId} today={today} doneOn={retention.doneOn} onOpenProblem={onOpenProblem} />
            </div>
          </div>
        ) : (
        <section className="mt-5">
          <SectionHeading label="Do now" />
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-2.5 text-xs ring-1 ring-slate-200">
              <span className="min-w-0 flex-1 text-slate-600">
                {d
                  ? 'The adopted plan no longer fits today, so this day is worked out from your own records rather than coached.'
                  : 'No coaching plan adopted. This day is worked out from your own records.'}
              </span>
              {onOpenCoaching && (
                <button
                  onClick={onOpenCoaching}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 transition hover:bg-white"
                >
                  {d ? 'Fetch a newer plan' : 'Fetch a plan'}
                </button>
              )}
            </div>
          {agenda.map(a => (
              <div key={a.slug} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  a.order === 'Do now' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {a.order === 'Do now' ? 'First' : a.order}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProblemLink
                      slug={a.slug}
                      title={a.problem?.title}
                      onOpen={onOpenProblem}
                      className="font-medium text-slate-900"
                    />
                    <Chip className={ROLE_STYLE[a.role]}>{a.topic}</Chip>
                    <Chip className="bg-slate-100 text-slate-600">{a.suggestedMode} test</Chip>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">{a.reason}</p>
                </div>
                <span className="shrink-0 text-xs font-medium text-slate-400">≤{a.minutes} min</span>
                {a.problem?.url && (
                  <a href={a.problem.url} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                    Open
                  </a>
                )}
                <button onClick={() => onGrade(a.slug, a.suggestedMode)}
                  className="shrink-0 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700">
                  Record attempt
                </button>
              </div>
            ))}

          {trackedCount > 0 && agenda.length === 0 && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200/60">
              Nothing due. Every anchor is inside its interval — spend the day on new material.
            </p>
          )}

          {trackedCount === 0 && (
            <button onClick={onOpenSetup}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
              Choose what you are learning and maintaining
            </button>
          )}
          </div>
        </section>
        )}

        {/* Done — derived from the tracker, never from the coaching file */}
        <section className="mt-5 border-t border-slate-100 pt-4">
          <SectionHeading label="Done" count={doneToday.length} />
          {doneToday.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Nothing recorded yet today.</p>
          ) : (
            <div className="mt-2 rounded-xl bg-slate-50 px-4 py-3">
              <div className="space-y-1.5">
                {doneToday.map(item => (
                  <div key={item.key} className="flex flex-wrap items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-white/70">
                    {item.attempts.map(a => (
                      <span key={a.id} title={`graded ${a.result}`}
                        className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${RESULT_DOT[a.result] || 'bg-slate-200 text-slate-500'}`}>
                        {(a.result || '?')[0].toUpperCase()}
                      </span>
                    ))}
                    {item.attempts.length === 0 && (
                      <Chip className="bg-emerald-100 text-emerald-700">{item.solved ? 'solved' : 'revised'}</Chip>
                    )}

                    <ProblemLink slug={item.slug} title={item.problem?.title} onOpen={onOpenProblem} className="font-medium text-slate-800" />

                    {/* Which track this belongs to; tracked topics stand out. */}
                    {item.tracked?.length > 0
                      ? item.tracked.map(t => <Chip key={t} className={ROLE_STYLE[roleOf(t)] || 'bg-slate-100 text-slate-600'}>{t}</Chip>)
                      : item.all?.slice(0, 2).map(t => (
                        <Chip key={t} className="bg-slate-100 text-slate-500">{t}</Chip>
                      ))}
                    {item.tracked?.length === 0 && item.all?.length > 0 && (
                      <span className="text-[11px] text-slate-400">not a tracked topic</span>
                    )}

                    {item.attempts.map(a => (
                      <span key={`meta:${a.id}`} className="text-xs text-slate-400">
                        {a.mode}
                        {a.timeMinutes != null && ` · ${a.timeMinutes}m`}
                        {a.help && a.help !== 'none' && ` · ${a.help}`}
                        {a.sessionRepeat && ' · repeat'}
                      </span>
                    ))}

                    {/* Resubmissions come from LeetCode, so they are their own
                        fact even when the problem was also graded by hand. */}
                    {item.attempts.length > 0 && item.solved && <Chip className="bg-slate-100 text-slate-500">solved</Chip>}
                    {item.attempts.length > 0 && item.revised && <Chip className="bg-slate-100 text-slate-500">revised</Chip>}
                  </div>
                ))}
              </div>
              {!doneToday.some(i => i.attempts.length > 0) && (
                <p className="mt-2 text-xs text-slate-500">
                  Solves and revisions are activity, not retention evidence. Only a recorded
                  attempt counts toward validation.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Decision provenance */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {d ? (
            <>
              <span className="text-slate-500">
                Recommendation written {(d.assessedAt || '').slice(0, 10)}
                {d.trackerSnapshot?.attempts != null && ` from ${d.trackerSnapshot.attempts} attempts`}
              </span>
              {staleness.stale && (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                  needs refreshing
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-400">
              No saved recommendation — showing the app's own derivation.
            </span>
          )}
        </div>
        {staleness.stale && d && (
          <ul className="mt-1 space-y-0.5">
            {staleness.reasons.map(r => (
              <li key={r} className="text-xs text-amber-700">· {r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const STATE_COLOR = {
  scheduled: '#10b981',
  'due for validation': '#f59e0b',
  'failed cold test': '#f43f5e',
  unmeasured: '#cbd5e1',
}

/** How much of the tracked set is still unproven. */
function RemainingChart({ summary, trackedCount }) {
  if (!summary || summary.total === 0) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
        <h3 className="text-sm font-semibold text-slate-900">What remains</h3>
        <p className="mt-2 text-sm text-slate-400">
          {trackedCount === 0 ? 'Track a topic to see coverage.' : 'No anchors yet.'}
        </p>
      </div>
    )
  }

  const data = Object.entries(summary.byState)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))
  const pct = Math.round((summary.validated / summary.total) * 100)

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <h3 className="text-sm font-semibold text-slate-900">What remains</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        {summary.total} anchor{summary.total !== 1 ? 's' : ''} across your tracked topics.
      </p>

      <div className="mt-2 flex items-center gap-4">
        <div className="relative size-32 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="62%"
                outerRadius="100%"
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {data.map(d => (
                  <Cell key={d.name} fill={STATE_COLOR[d.name] || '#cbd5e1'} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, n) => [`${v} anchor${v !== 1 ? 's' : ''}`, n]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold leading-none text-slate-900">{pct}%</span>
            <span className="text-[10px] text-slate-400">validated</span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {data.map(d => (
            <li key={d.name} className="flex items-center gap-2 text-xs">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: STATE_COLOR[d.name] }} />
              <span className="min-w-0 flex-1 truncate text-slate-600">{d.name}</span>
              <span className="font-semibold text-slate-900">{d.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Branch rules apply to any day, so they live outside the day tabs. */
function Branches({ decision }) {
  const branches = decision?.branches
  if (!branches?.length) return null

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <h3 className="text-sm font-semibold text-slate-900">What changes the plan</h3>
      <p className="mt-0.5 text-xs text-slate-500">Applies to whichever anchor you grade next.</p>
      <ul className="mt-3 space-y-2">
        {branches.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-600">
            {/* self-start stops the pill stretching to the wrapped text height */}
            <span className={`mt-0.5 shrink-0 self-start rounded px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none ${
              b.if === 'green' ? 'bg-emerald-100 text-emerald-700'
                : b.if === 'yellow' ? 'bg-amber-100 text-amber-800'
                  : b.if === 'red' ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-100 text-slate-600'
            }`}>
              {b.if}
            </span>
            {b.then}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Setup ---------- */

function SetupPanel({ topics, onSetRole, onClose }) {
  const [query, setQuery] = useState('')
  const list = topics.filter(t => !query || t.name.toLowerCase().includes(query.toLowerCase())).slice(0, 40)

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">Topic roles</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
            <strong className="font-semibold text-sky-700">Learning</strong> is where new material goes.
            <strong className="font-semibold text-violet-700"> Maintaining</strong> is what must not decay.
            <strong className="text-slate-700"> Paused</strong> keeps the history but schedules nothing.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700">
            Done
          </button>
        )}
      </div>

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter topics..."
        className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
      />

      <div className="mt-3 max-h-96 space-y-1 overflow-y-auto">
        {list.map(t => (
          <div key={t.name} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
            <span className="flex-1 text-sm font-medium text-slate-700">{t.name}</span>
            <span className="text-xs text-slate-400">{t.problemCount} solved</span>
            <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-200">
              {[
                { key: 'focus', label: 'Learning', on: 'bg-sky-600 text-white' },
                { key: 'maintenance', label: 'Maintaining', on: 'bg-violet-600 text-white' },
                { key: 'paused', label: 'Paused', on: 'bg-slate-500 text-white' },
                { key: null, label: 'Off', on: 'bg-slate-700 text-white' },
              ].map(opt => (
                <button key={opt.label} onClick={() => onSetRole(t.name, opt.key)}
                  className={`px-3 py-1 text-xs font-medium transition ${
                    (t.role || null) === opt.key ? opt.on : 'bg-white text-slate-500 hover:bg-slate-100'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- Topic detail ---------- */

/** Inline picker for adding a representative problem to a subpattern. */
function AnchorPicker({ topic, onAdd, onClose }) {
  const [query, setQuery] = useState('')
  const used = new Set(topic.anchors.map(a => a.slug))
  const matches = topic.candidates
    .filter(p => !used.has(p.slug))
    .filter(p => !query || p.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8)

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${topic.name} problems...`}
          autoFocus
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
        />
        <button onClick={onClose}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700">
          Done
        </button>
      </div>
      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {matches.map(p => (
          <button key={p.slug} onClick={() => onAdd(p.slug)}
            className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm transition hover:border-slate-900/20 hover:bg-slate-50">
            <span className="min-w-0 flex-1 truncate text-slate-700">{p.title}</span>
            {(p.failedCount || 0) > 0 && <Chip className="bg-rose-100 text-rose-600">✗{p.failedCount}</Chip>}
            {p.acRate != null && <Chip className="bg-slate-100 text-slate-500">{Math.round(p.acRate)}%</Chip>}
          </button>
        ))}
        {matches.length === 0 && (
          <p className="py-2 text-center text-sm text-slate-400">No matching problems.</p>
        )}
      </div>
    </div>
  )
}

function AnchorRow({ anchor, today, onGrade, onOpenProblem, onRemove }) {
  const p = anchor.problem
  return (
    <div className={`group flex items-center gap-3 rounded-lg px-3 py-2 transition ${
      anchor.needsRepair ? 'bg-rose-50/70' : anchor.isDue ? 'bg-amber-50/70' : 'hover:bg-slate-50'
    }`}>
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${RESULT_DOT[anchor.lastResult || 'none']}`}
        title={anchor.lastResult ? `last graded ${anchor.lastResult}` : 'never cold tested'}>
        {anchor.lastResult ? anchor.lastResult[0].toUpperCase() : '·'}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <ProblemLink slug={anchor.slug} title={p?.title} onOpen={onOpenProblem} className="text-sm font-medium text-slate-800" />
          <Chip className={ANCHOR_STATE_STYLE[anchor.state]}>{anchor.state}</Chip>
          {anchor.needsRepair && <Chip className="bg-rose-600 text-white">repair first</Chip>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Chip className="bg-slate-100 text-slate-500">
            {anchor.coldTests.length} cold test{anchor.coldTests.length !== 1 ? 's' : ''}
          </Chip>
          <Chip className={anchor.isDue ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}>
            {dueLabel(anchor, today)}
          </Chip>
          <Chip className="bg-slate-100 text-slate-500">{anchor.interval}d interval</Chip>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {p?.url && (
          <a href={p.url} target="_blank" rel="noopener noreferrer" title="Open on LeetCode"
            className="rounded-md p-1.5 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14 21 3" />
            </svg>
          </a>
        )}
        <button onClick={() => onGrade(anchor.slug, anchor.needsRepair ? 'repair' : 'cold')}
          className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-700">
          Record
        </button>
        {onRemove && (
          <button onClick={() => onRemove(anchor.slug)} title="Remove this anchor"
            className="rounded-md p-1.5 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- Page ---------- */

/* ---------- Coaching source ---------- */

/**
 * Which revision is being followed. The disk file is a pinned copy, so naming
 * it as the source invites the reader to treat a cache as the origin.
 */
function AdoptedFrom({ from, path, hasDecision }) {
  if (!hasDecision) {
    return (
      <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        No plan adopted yet. Fetch one below.
      </p>
    )
  }

  const when = from?.adoptedAt ? new Date(from.adoptedAt).toLocaleString() : null

  return (
    <div className="mt-2 space-y-1">
      {from?.repo && from?.shortCommit ? (
        <code className="block overflow-x-auto rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] text-slate-700">
          {from.repo}@{from.shortCommit} · {from.path}
        </code>
      ) : from?.source === 'file' ? (
        <code className="block overflow-x-auto rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] text-slate-700">
          imported from {from.name}
        </code>
      ) : (
        <p className="text-[11px] text-amber-700">
          Adopted before revisions were recorded, so which one this is cannot be established.
          Fetching again will pin it.
        </p>
      )}
      <p className="text-[11px] text-slate-400">
        {when ? `Adopted ${when} · ` : ''}cached at {path}
      </p>
    </div>
  )
}

/**
 * Fetch the coach's decision from GitHub, show what validation found, and adopt
 * it only on an explicit second step. A committed file is not automatically
 * trustworthy: it is checked against the published schema, and the commit that
 * produced it must have stayed inside `coaching/`.
 */
function CoachingSource({ decision, decisionPath, onReload }) {
  const [busy, setBusy] = useState(false)
  const [candidate, setCandidate] = useState(null)
  const [error, setError] = useState(null)
  const [adopted, setAdopted] = useState(null)
  const [history, setHistory] = useState(null)
  const fileInput = useRef(null)

  const run = async (fn) => {
    setBusy(true); setError(null); setAdopted(null)
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const fetchRemote = (ref) => run(async () => {
    const r = await pullCoaching(ref)
    setCandidate(r.empty ? { empty: true } : r)
  })

  const adopt = () => run(async () => {
    // Without this the adopted copy is an unlabelled duplicate: you cannot tell
    // which revision you are following, or whether a newer one exists.
    await saveDecision({
      ...candidate.decision,
      adoptedFrom: {
        repo: getRepo(),
        path: candidate.path || 'coaching/decision.json',
        commit: candidate.commit?.sha || null,
        shortCommit: candidate.commit?.shortSha || null,
        adoptedAt: new Date().toISOString(),
      },
    })
    setAdopted(candidate.commit?.shortSha || 'local')
    setCandidate(null)
    onReload()
  })

  const download = () => {
    const blob = new Blob([JSON.stringify(decision, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `coaching-decision-${decision?.assessmentDate || todayStr()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Manual route for when publishing is unavailable. Goes through the same
  // validated save as everything else.
  const importFile = (file) => run(async () => {
    const text = await file.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(`${file.name} is not valid JSON: ${e.message}`)
    }
    await saveDecision({
      ...parsed,
      adoptedFrom: { source: 'file', name: file.name, adoptedAt: new Date().toISOString() },
    })
    setAdopted(file.name)
    setCandidate(null)
    onReload()
  })

  const blocked = candidate && !candidate.empty &&
    (!candidate.valid || candidate.outOfScope?.length > 0)

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <h3 className="text-sm font-semibold text-slate-900">Coaching source</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        The app owns practice facts. This file only holds the current recommendation, and
        fetching advice can never change your practice history.
      </p>

      <AdoptedFrom from={decision?.adoptedFrom} path={decisionPath} hasDecision={!!decision} />

      {/* The coach reads the tracker from the data repository, so an unpushed
          change means advice would be authored against facts that have moved. */}
      <div className="mt-3">
        <RemoteFreshness />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => fetchRemote()}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Fetch from GitHub'}
        </button>
        <button
          onClick={() => run(async () => setHistory((await coachingHistory()).revisions))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Revisions
        </button>

        <span className="mx-1 w-px bg-slate-200" aria-hidden="true" />

        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          Import file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) importFile(f)
          }}
        />
        <button
          onClick={download}
          disabled={!decision}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
        >
          Download
        </button>
        <button
          onClick={onReload}
          title="Re-read the file from disk. Only needed if something edited it outside the app."
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Re-read from disk
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200/60">{error}</p>
      )}
      {adopted && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200/60">
          Adopted revision {adopted}.
        </p>
      )}

      {candidate?.empty && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          No coaching decision published yet at that path.
        </p>
      )}

      {candidate && !candidate.empty && (
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip className={candidate.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}>
              {candidate.valid ? 'valid' : 'invalid'}
            </Chip>
            {candidate.commit && (
              <span className="text-xs text-slate-500">
                {candidate.commit.shortSha} · {(candidate.commit.date || '').slice(0, 10)}
                {candidate.commit.author && ` · ${candidate.commit.author}`}
              </span>
            )}
          </div>
          {candidate.commit?.message && (
            <p className="mt-1 truncate text-xs text-slate-600">{candidate.commit.message}</p>
          )}

          {candidate.outOfScope?.length > 0 && (
            <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200/60">
              <p className="font-medium">That commit changed files outside coaching/.</p>
              <ul className="mt-1 list-none space-y-0.5 pl-0">
                {candidate.outOfScope.slice(0, 5).map(f => <li key={f}>· {f}</li>)}
              </ul>
              <p className="mt-1">Coaching updates may only touch coaching/. Not adopting.</p>
            </div>
          )}

          {candidate.errors?.length > 0 && (
            <ul className="mt-2 list-none space-y-0.5 pl-0">
              {candidate.errors.slice(0, 8).map(e => (
                <li key={e} className="text-xs text-rose-700">· {e}</li>
              ))}
            </ul>
          )}

          <button
            onClick={adopt}
            disabled={busy || blocked}
            className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Adopt this recommendation
          </button>
        </div>
      )}

      {history && (
        <div className="mt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Published revisions
          </span>
          {history.length === 0 ? (
            <p className="mt-1 text-xs text-slate-400">Nothing published yet.</p>
          ) : (
            <ul className="mt-1 list-none space-y-1 pl-0">
              {history.map(rev => (
                <li key={rev.sha} className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => fetchRemote(rev.sha)}
                    className="rounded border-0 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 hover:bg-slate-200"
                  >
                    {rev.shortSha}
                  </button>
                  <span className="text-slate-400">{(rev.date || '').slice(0, 10)}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-600">{rev.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function DebtPage({ problems, revisions, onChanged }) {
  const today = todayStr()
  const [log, setLog] = useState(() => store.getPracticeLog())
  const [anchorOverrides, setAnchorOverrides] = useState(() => store.getAnchors())
  const [topicRoles, setTopicRoles] = useState(() => store.getTopicRoles())
  const [testing, setTesting] = useState(null)
  const [backup, setBackup] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [setupOpen, setSetupOpen] = useState(() => Object.keys(store.getTopicRoles()).length === 0)
  const [picker, setPicker] = useState(null)
  const [newSub, setNewSub] = useState(null)
  const [rightTab, setRightTab] = useState('tracked')
  const [decision, setDecision] = useState(null)
  const [decisionPath, setDecisionPath] = useState(null)
  const [dayPlans, setDayPlans] = useState({})
  const [drawer, setDrawer] = useState(null)

  useEffect(() => {
    loadDecision().then(r => { setDecision(r.decision); setDecisionPath(r.path) })
    loadDays().then(r => setDayPlans(r.days || {}))
  }, [])

  const retention = useMemo(
    () => computeRetention({ problems, revisions, log, anchorOverrides, topicRoles, today }),
    [problems, revisions, log, anchorOverrides, topicRoles, today]
  )

  const staleness = useMemo(
    () => decisionStaleness(decision, { practiceLog: log, today }),
    [decision, log, today]
  )

  // Whether the saved forecast can still be resolved is a separate question
  // from whether the whole assessment needs rewriting.
  const validity = useMemo(
    () => forecastValidity(decision, { practiceLog: log, today }),
    [decision, log, today]
  )

  const saveAttempt = useCallback(entry => {
    setLog(store.recordAttempt(entry))
    setTesting(null)
    onChanged?.()

    // A grade is the evidence the coach reasons from, and it is the one action
    // that has no other reason to reach the data repository.
    setBackup({ state: 'running' })
    backupIfConnected()
      .then(r => setBackup(r.skipped ? null : { state: 'done', commit: r.committed }))
      .catch(e => setBackup({ state: 'failed', error: e.message }))
  }, [onChanged])

  const setRole = useCallback((topic, role) => {
    setTopicRoles({ ...store.setTopicRole(topic, role) })
    onChanged?.()
  }, [onChanged])

  // Editing an auto-suggested topic pins the current suggestions first, so the
  // other subpatterns are not lost the moment one is changed.
  const editAnchors = useCallback((topic, subpattern, nextSlugs) => {
    if (!topic.anchorsPinned) store.setTopicAnchors(topic.name, topic.anchorGroups)
    setAnchorOverrides({ ...store.setAnchorSubpattern(topic.name, subpattern, nextSlugs) })
    onChanged?.()
  }, [onChanged])

  const addAnchor = useCallback((topic, subpattern, slug) => {
    const current = topic.anchorGroups[subpattern] || []
    editAnchors(topic, subpattern, [...current, slug])
  }, [editAnchors])

  const removeAnchor = useCallback((topic, subpattern, slug) => {
    const current = topic.anchorGroups[subpattern] || []
    editAnchors(topic, subpattern, current.filter(s => s !== slug))
  }, [editAnchors])

  const { topics, scheduledList, pausedTopics } = retention
  const untracked = topics.filter(t => !t.role)
  const recentLog = [...log].reverse().slice(0, 10)

  const testingAnchor = testing
    ? scheduledList.flatMap(t => t.anchors).find(a => a.slug === testing.slug)
    : null
  const existingEntry = testing
    ? log.find(e => e.slug === testing.slug && e.date === today) || null
    : null

  const openProblem = useCallback((slug, title) => setDrawer({ slug, title }), [])
  // A planned problem may not be solved yet, so fall back to a stub rather than
  // sending the user out to LeetCode.
  const drawerProblem = drawer
    ? problems[drawer.slug] || {
      slug: drawer.slug,
      title: drawer.title || drawer.slug,
      url: `https://leetcode.com/problems/${drawer.slug}/`,
      tags: [],
    }
    : null
  const drawerTracked = !!(drawer && problems[drawer.slug])

  return (
    <>
    <div className="tw w-full space-y-4">
      {setupOpen && (
        <SetupPanel
          topics={topics}
          onSetRole={setRole}
          onClose={Object.keys(topicRoles).length > 0 ? () => setSetupOpen(false) : null}
        />
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <TodayHeadline
            retention={retention}
            decision={decision}
            dayPlans={dayPlans}
            staleness={staleness}
            validity={validity}
            practiceLog={log}
            today={today}
            onGrade={(slug, mode) => setTesting({ slug, mode })}
            onOpenSetup={() => setSetupOpen(v => !v)}
            onOpenProblem={openProblem}
            onOpenCoaching={() => setRightTab('history')}
          />
          <BackupNote backup={backup} onDismiss={() => setBackup(null)} />
        </div>

        <div className="space-y-4">
        <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
          {[
            { key: 'tracked', label: 'Tracked', count: scheduledList.length },
            { key: 'all', label: 'All topics', count: pausedTopics.length + untracked.length },
            { key: 'history', label: 'History', count: log.length },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setRightTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                rightTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {t.count > 0 && <span className="ml-1.5 text-xs text-slate-400">{t.count}</span>}
            </button>
          ))}
        </div>

        {rightTab === 'tracked' && (
        <div className="space-y-2">
          <div className="px-1">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">Topic health</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              A topic is only promoted once every subpattern has passed a cold test.
            </p>
          </div>

          {scheduledList.length === 0 ? (
            <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-400 ring-1 ring-slate-900/5">
              Nothing scheduled yet. Use the setup panel above.
            </p>
          ) : (
            scheduledList.map(t => {
              const open = expanded[t.name]
              const border = !t.debtKnown ? 'border-l-slate-200'
                : t.debt >= 6 ? 'border-l-rose-500'
                  : t.debt >= 3 ? 'border-l-amber-500' : 'border-l-slate-200'
              return (
                <div key={t.name} className={`overflow-hidden rounded-xl border-l-4 bg-white shadow-sm ring-1 ring-slate-900/5 ${border}`}>
                  <button onClick={() => setExpanded(p => ({ ...p, [t.name]: !p[t.name] }))}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left outline-none transition hover:bg-slate-50 focus-visible:bg-slate-50">
                    <span className="w-2 shrink-0 text-[10px] text-slate-400">{open ? '▼' : '▶'}</span>
                    <span className="text-sm font-semibold text-slate-900">{t.name}</span>
                    <Chip className={ROLE_STYLE[t.role]} title={ROLES[t.role].blurb}>{ROLES[t.role].label}</Chip>
                    <Chip className={HEALTH_STYLE[t.health]} title={HEALTH[t.health].blurb}>{t.health}</Chip>
                    <Chip
                      className={t.coverage.validated === t.coverage.total
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'}
                      title="Subpatterns with at least one passed cold test"
                    >
                      {t.coverage.validated}/{t.coverage.total} validated
                    </Chip>
                    {t.needsRepairCount > 0 && (
                      <Chip className="bg-rose-600 text-white">{t.needsRepairCount} to repair</Chip>
                    )}
                    <span className="ml-auto">
                      {t.debtKnown ? (
                        <Chip className={t.debt > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-400'}>
                          {t.debt} debt
                        </Chip>
                      ) : (
                        <Chip
                          className="bg-slate-100 text-slate-400"
                          title="No eligible cold test on this topic yet, so its debt is unknown rather than zero"
                        >
                          debt unknown
                        </Chip>
                      )}
                    </span>
                  </button>

                  {open && (
                    <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                      {t.reasons.length > 0 && (
                        <ul className="mb-4 space-y-1.5">
                          {t.reasons.map((r, i) => (
                            <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
                              <span className="rounded bg-rose-100 px-1.5 py-px font-bold text-rose-600">+{r.points}</span>
                              {r.label}
                            </li>
                          ))}
                        </ul>
                      )}

                      {t.coverage.subpatterns.map(sub => (
                        <div key={sub.name} className="mb-3">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                              {sub.name}
                            </span>
                            <Chip className={sub.validated ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                              {sub.validated ? 'validated' : 'not validated'}
                            </Chip>
                            <button
                              onClick={() => setPicker(
                                picker?.topic === t.name && picker?.sub === sub.name ? null : { topic: t.name, sub: sub.name }
                              )}
                              className="ml-auto rounded-lg border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 transition hover:border-slate-400 hover:bg-slate-50"
                            >
                              {picker?.topic === t.name && picker?.sub === sub.name ? 'Close' : '+ Add problem'}
                            </button>
                          </div>
                          <div className="-mx-1">
                            {sub.anchors.map(a => (
                              <AnchorRow key={a.slug} anchor={a} today={today}
                                onGrade={(slug, mode) => setTesting({ slug, mode })}
                                onOpenProblem={openProblem}
                                onRemove={slug => removeAnchor(t, sub.name, slug)} />
                            ))}
                            {sub.anchors.length === 0 && (
                              <p className="px-1 py-2 text-xs text-slate-400">
                                No representative problem for this subpattern yet.
                              </p>
                            )}
                          </div>
                          {picker?.topic === t.name && picker?.sub === sub.name && (
                            <AnchorPicker
                              topic={t}
                              onAdd={slug => addAnchor(t, sub.name, slug)}
                              onClose={() => setPicker(null)}
                            />
                          )}
                        </div>
                      ))}

                      {/* A subpattern only persists once it has a problem, so naming
                          one goes straight to picking its representative. */}
                      {picker?.topic === t.name && !t.coverage.subpatterns.some(s => s.name === picker.sub) && (
                        <div className="mb-3">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                              {picker.sub}
                            </span>
                            <Chip className="bg-slate-100 text-slate-500">new</Chip>
                          </div>
                          <AnchorPicker
                            topic={t}
                            onAdd={slug => { addAnchor(t, picker.sub, slug); setPicker(null) }}
                            onClose={() => setPicker(null)}
                          />
                        </div>
                      )}

                      {newSub === t.name ? (
                        <form
                          className="mb-3 flex gap-2"
                          onSubmit={e => {
                            e.preventDefault()
                            const name = new FormData(e.currentTarget).get('sub')?.toString().trim()
                            if (name) setPicker({ topic: t.name, sub: name })
                            setNewSub(null)
                          }}
                        >
                          <input name="sub" autoFocus placeholder="Subpattern name, e.g. boundaries"
                            className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5" />
                          <button type="submit"
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
                            Next
                          </button>
                          <button type="button" onClick={() => setNewSub(null)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500">
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <button onClick={() => setNewSub(t.name)}
                          className="mb-3 rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-500 transition hover:border-slate-400 hover:bg-slate-50">
                          + New subpattern
                        </button>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => setRole(t.name, 'paused')}
                          className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50">
                          Pause {t.name}
                        </button>
                        <button onClick={() => setRole(t.name, null)}
                          className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600">
                          Stop tracking
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}

          <RemainingChart summary={retention.anchorSummary} trackedCount={retention.trackedCount} />

          {decision?.branches?.length > 0 && <Branches decision={decision} />}
        </div>
        )}

        {rightTab === 'all' && (
        <div className="space-y-2">
          <div className="px-1">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">All topics</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Everything derived from your solved problems. Give one a role to start scheduling it.
            </p>
          </div>

          {pausedTopics.length > 0 && (
            <div className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-900/5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Paused
              </h4>
              <div className="mt-2 space-y-1">
                {pausedTopics.map(t => (
                  <div key={t.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <span className="flex-1 text-sm text-slate-600">{t.name}</span>
                    <Chip className={HEALTH_STYLE[t.health]}>{t.health}</Chip>
                    <button onClick={() => setRole(t.name, 'maintenance')}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-violet-400 hover:bg-violet-50">
                      Resume
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {untracked.length > 0 && (
            <div className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-900/5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Not tracked
              </h4>
              <div className="mt-2 space-y-1">
                {untracked.map(t => (
                  <div key={t.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <span className="flex-1 text-sm text-slate-600">{t.name}</span>
                    <span className="text-xs text-slate-400">{t.problemCount} solved</span>
                    <button onClick={() => setRole(t.name, 'paused')}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-slate-400 hover:bg-slate-50">
                      Pause
                    </button>
                    <button onClick={() => setRole(t.name, 'maintenance')}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-violet-400 hover:bg-violet-50">
                      Maintain
                    </button>
                    <button onClick={() => setRole(t.name, 'focus')}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-sky-400 hover:bg-sky-50">
                      Learn
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pausedTopics.length === 0 && untracked.length === 0 && (
            <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-400 ring-1 ring-slate-900/5">
              Every topic already has a role.
            </p>
          )}
        </div>
        )}

        {rightTab === 'history' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
            <h3 className="text-sm font-semibold text-slate-900">Attempt history</h3>
            {recentLog.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                Nothing recorded yet. A synced solve is not a graded attempt.
              </p>
            ) : (
              <div className="mt-3 space-y-1">
                {recentLog.map(e => (
                  <div key={e.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${RESULT_DOT[e.result]}`}>
                      {e.result[0].toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <ProblemLink slug={e.slug} title={problems[e.slug]?.title} onOpen={openProblem} className="block text-sm text-slate-700" />
                      <div className="text-xs text-slate-400">
                        {e.date} · {e.mode}
                        {e.timeMinutes != null && ` · ${e.timeMinutes}m`}
                        {e.help && e.help !== 'none' && ` · ${e.help}`}
                        {e.sessionRepeat && ' · repeat'}
                      </div>
                    </div>
                    <button onClick={() => setLog(store.removePracticeEntry(e.id))} title="Delete entry"
                      className="rounded-md p-1 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <CoachingSource
            decision={decision}
            decisionPath={decisionPath}
            onReload={() => loadDecision().then(r => { setDecision(r.decision); setDecisionPath(r.path) })}
          />
        </div>
        )}
        </div>
      </div>

      {testing && (
        <ColdTestModal
          slug={testing.slug}
          problem={problems[testing.slug]}
          coldTests={testingAnchor?.coldTests || []}
          defaultMode={testing.mode || 'cold'}
          existing={existingEntry}
          onClose={() => setTesting(null)}
          onSave={saveAttempt}
        />
      )}
    </div>

    {/* Shared with the Problems page so both detail views stay identical. */}
    {drawerProblem && (
      <ProblemDrawer
        problem={drawerProblem}
        revisions={revisions}
        notice={drawerTracked ? null : 'Not in your tracker yet — this is a planned problem. Details will fill in once you solve it and sync.'}
        onClose={() => setDrawer(null)}
      >
        {drawerTracked && (
          <button
            onClick={() => { setTesting({ slug: drawer.slug, mode: 'cold' }); setDrawer(null) }}
            className="add-rev-list-btn large"
          >
            Record an attempt
          </button>
        )}
      </ProblemDrawer>
    )}
    </>
  )
}
