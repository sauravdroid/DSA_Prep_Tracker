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
 * Drift is a statement about intent, not mechanism: the dependency may still
 * resolve perfectly. It says a human should look, because the plan it was
 * answering has changed underneath it.
 */
export function driftedFrom(day, byDate = {}) {
  const mine = authoredKey(day)
  return dependsOn(day).filter(date => {
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
 * What the index says about each day: enough to decide whether the file is
 * worth fetching, and enough to see which days hang off which.
 *
 * `requiredBy` is the reverse of `dependsOn`, derived rather than authored. It
 * is what makes "revise this day and everything that depends on it" something
 * the coach can look up instead of work out.
 */
export function buildDayIndex(days = []) {
  const present = days.filter(d => d?.date)
  const byDate = Object.fromEntries(present.map(d => [d.date, d]))

  const entries = {}
  for (const day of [...present].sort((a, b) => a.date.localeCompare(b.date))) {
    const drifted = driftedFrom(day, byDate)
    entries[day.date] = {
      file: dayPath(day.date),
      date: day.date,
      authoredBy: day.authoredBy ?? null,
      headline: day.headline ?? null,
      scenarios: (day.scenarios || []).length,
      problems: problemRange(day),
      dependsOn: dependsOn(day),
      requiredBy: [],
      drifted: drifted.length > 0,
      driftedFrom: drifted,
    }
  }

  for (const date of Object.keys(entries)) {
    for (const source of entries[date].dependsOn) {
      if (entries[source]) entries[source].requiredBy.push(date)
    }
  }

  const dates = Object.keys(entries).sort()
  return {
    count: dates.length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    drifted: dates.filter(d => entries[d].drifted),
    days: entries,
  }
}
