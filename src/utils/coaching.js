import { todayStr } from './dateUtils.js'
import { coveredDates } from './assessments.js'

const ENDPOINT = '/api/coaching'

export const DECISION_VERSION = 1

export async function loadDecision() {
  try {
    const res = await fetch(ENDPOINT)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    return { decision: body.decision, path: body.path, available: true }
  } catch (e) {
    return { decision: null, path: null, available: false, error: e.message }
  }
}

export async function saveDecision(decision) {
  const res = await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Carry the reasons through: "failed validation" alone is unactionable.
    const detail = (body.errors || []).slice(0, 5).join('; ')
    throw new Error([body.error || `HTTP ${res.status}`, detail].filter(Boolean).join(' — '))
  }
  return body
}

/**
 * The attempts a decision already anticipates, as `slug|date`. Today's step
 * counts alongside the forecast's dependencies: a plan that asks for a result
 * must not treat that result as a surprise.
 */
function plannedAttempts(decision) {
  const keys = new Set()
  const date = decision.assessmentDate || (decision.assessedAt || '').slice(0, 10)
  for (const step of [decision.today?.doNow, decision.today?.then]) {
    if (step?.slug && date) keys.add(`${step.slug}|${date}`)
  }
  for (const day of decision.nextThreeDays || []) {
    for (const dep of day.dependencies || []) keys.add(`${dep.slug}|${dep.date}`)
  }
  return keys
}

/**
 * A decision goes stale when it no longer speaks to today, when evidence
 * appears that it never accounted for, or when attempts it was based on have
 * vanished.
 *
 * Carrying out the plan is not a reason to discard the plan, so the attempt it
 * asked for is expected rather than invalidating. Nor is the day rolling over:
 * a three-day forecast exists precisely so that tomorrow is already planned.
 */
export function decisionStaleness(decision, { practiceLog, today = todayStr() } = {}) {
  if (!decision) return { stale: true, reasons: ['No recommendation loaded yet.'] }

  const reasons = []
  const assessed = (decision.assessedAt || '').slice(0, 10)

  if (assessed && assessed < today && !coveredDates(decision).includes(today)) {
    reasons.push(`Written for ${assessed} and does not cover ${today}.`)
  }

  const planned = plannedAttempts(decision)
  const since = decision.trackerSnapshot?.lastAttemptAt || decision.assessedAt || ''
  const unexpected = (practiceLog || []).filter(e =>
    (e.at || e.date) > since && !planned.has(`${e.slug}|${e.date}`)
  )
  if (unexpected.length > 0) {
    const names = [...new Set(unexpected.map(e => e.slug))].slice(0, 3).join(', ')
    reasons.push(`${unexpected.length} attempt${unexpected.length !== 1 ? 's' : ''} it does not account for (${names}).`)
  }

  // Growth is expected; attempts disappearing means the log no longer matches.
  const expected = decision.trackerSnapshot?.attempts
  if (typeof expected === 'number' && practiceLog && practiceLog.length < expected) {
    reasons.push(`Based on ${expected} attempts, tracker now has ${practiceLog.length}.`)
  }

  return { stale: reasons.length > 0, reasons }
}

/** Snapshot fields a decision should quote so staleness can be detected. */
export function trackerSnapshot({ problems, revisions, practiceLog, savedAt }) {
  const last = [...(practiceLog || [])].sort((a, b) => (a.at || a.date).localeCompare(b.at || b.date)).pop()
  return {
    savedAt: savedAt || null,
    problems: Object.keys(problems || {}).length,
    revisions: (revisions || []).length,
    attempts: (practiceLog || []).length,
    lastAttemptAt: last ? last.at || last.date : null,
  }
}

/**
 * Whether a saved forecast can still be resolved, which is a different question
 * from whether the overall assessment needs rewriting.
 *
 * Recording the very result a branch waits for is what makes the forecast
 * usable, so it must not also invalidate it. Evidence the plan never mentioned
 * is a different matter: that is a change the coach did not account for.
 */
export function forecastValidity(decision, { practiceLog = [], today = todayStr() } = {}) {
  if (!decision) return { usable: false, expired: false, needsReview: false, reasons: ['No recommendation loaded yet.'] }

  const days = decision.nextThreeDays || []
  if (days.length === 0) {
    return { usable: false, expired: false, needsReview: false, reasons: ['The recommendation contains no forward plan.'], window: null }
  }

  const dates = days.map(d => d.date).filter(Boolean).sort()
  const window = { from: dates[0], to: dates[dates.length - 1] }
  const reasons = []

  const expired = window.to < today
  if (expired) {
    reasons.push(`Written for ${window.from} – ${window.to}; today is ${today}. Ask for refreshed coaching.`)
  }

  // Attempts the forecast explicitly depends on are expected, not invalidating.
  const expectedKeys = plannedAttempts(decision)
  const since = decision.trackerSnapshot?.lastAttemptAt || decision.assessedAt || ''
  const unexpected = practiceLog.filter(e =>
    (e.at || e.date) > since && !expectedKeys.has(`${e.slug}|${e.date}`)
  )
  if (unexpected.length > 0) {
    const names = [...new Set(unexpected.map(e => e.slug))].slice(0, 3).join(', ')
    reasons.push(`${unexpected.length} attempt${unexpected.length !== 1 ? 's' : ''} the plan does not account for (${names}).`)
  }

  const policy = decision.proposedFixedPolicy?.version
  if (policy != null && policy !== DECISION_VERSION) {
    reasons.push(`Written against policy version ${policy}; the app is on ${DECISION_VERSION}.`)
  }

  const needsReview = unexpected.length > 0 || (policy != null && policy !== DECISION_VERSION)

  return { usable: !expired, expired, needsReview, reasons, window }
}

