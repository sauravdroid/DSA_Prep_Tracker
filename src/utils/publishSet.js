import crypto from 'node:crypto'
import { canonical } from './trackerDiff.js'

export const MANIFEST_PATH = 'manifest.json'
export const EVIDENCE_DIR = 'evidence'
export const SHARD_VERSION = 1
export const MANIFEST_VERSION = 1

/**
 * The files published alongside the tracker so a reader can work over a date
 * range without fetching, and filtering, the whole history.
 *
 * Everything here is derived from the tracker, so it is rebuilt from scratch on
 * every publish and diffed rather than appended to: a correction that rewrites
 * an old month must reach the shard for that month too.
 */

const monthOf = date => (date || '').slice(0, 7)
const parse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

/** Ordering has to be a function of content alone, or every publish rewrites everything. */
const byDateThenSlug = (a, b) =>
  (a.date || '').localeCompare(b.date || '') || (a.slug || '').localeCompare(b.slug || '')

export function fingerprint(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * The tracker's identity is its facts, not its byte order: localStorage key
 * order shifts on every rehydrate, and a fingerprint that moved with it would
 * report unchanged data as new.
 */
function trackerFingerprint(data = {}) {
  const parsed = Object.fromEntries(
    Object.keys(data).sort().map(k => [k, parse(data[k], data[k])])
  )
  return crypto.createHash('sha256').update(canonical(parsed)).digest('hex').slice(0, 16)
}

/**
 * One file per calendar month, carrying the problems it touches so it can be
 * read on its own. `failed` is one entry per failed submission, so the same
 * slug and date can repeat — that repetition is the count.
 */
export function monthlyShards(data = {}) {
  const problems = parse(data.dsa_problems, {})
  const revisions = parse(data.dsa_revisions, [])
  const failures = parse(data.dsa_failures, [])
  const attempts = parse(data.dsa_practice_log, [])

  const months = new Map()
  const bucket = month => {
    if (!months.has(month)) {
      months.set(month, { solved: [], revised: [], failed: [], graded: [] })
    }
    return months.get(month)
  }

  for (const p of Object.values(problems)) {
    if (monthOf(p?.dateSolved)) bucket(monthOf(p.dateSolved)).solved.push({ slug: p.slug, date: p.dateSolved })
  }
  for (const r of revisions) {
    if (monthOf(r?.date)) bucket(monthOf(r.date)).revised.push({ slug: r.slug, date: r.date })
  }
  for (const f of failures) {
    if (monthOf(f?.date)) bucket(monthOf(f.date)).failed.push({ slug: f.slug, date: f.date })
  }
  for (const a of attempts) {
    if (monthOf(a?.date)) bucket(monthOf(a.date)).graded.push(a)
  }

  return [...months.keys()].sort().map(month => {
    const b = months.get(month)
    b.solved.sort(byDateThenSlug)
    b.revised.sort(byDateThenSlug)
    b.failed.sort(byDateThenSlug)
    b.graded.sort((x, y) => (x.at || x.date).localeCompare(y.at || y.date))

    const touched = [...new Set([...b.solved, ...b.revised, ...b.failed, ...b.graded].map(x => x.slug))].sort()
    const catalogue = {}
    for (const slug of touched) {
      const p = problems[slug]
      if (!p) continue
      catalogue[slug] = {
        title: p.title ?? null,
        difficulty: p.difficulty ?? null,
        tags: p.tags || [],
        firstSolved: p.dateSolved ?? null,
      }
    }

    const dates = [...b.solved, ...b.revised, ...b.failed, ...b.graded].map(x => x.date).sort()

    return {
      path: `${EVIDENCE_DIR}/${month}.json`,
      month,
      content: {
        shardVersion: SHARD_VERSION,
        month,
        from: dates[0] ?? null,
        to: dates[dates.length - 1] ?? null,
        counts: {
          solved: b.solved.length,
          revised: b.revised.length,
          failed: b.failed.length,
          graded: b.graded.length,
        },
        problems: catalogue,
        solved: b.solved,
        revised: b.revised,
        failed: b.failed,
        graded: b.graded,
      },
    }
  })
}

const isEligible = e =>
  !!e && e.mode === 'cold' && (e.help || 'none') === 'none' && !e.sessionRepeat

/**
 * An inventory, not an interpretation. Counts and ranges describe the files;
 * mode, debt and topic health are conclusions and belong in an assessment,
 * where the evidence behind them can be checked.
 */
export function buildManifest({ data = {}, savedAt = null, shards = [], repo, codeCommit = null, currentAssessment = null }) {
  const problems = parse(data.dsa_problems, {})
  const revisions = parse(data.dsa_revisions, [])
  const failures = parse(data.dsa_failures, [])
  const attempts = parse(data.dsa_practice_log, [])

  return {
    manifestVersion: MANIFEST_VERSION,
    // Deliberately the tracker's own timestamp: a regeneration that changed
    // nothing must not produce a different file.
    generatedFor: savedAt,
    describes: {
      dataRepository: repo || null,
      trackerPath: 'tracker-data.json',
      trackerSavedAt: savedAt,
      trackerFingerprint: trackerFingerprint(data),
    },
    contracts: {
      codeRepository: 'sauravdroid/DSA_Prep_Tracker',
      codeCommit,
      protocol: 'docs/coach-planning-protocol.md',
      schema: 'schemas/coaching-decision.schema.json',
      manifestSchema: 'schemas/manifest.schema.json',
      evidenceSchema: 'schemas/evidence-shard.schema.json',
      outcomeSchema: 'schemas/coaching-outcome.schema.json',
      policy: 'docs/retention-policy.md',
      policyReference: 'docs/retention-policy.reference.json',
    },
    personalContext: { path: 'context/coaching-context.json' },
    evidence: {
      path: `${EVIDENCE_DIR}/`,
      grain: 'month',
      note: 'failed holds one entry per failed submission, so a slug and date may repeat.',
      coverage: shards.length
        ? { from: shards[0].month, to: shards[shards.length - 1].month }
        : null,
      totals: {
        solved: Object.keys(problems).length,
        revised: revisions.length,
        failed: failures.length,
        graded: attempts.length,
        eligibleColdTests: attempts.filter(isEligible).length,
      },
      shards: shards.map(s => ({
        file: s.path,
        month: s.month,
        from: s.content.from,
        to: s.content.to,
        ...s.content.counts,
        // Lets a reader that already has this month skip fetching it.
        fingerprint: fingerprint(s.content),
      })),
    },
    coaching: {
      index: 'coaching/index.json',
      days: 'coaching/days/',
      assessments: 'coaching/assessments/',
      outcomes: 'coaching/outcomes/',
      weeks: 'coaching/weeks/',
      months: 'coaching/months/',
      // Superseded by days/, and still written by older tooling.
      decision: 'coaching/decision.json',
      current: currentAssessment,
    },
  }
}

/** Everything a publish should write, as path → serialised content. */
export function publishSet({ data, savedAt, repo, codeCommit, currentAssessment }) {
  const shards = monthlyShards(data)
  const manifest = buildManifest({ data, savedAt, shards, repo, codeCommit, currentAssessment })

  const files = new Map()
  for (const s of shards) files.set(s.path, JSON.stringify(s.content, null, 2))
  files.set(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
  return files
}
