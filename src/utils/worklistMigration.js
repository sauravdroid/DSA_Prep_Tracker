import { buildDayTree } from './decisionTree.js'
import { idFromWrittenAt } from './worklist.js'

/**
 * One-time conversion of the dated day plans into the first worklist version.
 * The rules are written out in docs/worklist-migration.md; this is their only
 * implementation, and it reads the legacy files without changing them.
 *
 * Branches are resolved by the same resolver the old Debt page used, against
 * the recorded practice log, so the result is the plan that was actually in
 * force rather than every alternative the coach ever wrote down.
 */

export const MIGRATION_RULES = 'docs/worklist-migration.md'
export const RECENT_DAYS = 7

const NEW_KINDS = new Set(['new', 'learn'])
const MODE_OF = { cold: 'cold', warm: 'warm', repair: 'repair', learn: 'learn', new: 'learn' }
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard'])

// What a Green has to be to finish the planned work. A cold check is only
// done by an unaided cold pass; repair practice does not stand in for it.
const COMPLETES = {
  cold: e => e.mode === 'cold' && (e.help || 'none') === 'none' && !e.sessionRepeat,
  repair: e => e.mode === 'repair' || e.mode === 'cold',
}
const completes = (kind, e) => e.result === 'green' && (COMPLETES[kind] ? COMPLETES[kind](e) : true)

const dayFile = date => `coaching/days/${date}.json`

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—-]+$/, '')}…`
}

const sentence = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)

function toItem(raw, { problems, id, kind }) {
  const p = problems[raw.slug] || {}
  const item = {
    slug: raw.slug,
    title: raw.title || p.title || raw.slug,
  }
  if (DIFFICULTIES.has(p.difficulty)) item.difficulty = p.difficulty
  if (kind === 'repair') item.flag = 'repair'
  if (MODE_OF[kind]) item.mode = MODE_OF[kind]
  item.reason = clip(sentence(raw.purpose) || raw.why || 'Carried over from the dated plans.', 140)
  const detail = [raw.why, raw.detail].filter(Boolean).join('\n\n')
  if (detail) item.detail = detail
  if (Number.isInteger(raw.minutes) && raw.minutes > 0) item.minutes = raw.minutes
  item.addedIn = id
  return item
}

/**
 * @param {object} input
 * @param {object[]} input.days          legacy day documents
 * @param {object[]} input.practiceLog   tracker attempts
 * @param {object}   input.problems      tracker problems by slug
 * @param {string}   input.today         YYYY-MM-DD
 * @param {string}   input.sourceCommit  data-repo commit everything was read at
 * @param {string}   [input.trackerFingerprint]
 * @param {string}   input.generatedAt   ISO timestamp; becomes writtenAt
 * @param {string[]} [input.extraSources] other files read, for provenance
 * @returns {{ version: object, report: object }}
 */
export function migrateToWorklist({
  days = [],
  practiceLog = [],
  problems = {},
  today,
  sourceCommit,
  trackerFingerprint = null,
  generatedAt,
  extraSources = [],
  recentDays = RECENT_DAYS,
}) {
  const writtenAt = generatedAt.replace(/\.\d+Z$/, 'Z')
  const id = idFromWrittenAt(writtenAt)
  const ordered = [...days].filter(d => d?.date).sort((a, b) => a.date.localeCompare(b.date))
  const tree = buildDayTree(ordered, { practiceLog, today })
  const stateOf = new Map(tree.nodes.map(n => [n.id, n.state]))
  const cutoff = addDays(today, -recentDays)

  const active = new Map()
  const excluded = []
  const seen = []

  for (const day of ordered) {
    for (const scenario of day.scenarios || []) {
      const state = stateOf.get(`${day.date}:${scenario.id}`) || 'open'
      for (const raw of scenario.items || []) {
        if (!raw?.slug || (raw.type && raw.type !== 'problem')) continue
        const source = `${dayFile(day.date)}#${scenario.id}`
        seen.push({ slug: raw.slug, source })
        const title = raw.title || problems[raw.slug]?.title

        if (state === 'ruled-out') {
          excluded.push({ slug: raw.slug, title, source, reason: 'not-selected', detail: 'Its condition resolved false against the recorded attempts.' })
          continue
        }
        if (state !== 'taken') {
          excluded.push({ slug: raw.slug, title, source, reason: 'unresolved-alternative', detail: 'Waiting on a result that was never recorded, so the branch never applied.' })
          continue
        }

        const kind = raw.kind || 'cold'
        const green = practiceLog
          .filter(e => e.slug === raw.slug && e.date >= day.date && completes(kind, e))
          .sort((a, b) => a.date.localeCompare(b.date))[0]
        if (green) {
          excluded.push({ slug: raw.slug, title, source, reason: 'completed', detail: `${sentence(green.mode || 'graded')} Green recorded ${green.date}.` })
          continue
        }
        if (day.date < cutoff) {
          excluded.push({ slug: raw.slug, title, source, reason: 'past-day', detail: `Planned for ${day.date}, more than ${recentDays} days before the migration, and not completed.` })
          continue
        }

        // Ascending dates, so the newest plan for a problem wins and keeps
        // every earlier mention as provenance.
        const prior = active.get(raw.slug)
        active.set(raw.slug, {
          list: NEW_KINDS.has(kind) ? 'new' : 'revision',
          pattern: (raw.topic || problems[raw.slug]?.tags?.[0] || 'Other').trim(),
          date: day.date,
          item: toItem(raw, { problems, id, kind }),
          sources: [...(prior?.sources || []), { file: dayFile(day.date), scenario: scenario.id }],
        })
      }
    }
  }

  // Patterns ordered by their newest planned date, items likewise.
  const lists = { new: new Map(), revision: new Map() }
  const byRecent = [...active.values()].sort((a, b) => b.date.localeCompare(a.date))
  for (const entry of byRecent) {
    const groups = lists[entry.list]
    if (!groups.has(entry.pattern)) groups.set(entry.pattern, [])
    groups.get(entry.pattern).push({ ...entry.item, sources: entry.sources })
  }
  const asList = groups => [...groups].map(([pattern, items]) => ({ pattern, items }))

  // An exclusion is kept unless that very mention became active.
  const key = (slug, source) => `${slug}|${source}`
  const activeKeys = new Set([...active.entries()].flatMap(([slug, e]) => e.sources.map(s => key(slug, `${s.file}#${s.scenario}`))))
  const kept = excluded.filter((e, i, all) =>
    !activeKeys.has(key(e.slug, e.source)) &&
    all.findIndex(x => x.slug === e.slug && x.source === e.source) === i
  )

  const last = [...practiceLog].sort((a, b) => (a.at || a.date).localeCompare(b.at || b.date)).pop()
  const first = ordered[0]?.date
  const latest = ordered[ordered.length - 1]
  const range = first ? (first === latest.date ? first : `${first} – ${latest.date}`) : 'no days'

  const version = {
    worklistVersion: 1,
    id,
    writtenAt,
    replaces: null,
    basedOn: {
      trackerCommit: sourceCommit,
      trackerFingerprint,
      attempts: practiceLog.length,
      lastAttemptAt: last?.at || null,
    },
    headline: clip(`Migrated from the dated plans (${range}).${latest?.headline ? ` Last plan: ${latest.headline}` : ''}`, 200),
    new: asList(lists.new),
    revision: asList(lists.revision),
    migration: {
      sourceCommit,
      generatedAt: writtenAt,
      rules: MIGRATION_RULES,
      sources: [...extraSources, ...ordered.map(d => dayFile(d.date))],
      excluded: kept,
    },
  }

  // Every problem mentioned in a day is either active or explained.
  const accounted = new Set([...activeKeys, ...kept.map(e => key(e.slug, e.source))])
  const unaccounted = seen.filter(s => !accounted.has(key(s.slug, s.source)))

  return {
    version,
    report: {
      days: ordered.length,
      mentions: seen.length,
      active: active.size,
      excluded: kept.length,
      byReason: kept.reduce((m, e) => ({ ...m, [e.reason]: (m[e.reason] || 0) + 1 }), {}),
      unaccounted,
    },
  }
}
