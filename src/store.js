import { todayStr } from './utils/dateUtils'
import { scheduleSave } from './utils/dataFile'

const KEYS = {
  SESSION: 'dsa_session',
  PROBLEMS: 'dsa_problems',
  REVISIONS: 'dsa_revisions',
  FAILURES: 'dsa_failures',
  START_DATE: 'dsa_start_date',
  LAST_SYNC: 'dsa_last_sync',
  TODAY_REV_LIST: 'dsa_today_rev_list',
  PRACTICE_LOG: 'dsa_practice_log',
  ANCHORS: 'dsa_anchors',
  TRACKED_TOPICS: 'dsa_tracked_topics',
  TOPIC_ROLES: 'dsa_topic_roles',
  NOTES: 'dsa_notes',
  META: 'dsa_meta',
}

export const SCHEMA_VERSION = 2

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
  if (key !== KEYS.META) {
    localStorage.setItem(KEYS.META, JSON.stringify({
      version: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    }))
  }
  scheduleSave()
}

// Plain strings (cookie, dates) are stored unwrapped for readability.
function writeRaw(key, value) {
  localStorage.setItem(key, value)
  scheduleSave()
}

export function getSession() {
  return localStorage.getItem(KEYS.SESSION) || ''
}

export function saveSession(cookie) {
  writeRaw(KEYS.SESSION, cookie)
}

export function getStartDate() {
  return localStorage.getItem(KEYS.START_DATE) || '2026-03-04'
}

export function saveStartDate(date) {
  writeRaw(KEYS.START_DATE, date)
}

export function getLastSync() {
  return localStorage.getItem(KEYS.LAST_SYNC) || null
}

export function getProblems() {
  return read(KEYS.PROBLEMS, {})
}

export function saveProblems(problemsArray) {
  const map = {}
  for (const p of problemsArray) {
    map[p.slug] = p
  }
  write(KEYS.PROBLEMS, map)
  writeRaw(KEYS.LAST_SYNC, new Date().toISOString())
}

export function mergeProblems(newProblems) {
  const existing = getProblems()
  for (const p of newProblems) {
    if (!existing[p.slug]) {
      existing[p.slug] = p
    } else {
      // keep earliest dateSolved, update other fields
      const prev = existing[p.slug]
      existing[p.slug] = {
        ...p,
        dateSolved: prev.dateSolved < p.dateSolved ? prev.dateSolved : p.dateSolved,
      }
    }
  }
  write(KEYS.PROBLEMS, existing)
  writeRaw(KEYS.LAST_SYNC, new Date().toISOString())
  return existing
}

export function getRevisions() {
  return read(KEYS.REVISIONS, [])
}

export function addRevision(slug, date) {
  const revisions = getRevisions()
  const d = date || todayStr()
  // Prevent duplicate entries for same slug+date
  if (revisions.some(r => r.slug === slug && r.date === d)) return revisions
  revisions.push({ slug, date: d })
  write(KEYS.REVISIONS, revisions)
  return revisions
}

export function removeRevision(slug, date) {
  const revisions = getRevisions()
  const idx = revisions.findIndex(r => r.slug === slug && r.date === date)
  if (idx !== -1) revisions.splice(idx, 1)
  write(KEYS.REVISIONS, revisions)
  return revisions
}

export function getRevisionsForProblem(slug) {
  return getRevisions().filter(r => r.slug === slug)
}
export function getRevisionsForDate(date) {
  return getRevisions().filter(r => r.date === date)
}

export function getProblemsForDate(date) {
  const problems = getProblems()
  return Object.values(problems).filter(p => p.dateSolved === date)
}

// Failure events: { slug, date, ts } — one per non-Accepted submission.
export function getFailures() {
  return read(KEYS.FAILURES, [])
}

export function addFailures(events) {
  if (!events || events.length === 0) return getFailures()
  const existing = getFailures()
  const seen = new Set(existing.map(f => `${f.slug}|${f.ts}`))
  for (const e of events) {
    const key = `${e.slug}|${e.ts}`
    if (seen.has(key)) continue
    seen.add(key)
    existing.push(e)
  }
  existing.sort((a, b) => a.ts - b.ts)
  write(KEYS.FAILURES, existing)
  return existing
}

// Today's revision list: { date, slugs: [slug, ...] }
export function getTodayRevisionList() {
  const today = todayStr()
  const data = read(KEYS.TODAY_REV_LIST, { date: '', slugs: [] })
  // Reset if it's a different day
  if (data.date !== today) return { date: today, slugs: [] }
  return data
}

export function saveTodayRevisionList(slugs) {
  const today = todayStr()
  write(KEYS.TODAY_REV_LIST, { date: today, slugs })
}

// Practice log: one entry per graded attempt. Nothing writes here except an
// explicit recording — a synced submission or revision is never a Green.
// { id, slug, date, at, mode: 'cold'|'warm'|'learn'|'repair',
//   result: 'green'|'yellow'|'red', timeMinutes,
//   help: 'none'|'hint'|'solution', sessionRepeat,
//   notes: { invariant, whyHelp, clicked }, freeNote }
export function getPracticeLog() {
  return read(KEYS.PRACTICE_LOG, [])
}

export function addPracticeEntry(entry) {
  const log = getPracticeLog()
  const date = entry.date || todayStr()
  // A repeat inside the same day proves recall, not retention.
  const sessionRepeat = log.some(e => e.slug === entry.slug && e.date === date)

  log.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    slug: entry.slug,
    date,
    at: entry.at || new Date().toISOString(),
    mode: entry.mode || 'cold',
    result: entry.result,
    timeMinutes: entry.timeMinutes ?? null,
    help: entry.help || 'none',
    sessionRepeat,
    notes: {
      invariant: entry.notes?.invariant || '',
      whyHelp: entry.notes?.whyHelp || '',
      clicked: entry.notes?.clicked || '',
    },
    freeNote: entry.freeNote || '',
  })
  log.sort((a, b) => (a.at || a.date).localeCompare(b.at || b.date))
  write(KEYS.PRACTICE_LOG, log)
  return log
}

export function removePracticeEntry(id) {
  const log = getPracticeLog().filter(e => e.id !== id)
  write(KEYS.PRACTICE_LOG, log)
  return log
}

// Anchor mappings: topic -> subpattern -> [slug]. Absent topic means
// "use the auto-suggested anchors".
export function getAnchors() {
  return read(KEYS.ANCHORS, {})
}

export function setTopicAnchors(topic, groups) {
  const anchors = getAnchors()
  const nonEmpty = groups && Object.entries(groups).filter(([, slugs]) => slugs && slugs.length > 0)
  if (nonEmpty && nonEmpty.length > 0) anchors[topic] = Object.fromEntries(nonEmpty)
  else delete anchors[topic]
  write(KEYS.ANCHORS, anchors)
  return anchors
}

export function setAnchorSubpattern(topic, subpattern, slugs) {
  const anchors = getAnchors()
  const groups = { ...(anchors[topic] || {}) }
  if (slugs && slugs.length > 0) groups[subpattern] = slugs
  else delete groups[subpattern]
  return setTopicAnchors(topic, groups)
}

// Topics opted in to the retention system, each with a declared role:
// 'focus' (learning now), 'maintenance' (protecting from decay), 'paused'.
export function getTopicRoles() {
  const roles = read(KEYS.TOPIC_ROLES, null)
  if (roles) return roles
  // Migrate the older flat tracked-topic list.
  const legacy = read(KEYS.TRACKED_TOPICS, [])
  const migrated = {}
  for (const t of legacy) migrated[t] = 'focus'
  if (legacy.length > 0) write(KEYS.TOPIC_ROLES, migrated)
  return migrated
}

export function setTopicRole(topic, role) {
  const roles = getTopicRoles()
  if (role) roles[topic] = role
  else delete roles[topic]
  write(KEYS.TOPIC_ROLES, roles)
  return roles
}

export function getMeta() {
  return read(KEYS.META, { version: 1, updatedAt: null })
}

/**
 * Brings v1 data up to the current schema. Runs once after hydration and is
 * additive — no practice fact is discarded.
 */
export function migrateStore() {
  const meta = getMeta()
  if (meta.version >= SCHEMA_VERSION) return { migrated: false }

  const changes = []

  const log = read(KEYS.PRACTICE_LOG, [])
  if (log.length > 0 && log.some(e => e.hintUsed !== undefined || typeof e.notes === 'string')) {
    const seenByDay = new Set()
    const upgraded = log.map(e => {
      const key = `${e.slug}|${e.date}`
      const sessionRepeat = seenByDay.has(key)
      seenByDay.add(key)
      return {
        ...e,
        at: e.at || `${e.date}T12:00:00.000Z`,
        help: e.help || (e.hintUsed ? 'hint' : 'none'),
        sessionRepeat: e.sessionRepeat ?? sessionRepeat,
        notes: typeof e.notes === 'string'
          ? { invariant: '', whyHelp: '', clicked: '' }
          : e.notes || { invariant: '', whyHelp: '', clicked: '' },
        freeNote: e.freeNote || (typeof e.notes === 'string' ? e.notes : ''),
        hintUsed: undefined,
      }
    })
    localStorage.setItem(KEYS.PRACTICE_LOG, JSON.stringify(upgraded))
    changes.push(`practice log (${upgraded.length})`)
  }

  const anchors = read(KEYS.ANCHORS, {})
  const flat = Object.entries(anchors).filter(([, v]) => Array.isArray(v))
  if (flat.length > 0) {
    const upgraded = { ...anchors }
    for (const [topic, slugs] of flat) upgraded[topic] = { core: slugs }
    localStorage.setItem(KEYS.ANCHORS, JSON.stringify(upgraded))
    changes.push(`anchors (${flat.length} topics)`)
  }

  write(KEYS.META, { version: SCHEMA_VERSION, updatedAt: new Date().toISOString() })
  return { migrated: true, changes }
}

// Notes: slug -> [{ date, text, ts }]
export function getNotes() {
  return read(KEYS.NOTES, {})
}

export function getNotesForSlug(slug) {
  return getNotes()[slug] || []
}

export function addNote(slug, text, date) {
  const trimmed = (text || '').trim()
  if (!trimmed) return getNotes()
  const notes = getNotes()
  if (!notes[slug]) notes[slug] = []
  notes[slug].push({ date: date || todayStr(), text: trimmed, ts: Date.now() })
  write(KEYS.NOTES, notes)
  return notes
}

export function removeNote(slug, ts) {
  const notes = getNotes()
  if (!notes[slug]) return notes
  notes[slug] = notes[slug].filter(n => n.ts !== ts)
  if (notes[slug].length === 0) delete notes[slug]
  write(KEYS.NOTES, notes)
  return notes
}
