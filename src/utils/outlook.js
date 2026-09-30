/**
 * Deterministic resolution of a saved three-day forecast into one visible plan.
 *
 * The coaching file proposes scenarios; this module decides which single one the
 * recorded facts actually select. Rendering must not re-derive a branch — every
 * surface (workload header, task list, preview, decision map) reads the view
 * model returned here.
 *
 * Conditions evaluate to true / false / 'unknown'. Absent evidence is unknown,
 * never false: "no graded attempt found" does not prove the user skipped the work.
 */

export const OUTLOOK_SCHEMA_VERSION = 2

export const STATUS = {
  ready: { key: 'ready', label: 'Plan ready' },
  awaiting: { key: 'awaiting', label: 'Awaiting result' },
  preview: { key: 'preview', label: 'Preview only' },
  review: { key: 'review', label: 'Needs review' },
  complete: { key: 'complete', label: 'Complete' },
}

export const UNKNOWN = 'unknown'

/** Outcomes a dependency can take, including the explicit "did not do it" fact. */
export const OUTCOMES = [
  { value: 'green', label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'red', label: 'Red' },
  { value: 'not_completed', label: 'Not completed' },
]

const SUPPORTED_OPS = new Set([
  'always', 'result_is', 'not_completed', 'all', 'any', 'unresolved_failure', 'recheck_due',
])

function weekday(date, format = 'long') {
  // Noon avoids the UTC shift that would move an IST date back a day.
  return new Date(date + 'T12:00:00').toLocaleDateString('default', { weekday: format })
}

/* ---------- Dependency facts ---------- */

/**
 * A dependency is identified by slug + local date + practice mode, never by
 * "the most recent attempt anywhere" or by a display label.
 *
 * For a cold dependency only an unaided, non-repeat attempt is eligible
 * evidence. Assisted or same-session repeats are warm practice: they leave the
 * dependency ambiguous rather than supplying a grade.
 */
export function resolveDependency(dep, practiceLog = []) {
  const base = { id: dep.id, slug: dep.slug, title: dep.title || dep.slug, date: dep.date || null, mode: dep.mode || null }

  if (!dep.id || !dep.slug) {
    return { ...base, state: 'malformed', result: null, reason: 'Dependency is missing an id or slug.' }
  }

  const matches = practiceLog.filter(e =>
    e.slug === dep.slug &&
    (!dep.date || e.date === dep.date) &&
    (!dep.mode || e.mode === dep.mode)
  )

  const skipped = matches.find(e => e.result === 'skipped' || e.skipped === true)
  if (skipped) {
    return { ...base, state: 'not_completed', result: 'not_completed', entry: skipped, reason: 'Recorded as not completed.' }
  }

  if (matches.length === 0) {
    return { ...base, state: 'missing', result: null, reason: 'No recorded attempt yet.' }
  }

  const eligible = dep.mode === 'cold'
    ? matches.filter(e => (e.help || 'none') === 'none' && !e.sessionRepeat)
    : matches

  if (eligible.length === 0) {
    return {
      ...base,
      state: 'ambiguous',
      result: null,
      entries: matches,
      reason: 'Only assisted or same-session repeat practice is recorded, which is warm evidence rather than a cold grade.',
    }
  }

  const results = [...new Set(eligible.map(e => e.result))]
  if (results.length > 1) {
    return { ...base, state: 'ambiguous', result: null, entries: eligible, reason: `Conflicting results recorded (${results.join(', ')}).` }
  }

  const entry = eligible[eligible.length - 1]
  return { ...base, state: 'known', result: results[0], entry, reason: null }
}

/* ---------- Condition evaluation ---------- */

function evaluate(pred, ctx) {
  if (!pred) return { value: UNKNOWN, reason: 'Scenario has no condition.' }
  if (!SUPPORTED_OPS.has(pred.op)) {
    return { value: UNKNOWN, unsupported: true, reason: `Unknown condition "${pred.op}".` }
  }

  switch (pred.op) {
    case 'always':
      return { value: true }

    case 'result_is': {
      const fact = ctx.facts[pred.dependency]
      if (!fact) return { value: UNKNOWN, unsupported: true, reason: `Condition refers to unknown dependency "${pred.dependency}".` }
      if (fact.state !== 'known' && fact.state !== 'not_completed') {
        return { value: UNKNOWN, blockedBy: fact.id, reason: fact.reason }
      }
      return { value: (pred.values || []).includes(fact.result) }
    }

    case 'not_completed': {
      const fact = ctx.facts[pred.dependency]
      if (!fact) return { value: UNKNOWN, unsupported: true, reason: `Condition refers to unknown dependency "${pred.dependency}".` }
      if (fact.state === 'not_completed') return { value: true }
      if (fact.state === 'known') return { value: false }
      return { value: UNKNOWN, blockedBy: fact.id, reason: 'No evidence either way that this was done.' }
    }

    case 'all':
    case 'any': {
      const parts = (pred.of || []).map(p => evaluate(p, ctx))
      if (parts.length === 0) return { value: UNKNOWN, reason: 'Empty condition group.' }
      const unsupported = parts.find(p => p.unsupported)
      if (unsupported) return unsupported
      const decisive = pred.op === 'all' ? false : true
      const hit = parts.find(p => p.value === decisive)
      if (hit) return { value: decisive, reason: hit.reason }
      const unknown = parts.find(p => p.value === UNKNOWN)
      if (unknown) return { value: UNKNOWN, blockedBy: unknown.blockedBy, reason: unknown.reason }
      return { value: !decisive }
    }

    case 'unresolved_failure': {
      if (!ctx.anchors) return { value: UNKNOWN, reason: 'Anchor state is not available.' }
      const scope = pred.scope || {}
      const inScope = ctx.anchors.filter(a =>
        (!scope.topic || a.topic === scope.topic) &&
        (!scope.slug || a.slug === scope.slug)
      )
      const failed = inScope.find(a => a.needsRepair)
      return { value: !!failed, anchor: failed || null }
    }

    case 'recheck_due': {
      if (!ctx.anchors) return { value: UNKNOWN, reason: 'Anchor state is not available.' }
      const slug = pred.slug || ctx.facts[pred.dependency]?.slug
      if (!slug) return { value: UNKNOWN, unsupported: true, reason: 'Recheck condition names no problem.' }
      const anchor = ctx.anchors.find(a => a.slug === slug)
      if (!anchor) return { value: UNKNOWN, reason: `${slug} is not a tracked anchor.` }
      if (pred.result && anchor.lastResult !== pred.result) return { value: false, anchor }
      return { value: !!anchor.isDue, anchor }
    }

    default:
      return { value: UNKNOWN, unsupported: true, reason: `Unknown condition "${pred.op}".` }
  }
}

/* ---------- Items and workload ---------- */

function normaliseItem(raw, index) {
  const type = raw.type || (raw.slug ? 'problem' : 'action')
  return {
    key: raw.slug || `${type}-${index}`,
    type,
    slug: raw.slug || null,
    title: raw.title || raw.slug || raw.action || 'Untitled task',
    kind: raw.kind || null,
    purpose: raw.purpose || null,
    topic: raw.topic || null,
    minutes: typeof raw.minutes === 'number' ? raw.minutes : null,
    why: raw.why || null,
    detail: raw.detail || null,
    done: false,
  }
}

/**
 * Problem count and problem time only. Never sums across alternative branches,
 * and never counts "record the result" or "refresh coaching" as a problem.
 * Several planned steps on one problem stay one problem but more than one step.
 */
export function workloadOf(items) {
  const problemItems = items.filter(i => i.type === 'problem')
  const distinct = new Set(problemItems.map(i => i.slug || i.title))
  const timed = problemItems.filter(i => i.minutes != null)
  return {
    problems: distinct.size,
    steps: problemItems.length,
    minutes: timed.reduce((sum, i) => sum + i.minutes, 0),
    timeComplete: problemItems.length > 0 && timed.length === problemItems.length,
    missingEstimates: problemItems.length - timed.length,
    actions: items.length - problemItems.length,
  }
}

/* ---------- Day resolution ---------- */

function legacyDay(day, ctx) {
  const branches = (day.conditional || []).map((b, i) => {
    const items = (b.items || []).map(normaliseItem)
    return {
      id: `legacy-${i}`,
      label: b.if || `Option ${i + 1}`,
      legacy: true,
      outcome: UNKNOWN,
      reason: null,
      items,
      workload: workloadOf(items),
      followUps: [],
      basis: null,
    }
  })

  const saved = (day.items || []).map(normaliseItem)
  const previewId = ctx.previewBranchId && branches.find(b => b.id === ctx.previewBranchId)?.id

  // An unconditional saved list is a real forecast; prose branches are not,
  // because nothing in the file says which one the facts select.
  let selected = null
  let status = STATUS.awaiting
  let basis = ''

  if (previewId) {
    selected = branches.find(b => b.id === previewId)
    status = STATUS.preview
    basis = `Preview of "${selected.label}". Nothing in the saved file lets the app confirm this.`
  } else if (saved.length > 0) {
    selected = { id: 'saved', label: 'Saved plan', items: saved }
    status = STATUS.ready
    basis = 'Saved plan with no conditions attached.'
  } else if (branches.length > 0) {
    basis = 'This day is written as prose alternatives, so the app cannot tell which one applies.'
  }

  const items = selected ? selected.items : []
  return {
    date: day.date,
    weekday: weekday(day.date),
    weekdayShort: weekday(day.date, 'short'),
    headline: day.headline || null,
    note: day.note || (!day.items && !day.conditional ? day.plan : null) || null,
    schemaVersion: 1,
    legacy: true,
    status,
    preview: status === STATUS.preview,
    previewBranchId: previewId || null,
    selected,
    basis,
    items,
    workload: workloadOf(items),
    dependencies: [],
    unresolved: branches.length > 0 && !previewId
      ? { message: 'Choose a scenario to preview. The saved file does not describe its conditions in a way the app can check.' }
      : null,
    scenarios: branches,
    followUps: [],
    reasons: branches.length > 0
      ? ['Written with the older prose format — previews only, until the coaching file is reauthored with structured conditions.']
      : [],
  }
}

/**
 * @param {object} day        one entry of decision.nextThreeDays
 * @param {object} ctx        { practiceLog, anchors, today, previewResults, previewBranchId }
 * @returns view model consumed by every outlook surface
 */
export function resolveOutlookDay(day, ctx = {}) {
  const practiceLog = ctx.practiceLog || []
  const previewResults = ctx.previewResults || null

  if (!day?.scenarios) return legacyDay(day || {}, ctx)

  const facts = {}
  const dependencies = (day.dependencies || []).map(dep => {
    const real = resolveDependency(dep, practiceLog)
    const override = previewResults?.[dep.id]
    const fact = override
      ? { ...real, state: override === 'not_completed' ? 'not_completed' : 'known', result: override, previewed: true, reason: null }
      : real
    facts[dep.id] = fact
    return fact
  })

  const anchors = ctx.anchors || null
  const evalCtx = { facts, anchors }

  const ordered = [...day.scenarios].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))

  const scenarios = []
  let selected = null
  let blocked = null
  let unsupported = null

  for (const scenario of ordered) {
    const outcome = evaluate(scenario.when, evalCtx)
    const items = (scenario.items || []).map(normaliseItem)
    scenarios.push({
      id: scenario.id,
      label: scenario.label || scenario.id,
      priority: scenario.priority ?? 99,
      outcome: outcome.value,
      reason: outcome.reason || null,
      items,
      workload: workloadOf(items),
      followUps: scenario.followUps || [],
      basis: scenario.basis || null,
    })

    if (selected || blocked || unsupported) continue
    if (outcome.unsupported) { unsupported = outcome; continue }
    if (outcome.value === true) selected = scenarios[scenarios.length - 1]
    // A higher-priority branch that is merely unknown must not let a lower one
    // through: recovery outranks expansion, so "no Red recorded" is not "no Red".
    else if (outcome.value === UNKNOWN) blocked = { scenario, outcome }
  }

  const previewing = !!previewResults && Object.keys(previewResults).length > 0
  const reasons = []
  let status = STATUS.awaiting
  let basis = ''
  let unresolved = null

  if (unsupported) {
    status = STATUS.review
    reasons.push(unsupported.reason)
    basis = 'The saved file uses a condition this version of the app does not understand.'
  } else if (selected) {
    status = previewing ? STATUS.preview : STATUS.ready
    // An authored basis asserts a fact, so a preview has to describe itself.
    basis = previewing
      ? describeBasis(selected, facts, true)
      : selected.basis || describeBasis(selected, facts, false)
  } else if (blocked) {
    status = STATUS.awaiting
    const fact = facts[blocked.outcome.blockedBy] || dependencies[0]
    unresolved = {
      dependencyId: fact?.id || null,
      slug: fact?.slug || null,
      title: fact?.title || null,
      date: fact?.date || null,
      mode: fact?.mode || null,
      message: day.unresolved?.message
        || (fact ? `Waiting for ${weekday(fact.date)}'s ${fact.title} result.` : 'Waiting for a result.'),
      reason: blocked.outcome.reason || fact?.reason || null,
    }
    basis = ''
  } else {
    status = STATUS.review
    reasons.push('No saved scenario matches the recorded facts.')
  }

  // Range shown while awaiting, so the header never implies a finalized branch.
  const candidates = scenarios.filter(s => s.outcome !== false)
  const items = selected ? markDone(selected.items, day.date, practiceLog) : []
  const workload = selected
    ? workloadOf(items)
    : rangeWorkload(candidates)

  if (selected && workload.problems > 0 && items.every(i => i.type !== 'problem' || i.done)) {
    status = previewing ? STATUS.preview : STATUS.complete
  }

  return {
    date: day.date,
    weekday: weekday(day.date),
    weekdayShort: weekday(day.date, 'short'),
    headline: day.headline || null,
    note: day.note || null,
    schemaVersion: 2,
    legacy: false,
    status,
    preview: previewing,
    selected,
    basis,
    items,
    workload,
    dependencies,
    unresolved,
    scenarios,
    followUps: selected?.followUps || [],
    reasons,
  }
}

function describeBasis(scenario, facts, previewing) {
  const used = Object.values(facts).filter(f => f.state === 'known' || f.state === 'not_completed')
  if (used.length === 0) return scenario.label
  const parts = used.map(f => {
    const outcome = f.result === 'not_completed'
      ? 'not completed'
      : `${f.result[0].toUpperCase()}${f.result.slice(1)} result`
    return `${weekday(f.date)}'s ${f.title} ${outcome}`
  })
  return `${previewing ? 'Assuming' : 'Based on'} ${parts.join(' and ')}.`
}

/** A day's own practice records are the only completion evidence used here. */
function markDone(items, date, practiceLog) {
  const doneSlugs = new Set(practiceLog.filter(e => e.date === date).map(e => e.slug))
  return items.map(i => ({ ...i, done: i.type === 'problem' && !!i.slug && doneSlugs.has(i.slug) }))
}

function rangeWorkload(candidates) {
  if (candidates.length === 0) return { problems: 0, steps: 0, minutes: 0, timeComplete: false, missingEstimates: 0, actions: 0, range: null }
  const counts = candidates.map(c => c.workload.problems)
  const mins = Math.min(...counts)
  const max = Math.max(...counts)
  return {
    problems: null,
    steps: null,
    minutes: null,
    timeComplete: false,
    missingEstimates: 0,
    actions: 0,
    range: mins === max ? `${mins}` : `${mins}–${max}`,
  }
}

/** Resolve every day of a saved forecast. */
export function resolveOutlook(decision, ctx = {}) {
  const days = decision?.nextThreeDays || []
  return days.map(day => resolveOutlookDay(day, {
    ...ctx,
    previewResults: ctx.previewByDate?.[day.date] || null,
    previewBranchId: ctx.previewBranchByDate?.[day.date] || null,
  }))
}
