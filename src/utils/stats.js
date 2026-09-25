import { getPatterns } from './patterns'

const DIFFICULTIES = ['Easy', 'Medium', 'Hard']
const DIFFICULTY_WEIGHT = { Easy: 1, Medium: 2, Hard: 3 }

function inRange(date, from, to) {
  return !!date && date >= from && date <= to
}

function monthKey(date) {
  return date.slice(0, 7)
}

function monthLabel(key) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
}

function avg(nums) {
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// Every month between the two dates inclusive, so gaps show as empty bars
// rather than being silently collapsed.
function monthSpan(from, to) {
  const keys = []
  const start = new Date(from.slice(0, 7) + '-01T12:00:00')
  const end = new Date(to.slice(0, 7) + '-01T12:00:00')
  const cur = new Date(start)
  while (cur <= end && keys.length < 240) {
    keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
    cur.setMonth(cur.getMonth() + 1)
  }
  return keys
}

function daysBetween(from, to) {
  const a = new Date(from + 'T12:00:00')
  const b = new Date(to + 'T12:00:00')
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}

export function computeStats(problems, revisions, failures, from, to) {
  const newProblems = Object.values(problems).filter(p => inRange(p.dateSolved, from, to))
  const rangeRevisions = revisions.filter(r => inRange(r.date, from, to))
  const rangeFailures = (failures || []).filter(f => inRange(f.date, from, to))

  const revisionProblems = rangeRevisions.map(r => problems[r.slug]).filter(Boolean)

  // --- Difficulty mix (new problems only; revisions reuse the same problem) ---
  const difficultyCounts = { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 }
  for (const p of newProblems) {
    const d = DIFFICULTIES.includes(p.difficulty) ? p.difficulty : 'Unknown'
    difficultyCounts[d]++
  }
  const difficultyMix = Object.entries(difficultyCounts)
    .filter(([, n]) => n > 0)
    .map(([name, value]) => ({ name, value }))

  // --- Pattern breakdown ---
  const patternMap = {}
  const bump = (pattern, key) => {
    if (!patternMap[pattern]) {
      patternMap[pattern] = { pattern, new: 0, revisions: 0, total: 0, hard: 0, medium: 0, easy: 0, fails: 0, acRates: [] }
    }
    patternMap[pattern][key]++
    patternMap[pattern].total++
  }
  // A problem tagged with several patterns counts toward each of them, so
  // these totals intentionally sum to more than newProblems.length.
  for (const p of newProblems) {
    for (const pat of getPatterns(p.tags)) {
      bump(pat, 'new')
      const g = patternMap[pat]
      if (p.difficulty === 'Hard') g.hard++
      else if (p.difficulty === 'Medium') g.medium++
      else if (p.difficulty === 'Easy') g.easy++
      if (p.acRate != null) g.acRates.push(p.acRate)
    }
  }
  for (const p of revisionProblems) {
    for (const pat of getPatterns(p.tags)) bump(pat, 'revisions')
  }
  for (const f of rangeFailures) {
    const p = problems[f.slug]
    if (!p) continue
    for (const pat of getPatterns(p.tags)) {
      if (patternMap[pat]) patternMap[pat].fails++
    }
  }
  const patterns = Object.values(patternMap)
    .map(g => ({
      ...g,
      avgAcRate: avg(g.acRates),
      // Accepted solves in range vs. total submissions on those problems.
      acceptRate: g.new + g.revisions > 0
        ? ((g.new + g.revisions) / (g.new + g.revisions + g.fails)) * 100
        : null,
    }))
    .sort((a, b) => b.total - a.total)

  // --- Activity by day ---
  const byDay = {}
  for (const p of newProblems) {
    if (!byDay[p.dateSolved]) byDay[p.dateSolved] = { new: 0, revisions: 0 }
    byDay[p.dateSolved].new++
  }
  for (const r of rangeRevisions) {
    if (!byDay[r.date]) byDay[r.date] = { new: 0, revisions: 0 }
    byDay[r.date].revisions++
  }
  const activeDays = Object.keys(byDay).length
  const totalDays = daysBetween(from, to)

  const sortedActive = Object.keys(byDay).sort()
  let longestStreak = 0
  let currentRun = 0
  let prev = null
  for (const d of sortedActive) {
    if (prev && daysBetween(prev, d) === 2) currentRun++
    else currentRun = 1
    if (currentRun > longestStreak) longestStreak = currentRun
    prev = d
  }

  // --- Monthly series ---
  const monthly = monthSpan(from, to).map(key => ({
    key,
    month: monthLabel(key),
    new: 0,
    revisions: 0,
    fails: 0,
    hard: 0,
    total: 0,
    _acRates: [],
    _weights: [],
  }))
  const monthIndex = Object.fromEntries(monthly.map((m, i) => [m.key, i]))
  for (const p of newProblems) {
    const m = monthly[monthIndex[monthKey(p.dateSolved)]]
    if (!m) continue
    m.new++
    m.total++
    if (p.difficulty === 'Hard') m.hard++
    if (p.acRate != null) m._acRates.push(p.acRate)
    m._weights.push(DIFFICULTY_WEIGHT[p.difficulty] || 2)
  }
  for (const r of rangeRevisions) {
    const m = monthly[monthIndex[monthKey(r.date)]]
    if (!m) continue
    m.revisions++
    m.total++
  }
  for (const f of rangeFailures) {
    const m = monthly[monthIndex[monthKey(f.date)]]
    if (m) m.fails++
  }
  for (const m of monthly) {
    m.avgAcRate = avg(m._acRates)
    m.avgDifficulty = avg(m._weights)
    m.hardPct = m.new > 0 ? (m.hard / m.new) * 100 : 0
    m.acceptRate = m.total + m.fails > 0 ? (m.total / (m.total + m.fails)) * 100 : null
    delete m._acRates
    delete m._weights
  }

  // --- Overall difficulty / accuracy signals ---
  const acRates = newProblems.map(p => p.acRate).filter(v => v != null)
  const totalSolves = newProblems.length + rangeRevisions.length
  const totalSubmissions = totalSolves + rangeFailures.length

  // How far back the failure log actually reaches, so the UI can warn when
  // the selected range predates it.
  const failureLogStart = (failures || []).length > 0
    ? failures.reduce((min, f) => (f.date < min ? f.date : min), failures[0].date)
    : null

  const hardest = [...newProblems]
    .filter(p => p.acRate != null)
    .sort((a, b) => a.acRate - b.acRate)
    .slice(0, 8)

  const mostAttempts = Object.entries(
    rangeFailures.reduce((acc, f) => {
      acc[f.slug] = (acc[f.slug] || 0) + 1
      return acc
    }, {})
  )
    .map(([slug, fails]) => ({ problem: problems[slug], fails }))
    .filter(x => x.problem)
    .sort((a, b) => b.fails - a.fails)
    .slice(0, 8)

  return {
    from,
    to,
    newCount: newProblems.length,
    revisionCount: rangeRevisions.length,
    totalCount: totalSolves,
    uniqueRevised: new Set(rangeRevisions.map(r => r.slug)).size,
    failCount: rangeFailures.length,
    acceptRate: totalSubmissions > 0 ? (totalSolves / totalSubmissions) * 100 : null,
    avgAcRate: avg(acRates),
    avgDifficulty: avg(newProblems.map(p => DIFFICULTY_WEIGHT[p.difficulty] || 2)),
    difficultyCounts,
    difficultyMix,
    patterns,
    monthly,
    activeDays,
    totalDays,
    longestStreak,
    perActiveDay: activeDays > 0 ? totalSolves / activeDays : 0,
    failureLogStart,
    hardest,
    mostAttempts,
  }
}

export function getDataDateRange(problems, revisions) {
  const dates = [
    ...Object.values(problems).map(p => p.dateSolved),
    ...revisions.map(r => r.date),
  ].filter(Boolean)
  if (dates.length === 0) return null
  dates.sort()
  return { from: dates[0], to: dates[dates.length - 1] }
}
