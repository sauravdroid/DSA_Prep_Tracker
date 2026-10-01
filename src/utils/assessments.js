/**
 * The assessment archive: one file per assessment, plus an index that carries
 * enough of each to be read without fetching it.
 *
 * `coaching/decision.json` holds only the current plan and is overwritten, so
 * without this the answer to "what was I told last week" is a commit walk. The
 * archive is derived from that history rather than written by the coach, which
 * keeps the coach's job a single file and lets a missed revision be backfilled
 * later.
 */

import { buildDayIndex } from './days.js'

export const ASSESSMENT_DIR = 'coaching/assessments'
export const INDEX_PATH = 'coaching/index.json'
export const INDEX_VERSION = 2

/**
 * A filename from the assessment's own timestamp. Readable and chronological,
 * but ordering comes from `assessedAt` inside the file: a clock that drifts
 * must not silently reorder history.
 */
export function assessmentId(assessedAt) {
  if (!assessedAt) return null
  const iso = new Date(assessedAt).toISOString()
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function assessmentPath(id) {
  return `${ASSESSMENT_DIR}/${id}.json`
}

/** Every date an assessment speaks to, not just the day it was written for. */
export function coveredDates(decision = {}) {
  const dates = new Set()
  if (decision.assessmentDate) dates.add(decision.assessmentDate)
  for (const d of decision.nextThreeDays || []) if (d?.date) dates.add(d.date)
  return [...dates].sort()
}

/**
 * What the index says about an assessment. Enough to decide whether the full
 * file is worth fetching — a window of several weeks should cost one read, not
 * one per assessment.
 */
export function summarise(decision = {}, { commit = null, bytes = null, outcome = null } = {}) {
  const id = assessmentId(decision.assessedAt)
  return {
    id,
    file: id ? assessmentPath(id) : null,
    assessedAt: decision.assessedAt ?? null,
    assessmentDate: decision.assessmentDate ?? null,
    covers: coveredDates(decision),
    headline: decision.mode?.headline ?? null,
    mode: decision.mode?.key ?? null,
    debtCalculable: decision.debt?.calculable ?? null,
    debtScore: decision.debt?.score ?? null,
    doNow: decision.today?.doNow?.slug ?? null,
    sourceCommit: commit,
    bytes,
    // Null means still live, not that the forecast failed.
    outcome,
  }
}

/**
 * One index, two questions. `assessments` is the runs, newest first, because
 * the question is almost always about recent advice. `days` is the plan per
 * date, with the links between days in both directions.
 *
 * They are kept in one file so that orienting costs one read: the manifest
 * points here, and a reader that had to fetch a second index to find out what
 * tomorrow says would be one instruction away from not bothering.
 *
 * `byDate` answers from the assessment side which runs spoke to a date. Once
 * days are populated it is answered better by `days.entries[date].authoredBy`,
 * and it goes then rather than now — removing it first would leave a window
 * where neither works.
 */
export function buildIndex(summaries = [], days = []) {
  const assessments = [...summaries]
    .filter(s => s.id)
    .sort((a, b) => String(b.assessedAt).localeCompare(String(a.assessedAt)))

  const byDate = {}
  for (const s of assessments) {
    for (const date of s.covers) (byDate[date] ??= []).push(s.id)
  }

  return {
    indexVersion: INDEX_VERSION,
    note: 'Assessments are ordered newest first and hold the reasoning. Days hold the plans, one file per date, and name the run that wrote each. A day is drifted when something it depends on was written by a later run than itself: the dependency may still resolve, but the plan it was answering has changed. A null outcome means still live, not that the forecast failed.',
    count: assessments.length,
    sealed: assessments.filter(a => a.outcome).length,
    latest: assessments[0]?.id ?? null,
    coversThrough: assessments.flatMap(s => s.covers).sort().pop() ?? null,
    assessments,
    byDate: Object.fromEntries(Object.keys(byDate).sort().map(d => [d, byDate[d]])),
    days: buildDayIndex(days),
  }
}

/** The assessment in force on a date, as of the end of that date. */
export function assessmentInForce(index, date) {
  const ids = index?.byDate?.[date] || []
  const candidates = (index?.assessments || [])
    .filter(a => ids.includes(a.id) && String(a.assessedAt).slice(0, 10) <= date)
  return candidates[0] ?? null
}
