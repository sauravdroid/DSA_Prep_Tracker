import crypto from 'node:crypto'
import { resolveOutlook } from './outlook.js'
import { canonical } from './trackerDiff.js'

export const OUTCOME_DIR = 'coaching/outcomes'
export const OUTCOME_VERSION = 2

export function outcomePath(assessmentId) {
  return `${OUTCOME_DIR}/${assessmentId}.json`
}

/**
 * How an assessment's forecast actually resolved, recorded once and not
 * recomputed.
 *
 * Resolution runs against whatever the practice log holds at the moment it is
 * asked, so a correction to the evidence silently rewrites the verdict on
 * advice given weeks earlier. Sealing freezes the answer and records the
 * evidence it was based on, so a later change shows up as drift rather than
 * quietly replacing history.
 */

/**
 * An assessment is only worth sealing once it can no longer change: something
 * newer has replaced it, or every day it spoke to is behind us.
 */
export function sealReason({ decision, covers = [], isLatest, today }) {
  if (!isLatest) return 'superseded'
  const last = [...covers].sort().pop()
  if (last && last < today) return 'window elapsed'
  return null
}

function fingerprintLog(practiceLog = []) {
  return crypto.createHash('sha256').update(canonical(practiceLog)).digest('hex').slice(0, 16)
}

/**
 * The assessment's own day. It carries no branches, so the outlook resolver
 * never sees it — yet it is usually the only day with evidence by the time the
 * assessment is superseded, and omitting it reports nothing happened.
 */
function todayOutcome(decision, practiceLog, sealDate) {
  const date = decision.assessmentDate
  if (!date) return null

  const recordFor = slug =>
    practiceLog.find(e => e.slug === slug && e.date === date) || null

  const asItem = (step, role) => {
    if (!step?.slug) return null
    const rec = recordFor(step.slug)
    return {
      slug: step.slug,
      type: 'problem',
      role,
      done: !!rec,
      askedMode: step.mode ?? null,
      // What was asked and what was recorded can differ; a warm grade where a
      // cold test was asked for is not the same as having done it.
      recordedMode: rec?.mode ?? null,
      recordedResult: rec?.result ?? null,
    }
  }

  const items = [asItem(decision.today?.doNow, 'doNow'), asItem(decision.today?.then, 'then')].filter(Boolean)

  return {
    date,
    kind: 'today',
    elapsed: date <= sealDate,
    status: null,
    branch: null,
    // Today is stated outright rather than conditionally, so there is nothing
    // for evidence to settle.
    resolved: true,
    workload: null,
    dependencies: [],
    items,
  }
}

export function sealOutcome({
  decision,
  assessmentId,
  practiceLog = [],
  anchors = {},
  sealedAt,
  sealedBecause,
  supersededBy = null,
}) {
  const at = sealedAt || new Date().toISOString()
  const sealDate = at.slice(0, 10)
  const views = resolveOutlook(decision, { practiceLog, anchors, today: sealDate })
  const today = todayOutcome(decision, practiceLog, sealDate)

  const forecast = views.map(v => ({
    date: v.date,
    kind: 'forecast',
    // A day still in the future when this was sealed never had a chance to
    // happen, and must not read as a plan that went unfollowed.
    elapsed: v.date <= sealDate,
    status: v.status?.key ?? null,
    branch: v.selected?.id ?? null,
    resolved: !!v.selected,
    workload: v.workload?.range ?? null,
    dependencies: (v.dependencies || []).map(d => ({
      slug: d.slug ?? null,
      date: d.date ?? null,
      state: d.state ?? null,
      result: d.result ?? null,
    })),
    items: (v.items || []).map(i => ({
      slug: i.slug ?? null,
      type: i.type ?? null,
      done: !!i.done,
    })),
  }))

  return {
    outcomeVersion: OUTCOME_VERSION,
    assessmentId,
    assessedAt: decision.assessedAt ?? null,
    sealedAt: at,
    sealedBecause,
    supersededBy,
    evidence: {
      attempts: practiceLog.length,
      lastAttemptAt: [...practiceLog].map(e => e.at || e.date).sort().pop() ?? null,
      fingerprint: fingerprintLog(practiceLog),
    },
    days: [...(today ? [today] : []), ...forecast],
  }
}

/** Whether a sealed outcome still matches the evidence as it stands now. */
export function outcomeDrift(outcome, practiceLog = []) {
  const now = fingerprintLog(practiceLog)
  return {
    drifted: outcome?.evidence?.fingerprint !== now,
    sealedFingerprint: outcome?.evidence?.fingerprint ?? null,
    currentFingerprint: now,
  }
}

/**
 * The part of an outcome worth carrying in the index: enough to see whether a
 * forecast held without fetching it, and no verdict that the detail would
 * contradict.
 */
export function summariseOutcome(outcome) {
  if (!outcome) return null
  const days = outcome.days || []
  const elapsed = days.filter(d => d.elapsed)
  const asked = days.flatMap(d => d.items || [])
  return {
    file: outcomePath(outcome.assessmentId),
    sealedAt: outcome.sealedAt ?? null,
    sealedBecause: outcome.sealedBecause ?? null,
    supersededBy: outcome.supersededBy ?? null,
    evidenceFingerprint: outcome.evidence?.fingerprint ?? null,
    days: days.length,
    daysElapsed: elapsed.length,
    daysResolved: days.filter(d => d.resolved).length,
    itemsAsked: asked.length,
    itemsDone: asked.filter(i => i.done).length,
    // Which branch each day settled on, null where nothing settled it.
    branches: Object.fromEntries(days.filter(d => d.kind !== 'today').map(d => [d.date, d.branch])),
  }
}
