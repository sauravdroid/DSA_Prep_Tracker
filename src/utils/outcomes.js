import crypto from 'node:crypto'
import { resolveOutlook } from './outlook.js'
import { canonical } from './trackerDiff.js'

export const OUTCOME_DIR = 'coaching/outcomes'
export const OUTCOME_VERSION = 1

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
    days: views.map(v => ({
      date: v.date,
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
    })),
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
