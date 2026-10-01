/**
 * Days as documents.
 *
 * A decision used to be one file holding every day it spoke to, so revising
 * tomorrow meant rewriting yesterday — and the coach had to restate settled
 * work to avoid losing it. One file per date removes that: a day is written
 * once, by one assessment, and later runs write later days.
 *
 * What a day depends on is a measurement, not another file: `dependencies`
 * names a slug, a date and a practice mode, and resolves from the practice log
 * alone. So a rewrite elsewhere can never corrupt a day. It can only leave one
 * reasoning about a version of another day that no longer exists, which is
 * what `drift` detects.
 */

export const DAY_DIR = 'coaching/days'
export const DAY_VERSION = 1

export function dayPath(date) {
  return `${DAY_DIR}/${date}.json`
}

/**
 * The run that wrote a day, as a sortable key. Assessment ids are timestamps
 * stripped of punctuation, so comparing them compares authoring order.
 *
 * The id is preferred over the timestamp so that days written by one run
 * compare equal: writing Friday a second after Saturday is not Friday being
 * newer than the day that reasoned about it.
 */
export function authoredKey(day) {
  return day?.authoredBy?.assessment || day?.authoredBy?.at || ''
}

/** The other dates whose results this day waits on. */
export function dependsOn(day) {
  const dates = new Set()
  for (const dep of day?.dependencies || []) {
    if (dep?.date && dep.date !== day.date) dates.add(dep.date)
  }
  return [...dates].sort()
}

/**
 * The dates this day was reasoned against that have since been re-authored.
 *
 * Takes a day or an index entry: a day names its dependencies, an entry has
 * already reduced them to dates, and the comparison is the same either way.
 *
 * Drift is a statement about intent, not mechanism: the dependency may still
 * resolve perfectly. It says a human should look, because the plan it was
 * answering has changed underneath it.
 */
export function driftedFrom(node, byDate = {}) {
  const mine = authoredKey(node)
  const sources = Array.isArray(node?.dependsOn) ? node.dependsOn : dependsOn(node)
  return sources.filter(date => {
    const other = byDate[date]
    return other && authoredKey(other) > mine
  })
}

const isProblem = item => (item?.type || (item?.slug ? 'problem' : 'action')) === 'problem'

/** Distinct problems each branch plans, as a range, since branches differ. */
function problemRange(day) {
  const counts = (day?.scenarios || []).map(s =>
    new Set((s.items || []).filter(isProblem).map(i => i.slug || i.title)).size)
  if (counts.length === 0) return { min: 0, max: 0 }
  return { min: Math.min(...counts), max: Math.max(...counts) }
}

/** Every problem any branch of this day plans. */
export function plannedSlugs(day) {
  const slugs = new Set()
  for (const s of day?.scenarios || []) {
    for (const item of s.items || []) if (isProblem(item) && item.slug) slugs.add(item.slug)
  }
  return [...slugs].sort()
}

/**
 * Whether a rewrite keeps the work already recorded against that date.
 *
 * A day stays mutable for work not yet done. Dropping a problem that has
 * already been graded would leave the record describing work the plan no
 * longer admits asking for — the attempt survives either way, but the day
 * would then report a different number of problems than it was measured on.
 */
export function rewriteKeepsRecordedWork(previous, next, practiceLog = []) {
  const date = previous?.date
  const recorded = new Set(
    practiceLog.filter(e => e.date === date && e.slug).map(e => e.slug))
  const kept = new Set(plannedSlugs(next))
  const dropped = plannedSlugs(previous).filter(s => recorded.has(s) && !kept.has(s))
  return { ok: dropped.length === 0, dropped }
}

/**
 * A decision's days, as documents.
 *
 * The two shapes a decision used for a day collapse into one here. `today` was
 * a `doNow` and a `then`, with no conditions attached — an unconditional
 * scenario, written differently because it was the only day the app could act
 * on. `nextThreeDays` entries are already the day shape and carry across whole.
 *
 * A legacy prose day keeps whatever unconditional list it had; its `conditional`
 * branches are dropped, because the app could never tell which applied and a
 * converted day that claimed otherwise would be inventing certainty.
 */
export function decisionToDays(decision = {}) {
  const assessment = { assessment: assessmentIdOf(decision), at: decision.assessedAt ?? null }
  if (!assessment.assessment) return []

  const days = []

  const steps = [decision.today?.doNow, decision.today?.then]
    .filter(Boolean)
    .map(raw => ({
      type: raw.slug ? 'problem' : 'action',
      ...(raw.slug ? { slug: raw.slug } : {}),
      title: raw.title || raw.action || raw.slug || 'Untitled step',
      ...(raw.mode ? { kind: raw.mode } : {}),
      ...(typeof raw.minutes === 'number' ? { minutes: raw.minutes } : {}),
      ...(raw.why ? { why: raw.why } : {}),
    }))

  if (decision.assessmentDate && steps.length > 0) {
    // Named by what it asks for. The mode headline belongs to the run, and a
    // day labelled with it would only repeat what the card above already says.
    const problems = steps.filter(i => i.type === 'problem')
    const label = (problems.length > 0 ? problems : steps).map(i => i.title).filter(Boolean).join(' + ')
    days.push({
      dayVersion: DAY_VERSION,
      date: decision.assessmentDate,
      authoredBy: assessment,
      ...(decision.mode?.headline ? { headline: decision.mode.headline } : {}),
      scenarios: [{
        id: 'today',
        priority: 0,
        label: label || "Today's plan",
        basis: 'Written for this day, with no condition attached.',
        when: { op: 'always' },
        items: steps,
      }],
    })
  }

  for (const day of decision.nextThreeDays || []) {
    if (!day?.date) continue
    const base = {
      dayVersion: DAY_VERSION,
      date: day.date,
      authoredBy: assessment,
      ...(day.headline ? { headline: day.headline } : {}),
      ...(day.note ? { note: day.note } : {}),
      ...(day.dependencies ? { dependencies: day.dependencies } : {}),
      ...(day.unresolved ? { unresolved: day.unresolved } : {}),
    }

    if (day.scenarios?.length) {
      days.push({ ...base, scenarios: day.scenarios })
      continue
    }
    if (day.items?.length) {
      days.push({
        ...base,
        scenarios: [{
          id: 'saved',
          priority: 0,
          label: day.headline || 'Saved plan',
          basis: 'Saved plan with no conditions attached.',
          when: { op: 'always' },
          items: day.items,
        }],
      })
    }
  }

  return days
}

function assessmentIdOf(decision) {
  if (!decision.assessedAt) return null
  return new Date(decision.assessedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * One day per date from a run of decisions, newest wins.
 *
 * Decisions arrive newest first, which is also precedence order: the latest
 * run to write a date is the one that governs it.
 */
export function daysFromDecisions(decisions = []) {
  const byDate = new Map()
  for (const decision of decisions) {
    for (const day of decisionToDays(decision)) {
      if (!byDate.has(day.date)) byDate.set(day.date, day)
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** What the index says about one day, before the links between days are known. */
export function dayEntry(day) {
  return {
    file: dayPath(day.date),
    date: day.date,
    authoredBy: day.authoredBy ?? null,
    headline: day.headline ?? null,
    scenarios: (day.scenarios || []).length,
    problems: problemRange(day),
    dependsOn: dependsOn(day),
    requiredBy: [],
    drifted: false,
    driftedFrom: [],
  }
}

/**
 * The links between days, filled in over whatever set of entries is given.
 *
 * Entries rather than whole days, because a run that fetched nothing still has
 * to be able to rebuild this from the index it already published — reading
 * every day file back just to restate what the last run worked out would make
 * a cheap run expensive, and leaving the section empty would lose it.
 *
 * `requiredBy` is the reverse of `dependsOn`. It is what makes "revise this day
 * and everything that depends on it" something the coach can look up instead
 * of work out.
 */
export function linkDays(entries = []) {
  const byDate = {}
  for (const e of entries) if (e?.date) byDate[e.date] = { ...e, requiredBy: [], drifted: false, driftedFrom: [] }

  for (const entry of Object.values(byDate)) {
    entry.driftedFrom = driftedFrom(entry, byDate)
    entry.drifted = entry.driftedFrom.length > 0
    for (const source of entry.dependsOn || []) {
      if (byDate[source]) byDate[source].requiredBy.push(entry.date)
    }
  }

  const dates = Object.keys(byDate).sort()
  for (const d of dates) byDate[d].requiredBy.sort()

  return {
    count: dates.length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    drifted: dates.filter(d => byDate[d].drifted),
    entries: Object.fromEntries(dates.map(d => [d, byDate[d]])),
  }
}

/**
 * What the index says about each day: enough to decide whether the file is
 * worth fetching, and enough to see which days hang off which.
 */
export function buildDayIndex(days = []) {
  return linkDays(days.filter(d => d?.date).map(dayEntry))
}
