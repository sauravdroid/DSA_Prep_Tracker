import { useState, useMemo, useCallback, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { computeRetention, daysBetween, HEALTH, ROLES, suggestAnchors } from '../utils/retention'
import { loadDecision, decisionStaleness, forecastValidity, trackerSnapshot } from '../utils/coaching'
import { getSyncState } from '../utils/dataFile'
import { todayStr } from '../utils/dateUtils'
import ColdTestModal from './ColdTestModal'
import ProblemDrawer from './ProblemDrawer'
import Outlook, { DayBreadcrumb } from './Outlook'
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

function TodayHeadline({ retention, decision, staleness, validity, practiceLog, today, tab, onTabChange, onGrade, onOpenSetup, onOpenProblem, problems }) {
  const [dayDate, setDayDate] = useState(null)
  const { mode, modeProvisional, plan, totalDebt, debtCalculable, agenda, doneToday, focusTopics, maintenanceTopics, trackedCount } = retention
  const roleOf = name => retention.topics.find(t => t.name === name)?.role
  const ms = MODE_STYLE[mode.key]
  const d = decision
  // A stale decision stops driving the day; fall back to the live derivation.
  const decisionSteps = d && !staleness.stale ? d.today : null

  const headline = d?.mode?.headline
    || (trackedCount === 0 ? 'Set up your topics' : `${mode.label}${modeProvisional ? ' (provisional)' : ''} — ${plan.retentionCount > 0 ? 'baseline validation' : 'keep learning'}`)
  const why = d?.mode?.why || plan.caveat
    || (trackedCount === 0
      ? 'No topics have a role yet, so nothing is being scheduled.'
      : 'Derived from the anchors below.')

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
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">{why}</p>
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

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            {[
              { key: 'today', label: 'Today' },
              { key: 'outlook', label: 'Next 3 days' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => onTabChange(t.key)}
                aria-pressed={tab === t.key}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'outlook' && decision?.nextThreeDays?.length > 0 && (
            <div className="panel-in flex items-center gap-2">
              <span className="text-slate-300" aria-hidden="true">/</span>
              <DayBreadcrumb days={decision.nextThreeDays} selected={dayDate} onSelect={setDayDate} />
            </div>
          )}
        </div>

        {/* Keyed so switching view animates rather than snapping. */}
        <div key={tab} className="panel-in">
        {tab === 'outlook' ? (
          <Outlook
            decision={decision}
            validity={validity}
            practiceLog={practiceLog}
            anchors={retention.anchorList}
            today={today}
            problems={problems}
            dayDate={dayDate}
            onSelectDay={setDayDate}
            onOpenProblem={onOpenProblem}
            onGrade={onGrade}
          />
        ) : (
        <>
        {/* Do now / Then — the saved decision owns this when one is loaded. */}
        <section className="mt-5">
          <SectionHeading label="Do now" />
          <div className="mt-2 space-y-2">
          {decisionSteps
            ? (
              <>
                {decisionSteps.doNow && (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                    <span className="shrink-0 rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                      First
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ProblemLink
                          slug={decisionSteps.doNow.slug}
                          title={decisionSteps.doNow.title || decisionSteps.doNow.slug}
                          onOpen={onOpenProblem}
                          className="font-medium text-slate-900"
                        />
                        {decisionSteps.doNow.mode && (
                          <Chip className="bg-slate-100 text-slate-600">{decisionSteps.doNow.mode} test</Chip>
                        )}
                      </div>
                      {decisionSteps.doNow.why && (
                        <p className="mt-0.5 text-sm text-slate-500">{decisionSteps.doNow.why}</p>
                      )}
                    </div>
                    {decisionSteps.doNow.minutes && (
                      <span className="shrink-0 text-xs font-medium text-slate-400">≤{decisionSteps.doNow.minutes} min</span>
                    )}
                    {decisionSteps.doNow.slug && (
                      <>
                        <a href={`https://leetcode.com/problems/${decisionSteps.doNow.slug}/`} target="_blank" rel="noopener noreferrer"
                          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                          Open
                        </a>
                        <button onClick={() => onGrade(decisionSteps.doNow.slug, decisionSteps.doNow.mode || 'cold')}
                          className="shrink-0 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700">
                          Record attempt
                        </button>
                      </>
                    )}
                  </div>
                )}

                {decisionSteps.then && (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                      Then
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-900">
                        {decisionSteps.then.title || decisionSteps.then.action}
                      </span>
                      {decisionSteps.then.why && (
                        <p className="mt-0.5 text-sm text-slate-500">{decisionSteps.then.why}</p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )
            : agenda.map(a => (
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

          {!decisionSteps && trackedCount > 0 && agenda.length === 0 && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200/60">
              Nothing due. Every anchor is inside its interval — spend the day on new material.
            </p>
          )}

          {trackedCount === 0 && !decisionSteps && (
            <button onClick={onOpenSetup}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
              Choose what you are learning and maintaining
            </button>
          )}
          </div>
        </section>

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
                    {item.kind === 'attempt' ? (
                      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${RESULT_DOT[item.result]}`}
                        title={`graded ${item.result}`}>
                        {item.result[0].toUpperCase()}
                      </span>
                    ) : (
                      <Chip className="bg-emerald-100 text-emerald-700">{item.kind}</Chip>
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

                    {item.kind === 'attempt' && (
                      <span className="text-xs text-slate-400">
                        {item.mode}
                        {item.timeMinutes != null && ` · ${item.timeMinutes}m`}
                        {item.help && item.help !== 'none' && ` · ${item.help}`}
                        {item.sessionRepeat && ' · repeat'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {!doneToday.some(i => i.kind === 'attempt') && (
                <p className="mt-2 text-xs text-slate-500">
                  Solves and revisions are activity, not retention evidence. Only a recorded
                  attempt counts toward validation.
                </p>
              )}
            </div>
          )}
        </section>
        </>
        )}
        </div>

        {/* Covering */}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Covering</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">learning</span>
            {focusTopics.length === 0
              ? <span className="text-xs text-slate-400">none</span>
              : focusTopics.map(t => <Chip key={t.name} className={ROLE_STYLE.focus}>{t.name}</Chip>)}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">maintaining</span>
            {maintenanceTopics.length === 0
              ? <span className="text-xs text-slate-400">none</span>
              : maintenanceTopics.map(t => <Chip key={t.name} className={ROLE_STYLE.maintenance}>{t.name}</Chip>)}
          </span>
          <button onClick={onOpenSetup}
            className="ml-auto rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
            Edit setup
          </button>
        </div>

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

export default function DebtPage({ problems, revisions, onChanged }) {
  const today = todayStr()
  const [log, setLog] = useState(() => store.getPracticeLog())
  const [anchorOverrides, setAnchorOverrides] = useState(() => store.getAnchors())
  const [topicRoles, setTopicRoles] = useState(() => store.getTopicRoles())
  const [testing, setTesting] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [setupOpen, setSetupOpen] = useState(() => Object.keys(store.getTopicRoles()).length === 0)
  const [picker, setPicker] = useState(null)
  const [newSub, setNewSub] = useState(null)
  const [rightTab, setRightTab] = useState('tracked')
  const [decision, setDecision] = useState(null)
  const [decisionPath, setDecisionPath] = useState(null)
  const [drawer, setDrawer] = useState(null)
  const [tab, setTab] = useState('today')

  useEffect(() => {
    loadDecision().then(r => { setDecision(r.decision); setDecisionPath(r.path) })
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
    setLog(store.addPracticeEntry(entry))
    const n = entry.notes || {}
    const text = [n.invariant, n.whyHelp, n.clicked].filter(Boolean).join(' · ')
    if (text) store.addNote(entry.slug, text)
    setTesting(null)
    onChanged?.()
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
  const sameDayAlready = testing ? log.some(e => e.slug === testing.slug && e.date === today) : false

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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <TodayHeadline
            retention={retention}
            decision={decision}
            staleness={staleness}
            validity={validity}
            practiceLog={log}
            today={today}
            tab={tab}
            onTabChange={setTab}
            onGrade={(slug, mode) => setTesting({ slug, mode })}
            onOpenSetup={() => setSetupOpen(v => !v)}
            onOpenProblem={openProblem}
            problems={problems}
          />
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

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
            <h3 className="text-sm font-semibold text-slate-900">Coaching file</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              The app owns practice facts. This file only holds the current recommendation and is
              never written by the app.
            </p>
            {decisionPath && (
              <code className="mt-2 block overflow-x-auto rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] text-slate-700">
                {decisionPath}
              </code>
            )}
            <button
              onClick={() => loadDecision().then(r => { setDecision(r.decision); setDecisionPath(r.path) })}
              className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Reload recommendation
            </button>
          </div>
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
          sameDayAlready={sameDayAlready}
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
