import { todayStr } from './utils/dateUtils'

const KEYS = {
  SESSION: 'dsa_session',
  PROBLEMS: 'dsa_problems',
  REVISIONS: 'dsa_revisions',
  START_DATE: 'dsa_start_date',
  LAST_SYNC: 'dsa_last_sync',
  TODAY_REV_LIST: 'dsa_today_rev_list',
}

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
}

export function getSession() {
  return localStorage.getItem(KEYS.SESSION) || ''
}

export function saveSession(cookie) {
  localStorage.setItem(KEYS.SESSION, cookie)
}

export function getStartDate() {
  return localStorage.getItem(KEYS.START_DATE) || '2026-03-04'
}

export function saveStartDate(date) {
  localStorage.setItem(KEYS.START_DATE, date)
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
  localStorage.setItem(KEYS.LAST_SYNC, new Date().toISOString())
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
  localStorage.setItem(KEYS.LAST_SYNC, new Date().toISOString())
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
