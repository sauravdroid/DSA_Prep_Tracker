/**
 * Weeks and months, derived.
 *
 * A reader asking "how did last week go" should not pay seven requests to find
 * out, and a reader asking about a month should not pay thirty. These roll the
 * day plans and what was actually recorded against them into one file per
 * period, regenerable from the days at any time.
 *
 * The verdict for a day lives here rather than in a file of its own. A day's
 * outcome is a handful of fields; one file per day would be thirty files to
 * answer one question about a month.
 */

import { resolveOutlookDay } from './outlook.js'

export const WEEK_DIR = 'coaching/weeks'
export const MONTH_DIR = 'coaching/months'
export const ROLLUP_VERSION = 1

/** Worst first: a day holding a Red and a Green is not a Green day. */
const OUTCOME_ORDER = ['red', 'not_completed', 'yellow', 'green']

const pad = n => String(n).padStart(2, '0')
const atNoon = date => new Date(`${date}T12:00:00Z`)

/**
 * ISO week, so a week is Monday to Sunday and the year is the one that owns
 * the week rather than the one the first day happens to fall in.
 */
export function isoWeek(date) {
  const d = atNoon(date)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const offset = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - offset + 3)
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000))
  return `${d.getUTCFullYear()}-W${pad(week)}`
}

export function isoWeekRange(id) {
  const [year, week] = id.split('-W').map(Number)
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7))
  const monday = new Date(firstThursday)
  monday.setUTCDate(monday.getUTCDate() + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) }
}

export const monthOf = date => date.slice(0, 7)

export function monthRange(id) {
  const [year, month] = id.split('-').map(Number)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${id}-01`, to: `${id}-${pad(last)}` }
}

export const weekPath = id => `${WEEK_DIR}/${id}.json`
export const monthPath = id => `${MONTH_DIR}/${id}.json`

/** The grades a date recorded, worst first. Only an explicit skip is a skip. */
function verdictOn(practiceLog, date) {
  const found = new Set()
  for (const e of practiceLog) {
    if (e.date !== date) continue
    if (e.skipped || e.result === 'skipped' || e.result === 'not_completed') found.add('not_completed')
    else if (e.result) found.add(e.result)
  }
  return OUTCOME_ORDER.filter(r => found.has(r))
}

/**
 * How one day went: which branch its conditions selected, what it asked for,
 * and what the tracker recorded against the date.
 *
 * `asked` and `done` count problems only. An action is guidance and nothing
 * records it, so counting one would report work that was never measurable.
 */
export function dayReport(day, { practiceLog = [], anchors = null, today } = {}) {
  const view = resolveOutlookDay(day, { practiceLog, anchors, today })
  const problems = view.items.filter(i => i.type === 'problem')
  const recorded = [...new Set(practiceLog.filter(e => e.date === day.date && e.slug).map(e => e.slug))]

  return {
    date: day.date,
    authoredBy: day.authoredBy ?? null,
    headline: day.headline ?? null,
    branch: view.selected?.id ?? null,
    status: view.status.key,
    asked: problems.map(i => i.slug).filter(Boolean),
    done: problems.filter(i => i.done).map(i => i.slug),
    // Work recorded that this day never asked for. Not a failure: the day may
    // simply have been superseded by what the user chose to do.
    unplanned: recorded.filter(s => !problems.some(i => i.slug === s)),
    verdict: verdictOn(practiceLog, day.date),
    elapsed: !!today && day.date < today,
  }
}

/**
 * One period, rolled up.
 *
 * `sealed` means the period is over and nothing in it can change. An unsealed
 * rollup is a running total, not a verdict — reporting it as settled would
 * score days that have not happened.
 */
export function rollup({ kind, id, from, to }, days = [], ctx = {}) {
  const within = days
    .filter(d => d?.date && d.date >= from && d.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))

  const reports = within.map(d => dayReport(d, ctx))
  const elapsed = reports.filter(r => r.elapsed)
  const asked = elapsed.reduce((n, r) => n + r.asked.length, 0)
  const done = elapsed.reduce((n, r) => n + r.done.length, 0)
  const found = new Set(elapsed.flatMap(r => r.verdict))

  return {
    rollupVersion: ROLLUP_VERSION,
    kind,
    id,
    from,
    to,
    sealed: !!ctx.today && to < ctx.today,
    note: 'Totals cover days that have elapsed. A day still ahead is not unfollowed work, and an unsealed period is a running total rather than a verdict.',
    days: reports,
    totals: {
      planned: within.length,
      elapsed: elapsed.length,
      asked,
      done,
      unplanned: elapsed.reduce((n, r) => n + r.unplanned.length, 0),
      verdict: OUTCOME_ORDER.filter(r => found.has(r)),
    },
  }
}

/** Every week and month the given days fall in. */
export function rollupsFor(days = [], ctx = {}) {
  const weeks = new Map()
  const months = new Map()
  for (const d of days) {
    if (!d?.date) continue
    weeks.set(isoWeek(d.date), null)
    months.set(monthOf(d.date), null)
  }

  const out = []
  for (const id of [...weeks.keys()].sort()) {
    out.push({ path: weekPath(id), body: rollup({ kind: 'week', id, ...isoWeekRange(id) }, days, ctx) })
  }
  for (const id of [...months.keys()].sort()) {
    out.push({ path: monthPath(id), body: rollup({ kind: 'month', id, ...monthRange(id) }, days, ctx) })
  }
  return out
}
