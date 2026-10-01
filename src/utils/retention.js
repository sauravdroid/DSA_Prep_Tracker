import { getPatterns } from './patterns.js'

// Spacing ladder for cold tests. A green promotes to the next rung, a yellow
// drops back to 3 days, a red brings it back tomorrow.
export const INTERVALS = [3, 7, 14, 30]
export const YELLOW_INTERVAL = 3
export const RED_INTERVAL = 1

const SIGNIFICANT_OVERDUE_DAYS = 7
const MIN_PROBLEMS_FOR_TOPIC = 3
const ANCHORS_PER_TOPIC = 4
const MIN_PROMOTION_GAP_DAYS = 2

export const RESULTS = ['green', 'yellow', 'red']
export const MODES_OF_PRACTICE = ['cold', 'warm', 'repair', 'learn']
export const HELP_LEVELS = ['none', 'hint', 'solution']

/**
 * A `cold` label alone is not evidence. Assisted work or a same-session repeat
 * is warm practice: it shows recall, not delayed unaided retention.
 */
export function isEligibleColdTest(entry) {
  return !!entry
    && entry.mode === 'cold'
    && (entry.help || 'none') === 'none'
    && !entry.sessionRepeat
}

export const ROLES = {
  focus: { key: 'focus', label: 'learning', blurb: 'Actively learning this now' },
  maintenance: { key: 'maintenance', label: 'maintaining', blurb: 'Already learned, protecting it from decay' },
  paused: { key: 'paused', label: 'paused', blurb: 'Deliberately parked — not scheduled, no debt' },
}

// Retention health, independent of whether you are currently learning the topic.
export const HEALTH = {
  unmeasured: { label: 'unmeasured', blurb: 'No anchor has been cold tested yet' },
  fragile: { label: 'fragile', blurb: 'Measured, but not holding up across every subpattern' },
  maintained: { label: 'maintained', blurb: 'Every subpattern passing on a 14d+ interval' },
  stable: { label: 'stable', blurb: 'Every subpattern passing on a 30d interval' },
}

// How an anchor is currently standing, for the UI to distinguish plainly.
export const ANCHOR_STATE = {
  unmeasured: 'unmeasured',
  failed: 'failed cold test',
  due: 'due for validation',
  scheduled: 'scheduled',
}

export const MODES = {
  EXPANSION: { key: 'EXPANSION', label: 'Expansion', newCount: 2, retentionCount: 0 },
  MIXED: { key: 'MIXED', label: 'Mixed', newCount: 1, retentionCount: 1 },
  CONSOLIDATION: { key: 'CONSOLIDATION', label: 'Consolidation', newCount: 0, retentionCount: 2 },
}

const TIME_BUDGET = { Easy: 15, Medium: 25, Hard: 35 }

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from, to) {
  const a = new Date(from + 'T12:00:00')
  const b = new Date(to + 'T12:00:00')
  return Math.round((b - a) / 86400000)
}

// Walk a problem's cold-test history to find where it sits on the ladder.
// Same-session repeats and greens closer together than MIN_PROMOTION_GAP_DAYS
// do not promote: re-solving something twice in a day proves recall, not retention.
function ladderPosition(coldTests) {
  let stage = 0
  let interval = INTERVALS[0]
  let prevDate = null

  for (const t of coldTests) {
    if (t.result === 'green') {
      const gap = prevDate ? daysBetween(prevDate, t.date) : Infinity
      if (!t.sessionRepeat && gap >= MIN_PROMOTION_GAP_DAYS) {
        stage = Math.min(stage + 1, INTERVALS.length - 1)
      }
      interval = INTERVALS[stage]
    } else if (t.result === 'yellow') {
      stage = Math.max(stage - 1, 0)
      interval = YELLOW_INTERVAL
    } else {
      stage = 0
      interval = RED_INTERVAL
    }
    prevDate = t.date
  }
  return { stage, interval }
}

/** Where an anchor would land if graded `result` today. Used for the preview. */
export function previewNextDue(coldTests, result, today) {
  const { stage, interval } = ladderPosition([...(coldTests || []), { result, date: today }])
  return { due: addDays(today, interval), interval, stage }
}

export function anchorStatus(slug, log, problem, revisions, today, subpattern) {
  const entries = log.filter(e => e.slug === slug)
  const coldTests = entries
    .filter(e => e.mode === 'cold')
    .sort((a, b) => a.date.localeCompare(b.date))

  const lastRevision = revisions
    .filter(r => r.slug === slug)
    .reduce((max, r) => (r.date > max ? r.date : max), '')

  const learnedOn = problem?.dateSolved || lastRevision || today
  const { stage, interval } = ladderPosition(coldTests)
  const last = coldTests[coldTests.length - 1] || null
  const anchorDate = last ? last.date : (lastRevision > learnedOn ? lastRevision : learnedOn)
  const due = addDays(anchorDate, interval)
  const daysOverdue = daysBetween(due, today)
  const neverTested = coldTests.length === 0
  const isDue = daysOverdue >= 0

  // A red is only repaired once a *later* cold test clears it; reproducing the
  // solution straight afterwards is warm practice and does not count.
  const repairedAfterRed = last?.result === 'red'
    ? entries.some(e => e.mode === 'repair' && e.date >= last.date)
    : false

  let state = ANCHOR_STATE.scheduled
  if (last?.result === 'red') state = ANCHOR_STATE.failed
  else if (neverTested) state = ANCHOR_STATE.unmeasured
  else if (isDue) state = ANCHOR_STATE.due

  return {
    slug,
    subpattern: subpattern || 'core',
    problem: problem || null,
    coldTests,
    // Evidence that actually qualifies, kept separate from the ladder for now.
    eligibleColdTests: coldTests.filter(isEligibleColdTest),
    hasEligibleEvidence: coldTests.some(isEligibleColdTest),
    attempts: entries,
    lastTest: last,
    lastResult: last ? last.result : null,
    neverTested,
    // "Validated" means it has actually passed cold at least once.
    validated: coldTests.some(t => t.result === 'green'),
    needsRepair: last?.result === 'red' && !repairedAfterRed,
    state,
    stage,
    interval,
    due,
    isDue,
    daysOverdue: Math.max(0, daysOverdue),
    significantlyOverdue: daysOverdue >= SIGNIFICANT_OVERDUE_DAYS,
  }
}

// Anchors should be the problems that actually define the topic: the ones that
// cost the most, get revisited the most, or are hardest.
function anchorScore(p, revisionCount) {
  const fails = p.failedCount || 0
  const acRate = p.acRate == null ? 50 : p.acRate
  return fails * 2 + revisionCount * 1.5 + (100 - acRate) / 20
}

export function suggestAnchors(topicProblems, revisionCounts) {
  const ranked = [...topicProblems]
    .sort((a, b) => anchorScore(b, revisionCounts[b.slug] || 0) - anchorScore(a, revisionCounts[a.slug] || 0))
    .slice(0, ANCHORS_PER_TOPIC)
  // Without a declared subpattern split, everything sits in one group.
  return { core: ranked.map(p => p.slug) }
}

/** Flatten `{ subpattern: [slug] }` into anchor rows. */
function anchorsFor(groups, log, problems, revisions, today) {
  const out = []
  for (const [subpattern, slugs] of Object.entries(groups || {})) {
    for (const slug of slugs || []) {
      out.push(anchorStatus(slug, log, problems[slug], revisions, today, subpattern))
    }
  }
  return out
}

/**
 * Health requires evidence across *every* subpattern. Without that, one anchor
 * passing repeatedly could promote a topic while the rest stay unmeasured.
 */
function deriveHealth(anchors) {
  const bySub = new Map()
  for (const a of anchors) {
    if (!bySub.has(a.subpattern)) bySub.set(a.subpattern, [])
    bySub.get(a.subpattern).push(a)
  }

  const subpatterns = [...bySub.entries()].map(([name, list]) => ({
    name,
    validated: list.some(a => a.validated),
    anchors: list,
  }))
  const validated = subpatterns.filter(s => s.validated).length
  const coverage = { validated, total: subpatterns.length, subpatterns }

  if (anchors.every(a => a.neverTested)) return { health: 'unmeasured', coverage }
  if (validated < subpatterns.length) return { health: 'fragile', coverage }

  const allGreen = anchors.every(a => a.lastResult === 'green')
  const minStage = anchors.reduce((m, a) => Math.min(m, a.stage), Infinity)

  if (allGreen && minStage >= 3) return { health: 'stable', coverage }
  if (allGreen && minStage >= 2) return { health: 'maintained', coverage }
  return { health: 'fragile', coverage }
}

function topicDebt(anchors, health) {
  const reasons = []
  let points = 0

  for (const a of anchors) {
    // A never-tested anchor is unmeasured, not decayed. It shows up as due so
    // it gets measured, but charging debt for it would bury a cold start.
    if (a.isDue && !a.neverTested) {
      const pts = a.significantlyOverdue ? 2 : 1
      points += pts
      reasons.push({
        slug: a.slug,
        points: pts,
        label: a.significantlyOverdue
          ? `${a.problem?.title || a.slug} is ${a.daysOverdue}d overdue`
          : `${a.problem?.title || a.slug} is due`,
      })
    }
    if (a.lastResult === 'yellow') {
      points += 1
      reasons.push({ slug: a.slug, points: 1, label: `${a.problem?.title || a.slug} last graded yellow` })
    } else if (a.lastResult === 'red') {
      points += 3
      reasons.push({ slug: a.slug, points: 3, label: `${a.problem?.title || a.slug} failed its last cold test` })
    }
  }

  // Never charge for absent evidence. An unmeasured topic owes an unknown
  // amount, which is reported as unknown rather than converted into points.
  return { points, reasons }
}

export function modeForDebt(debt) {
  if (debt >= 6) return MODES.CONSOLIDATION
  if (debt >= 3) return MODES.MIXED
  return MODES.EXPANSION
}

function budgetFor(problem) {
  return TIME_BUDGET[problem?.difficulty] || 25
}

// Recovery first, then real decay, then baseline measurement.
function agendaPriority(a) {
  if (a.needsRepair) return 0
  if (a.lastResult === 'red') return 1
  if (a.lastResult === 'yellow') return 2
  if (a.neverTested) return 4
  return 3
}

function agendaReason(a) {
  if (a.needsRepair) return 'Failed cold — repair this before anything else'
  if (a.lastResult === 'red') return 'Repaired since the red; retest it cold'
  if (a.lastResult === 'yellow') return 'Shaky last time, back on the short interval'
  if (a.neverTested) return 'Never measured cold — baseline this anchor'
  if (a.significantlyOverdue) return `${a.daysOverdue} days past due`
  return 'Due on the spacing ladder'
}

/**
 * Full retention picture. Only topics with a focus/maintenance role carry debt
 * and appear in the agenda; paused and untracked topics are listed only.
 */
export function computeRetention({ problems, revisions, log, anchorOverrides, topicRoles, today }) {
  const problemList = Object.values(problems)
  const roles = topicRoles || {}
  const practiceLog = log || []

  const revisionCounts = {}
  for (const r of revisions) revisionCounts[r.slug] = (revisionCounts[r.slug] || 0) + 1

  const byTopic = {}
  for (const p of problemList) {
    for (const pat of getPatterns(p.tags)) {
      if (!byTopic[pat]) byTopic[pat] = []
      byTopic[pat].push(p)
    }
  }

  const topics = []
  for (const [name, topicProblems] of Object.entries(byTopic)) {
    const override = anchorOverrides[name]
    const hasOverride = override && typeof override === 'object' && Object.keys(override).length > 0
    const role = roles[name] || null
    if (topicProblems.length < MIN_PROBLEMS_FOR_TOPIC && !hasOverride && !role) continue

    const groups = hasOverride ? override : suggestAnchors(topicProblems, revisionCounts)
    const anchors = anchorsFor(groups, practiceLog, problems, revisions, today)

    const { health, coverage } = deriveHealth(anchors)
    // Paused topics keep their history visible but are not scheduled.
    const scheduled = role === 'focus' || role === 'maintenance'
    const { points, reasons } = scheduled ? topicDebt(anchors, health) : { points: 0, reasons: [] }
    // Debt is only a number once something in this topic has been measured.
    const debtKnown = anchors.some(a => a.hasEligibleEvidence)

    topics.push({
      name,
      role,
      tracked: !!role,
      scheduled,
      problemCount: topicProblems.length,
      anchors,
      anchorGroups: groups,
      anchorsPinned: hasOverride,
      candidates: topicProblems,
      health,
      coverage,
      debt: debtKnown ? points : null,
      debtKnown,
      // Ordering only; never rendered as a score.
      measuredPoints: points,
      reasons,
      dueCount: anchors.filter(a => a.isDue).length,
      unmeasuredCount: anchors.filter(a => a.neverTested).length,
      needsRepairCount: anchors.filter(a => a.needsRepair).length,
      nextDue: anchors.reduce((min, a) => (!min || a.due < min ? a.due : min), null),
    })
  }

  topics.sort((a, b) =>
    Number(b.scheduled) - Number(a.scheduled) ||
    b.measuredPoints - a.measuredPoints ||
    b.dueCount - a.dueCount ||
    a.name.localeCompare(b.name)
  )

  const scheduledList = topics.filter(t => t.scheduled)
  const focusTopics = scheduledList.filter(t => t.role === 'focus')
  const maintenanceTopics = scheduledList.filter(t => t.role === 'maintenance')
  const pausedTopics = topics.filter(t => t.role === 'paused')
  const measuredDebt = scheduledList.reduce((s, t) => s + t.measuredPoints, 0)
  const unmeasuredTotal = scheduledList.reduce((s, t) => s + t.unmeasuredCount, 0)

  // Only evidence on a *tracked* anchor makes debt calculable. A cold test on a
  // paused or untracked topic says nothing about what is being scheduled.
  const debtCalculable = scheduledList.some(t => t.debtKnown)
  const totalDebt = debtCalculable ? measuredDebt : null

  // Absent evidence is not low debt. Until something is measured, the mode is a
  // provisional Mixed that reserves a baseline slot rather than an Expansion
  // derived from the silence.
  const modeProvisional = !debtCalculable
  const mode = modeProvisional ? MODES.MIXED : modeForDebt(measuredDebt)

  let newCount = mode.newCount
  let retentionCount = mode.retentionCount
  let caveat = null
  if (modeProvisional) {
    caveat = scheduledList.length === 0
      ? null
      : 'No tracked anchor has an eligible cold test yet, so retention debt is unknown rather than zero. One baseline is reserved.'
  } else if (retentionCount === 0 && unmeasuredTotal > 0) {
    retentionCount = 1
    newCount = Math.max(0, newCount - 1)
    caveat = 'Low measured debt, but some anchors are still unverified. One baseline cold test is reserved.'
  }

  const dueAnchors = scheduledList
    .flatMap(t => t.anchors.filter(a => a.isDue).map(a => ({ ...a, topic: t.name, role: t.role, health: t.health })))
    .sort((a, b) =>
      agendaPriority(a) - agendaPriority(b) ||
      b.daysOverdue - a.daysOverdue ||
      (a.problem?.title || '').localeCompare(b.problem?.title || '')
    )

  const agenda = dueAnchors.slice(0, retentionCount).map((a, i) => ({
    ...a,
    order: i === 0 ? 'Do now' : 'Then',
    reason: agendaReason(a),
    minutes: budgetFor(a.problem),
    suggestedMode: a.needsRepair ? 'repair' : 'cold',
  }))

  // What actually happened on a day, straight from the tracker — never from the
  // coaching file, which must not be able to claim work that did not happen.
  const trackedNames = new Set(scheduledList.map(t => t.name))
  // Which of your tracked topics a problem belongs to, so the day reads at a glance.
  const topicsFor = problem => {
    if (!problem) return { tracked: [], all: [] }
    const all = getPatterns(problem.tags)
    return { tracked: all.filter(p => trackedNames.has(p)), all }
  }

  /**
   * A day's work, one entry per problem. A graded attempt and a resubmission
   * picked up from LeetCode are separate facts about the same problem, and
   * listing them apart made a three-problem day read as a six-item one.
   */
  const doneOn = date => {
    const byProblem = new Map()
    const slot = (slug, problem) => {
      if (!byProblem.has(slug)) {
        byProblem.set(slug, {
          key: `done:${slug}`,
          slug,
          problem: problem || null,
          ...topicsFor(problem),
          attempts: [],
          solved: false,
          revised: false,
        })
      }
      return byProblem.get(slug)
    }

    for (const e of practiceLog) {
      if (e.date !== date) continue
      slot(e.slug, problems[e.slug]).attempts.push({
        id: e.id,
        result: e.result,
        mode: e.mode,
        timeMinutes: e.timeMinutes,
        help: e.help,
        sessionRepeat: e.sessionRepeat,
        skipped: e.skipped,
      })
    }
    for (const p of problemList) {
      if (p.dateSolved === date) slot(p.slug, p).solved = true
    }
    for (const r of revisions) {
      if (r.date === date) slot(r.slug, problems[r.slug]).revised = true
    }
    return [...byProblem.values()]
  }

  const doneToday = doneOn(today)

  // Mutually exclusive anchor states across tracked topics — what is left to prove.
  const byState = { scheduled: 0, 'due for validation': 0, 'failed cold test': 0, unmeasured: 0 }
  let validated = 0
  for (const t of scheduledList) {
    for (const a of t.anchors) {
      byState[a.state] = (byState[a.state] || 0) + 1
      if (a.validated) validated++
    }
  }
  const anchorSummary = {
    byState,
    validated,
    total: Object.values(byState).reduce((s, n) => s + n, 0),
  }

  // Flat anchor view, tagged with its topic, for scope-based forecast conditions.
  const anchorList = scheduledList.flatMap(t =>
    t.anchors.map(a => ({ ...a, topic: t.name, role: t.role }))
  )

  return {
    topics,
    trackedList: scheduledList,
    scheduledList,
    focusTopics,
    maintenanceTopics,
    pausedTopics,
    trackedCount: scheduledList.length,
    // null means unknown. It is never zero-by-default, because a published zero
    // would read as "retention verified".
    totalDebt,
    debtCalculable,
    measuredDebt,
    mode,
    modeProvisional,
    plan: { newCount, retentionCount, caveat },
    dueToday: dueAnchors,
    agenda,
    doneToday,
    doneOn,
    anchorSummary,
    anchorList,
    unmeasuredTotal,
  }
}
