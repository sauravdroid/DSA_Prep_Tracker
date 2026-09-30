import { todayStr } from './dateUtils.js'

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
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

/**
 * A decision goes stale when the day rolls over or when practice evidence has
 * been recorded since it was written — both change what today should be.
 */
export function decisionStaleness(decision, { practiceLog, today = todayStr() } = {}) {
  if (!decision) return { stale: true, reasons: ['No recommendation loaded yet.'] }

  const reasons = []
  const assessed = (decision.assessedAt || '').slice(0, 10)

  if (assessed && assessed < today) {
    reasons.push(`Written for ${assessed}; today is ${today}.`)
  }

  const since = decision.trackerSnapshot?.lastAttemptAt || decision.assessedAt || ''
  const newer = (practiceLog || []).filter(e => (e.at || e.date) > since)
  if (newer.length > 0) {
    reasons.push(`${newer.length} attempt${newer.length !== 1 ? 's' : ''} recorded since it was written.`)
  }

  const expected = decision.trackerSnapshot?.attempts
  if (typeof expected === 'number' && practiceLog && practiceLog.length !== expected) {
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
  const expectedKeys = new Set(
    days.flatMap(d => (d.dependencies || []).map(dep => `${dep.slug}|${dep.date}`))
  )
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

