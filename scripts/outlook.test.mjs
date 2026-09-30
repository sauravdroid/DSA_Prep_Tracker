import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { resolveOutlookDay, resolveDependency, workloadOf, STATUS } from '../src/utils/outlook.js'
import { forecastValidity, decisionStaleness } from '../src/utils/coaching.js'

// Fixtures are synthetic and committed. Tests must never read the user's live
// coaching decision or tracker data.
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

const example = fixture('coaching-decision.structured.example.json')
const [THU, FRI, SAT] = example.nextThreeDays

/** Synthetic attempts only — the real practice history is never touched. */
const attempt = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  slug: 'next-greater-element-ii',
  date: '2026-09-30',
  at: '2026-09-30T10:00:00.000Z',
  mode: 'cold',
  result: 'green',
  help: 'none',
  sessionRepeat: false,
  timeMinutes: 20,
  ...over,
})

const anchor = (over = {}) => ({
  slug: 'next-greater-element-ii',
  topic: 'Stack',
  needsRepair: false,
  isDue: false,
  lastResult: null,
  ...over,
})

const ctx = (log = [], anchors = []) => ({ practiceLog: log, anchors, today: '2026-10-01' })

/* ---------- Contract ---------- */

// Schema conformance lives in schema.test.mjs, which validates with ajv.

test('a structured outlook still lives inside a version 1 document', () => {
  // The two version fields are independent; "v2" refers only to the outlook.
  assert.equal(example.version, 1)
  assert.equal(example.outlookSchemaVersion, 2)

  const legacy = fixture('coaching-decision.legacy-prose.example.json')
  assert.equal(legacy.version, 1)
  assert.equal(legacy.outlookSchemaVersion, undefined)
})

/* ---------- Dependency identification ---------- */

test('a dependency is matched by slug, date and mode, not by recency', () => {
  const log = [
    attempt({ slug: 'decode-string', result: 'red' }),
    attempt({ date: '2026-09-29', result: 'red' }),
    attempt({ result: 'green' }),
  ]
  const fact = resolveDependency(THU.dependencies[0], log)
  assert.equal(fact.state, 'known')
  assert.equal(fact.result, 'green')
})

test('assisted or repeated practice is warm evidence, not a cold grade', () => {
  for (const over of [{ help: 'solution' }, { sessionRepeat: true }]) {
    const fact = resolveDependency(THU.dependencies[0], [attempt(over)])
    assert.equal(fact.state, 'ambiguous', JSON.stringify(over))
    assert.equal(fact.result, null)
  }
})

test('conflicting eligible results stay ambiguous rather than picking one', () => {
  const log = [attempt({ id: 'a', result: 'green' }), attempt({ id: 'b', result: 'red' })]
  assert.equal(resolveDependency(THU.dependencies[0], log).state, 'ambiguous')
})

/* ---------- Acceptance check 1: Green and Yellow ---------- */

test('Green shows exactly two problems and 55 minutes', () => {
  const v = resolveOutlookDay(THU, ctx([attempt({ result: 'green' })]))
  assert.equal(v.status, STATUS.ready)
  assert.equal(v.selected.id, 'learning-and-retention')
  assert.equal(v.workload.problems, 2)
  assert.equal(v.workload.minutes, 55)
  assert.equal(v.workload.timeComplete, true)
  assert.match(v.basis, /Green/)
})

test('Yellow shows the same two tasks and keeps its own follow-up', () => {
  const green = resolveOutlookDay(THU, ctx([attempt({ result: 'green' })]))
  const yellow = resolveOutlookDay(THU, ctx([attempt({ result: 'yellow' })]))

  assert.deepEqual(yellow.items.map(i => i.slug), green.items.map(i => i.slug))
  assert.equal(yellow.workload.problems, 2)
  assert.ok(yellow.followUps.some(f => f.date === '2026-10-03'))
  assert.ok(yellow.followUps.some(f => f.date === '2026-10-07'))
  assert.match(yellow.basis, /Yellow/)
})

/* ---------- Acceptance check 2: Red ---------- */

test('Red shows one recovery problem, labelled repair rather than cold', () => {
  const v = resolveOutlookDay(THU, ctx([attempt({ result: 'red' })]))
  assert.equal(v.selected.id, 'recovery')
  assert.equal(v.workload.problems, 1)
  assert.equal(v.workload.minutes, 25)
  assert.equal(v.items[0].kind, 'repair')
})

/* ---------- Acceptance check 3: missing and not-completed ---------- */

test('no grade means Awaiting result — not Green, and not five cards', () => {
  const v = resolveOutlookDay(THU, ctx([]))
  assert.equal(v.status, STATUS.awaiting)
  assert.equal(v.selected, null)
  assert.equal(v.items.length, 0)
  assert.equal(v.workload.range, '1–2')
  assert.match(v.unresolved.message, /Next Greater Element II/)
})

test('an unknown higher-priority branch blocks lower ones', () => {
  // Nothing recorded: "no Red" is unknown, so expansion must not be selected.
  const v = resolveOutlookDay(THU, ctx([]))
  assert.notEqual(v.selected?.id, 'learning-and-retention')
})

test('explicit not-completed carries the baseline forward', () => {
  const v = resolveOutlookDay(THU, ctx([attempt({ result: 'skipped' })]))
  assert.equal(v.selected.id, 'carry-forward')
  assert.equal(v.workload.problems, 1)
  assert.equal(v.items[0].slug, 'next-greater-element-ii')
})

/* ---------- Acceptance check 4: conflicting evidence on Friday ---------- */

test('Friday resolves recovery once, from the anchor that actually failed', () => {
  const log = [attempt({ slug: 'decode-string', date: '2026-10-01', result: 'yellow' })]
  const anchors = [anchor({ slug: 'largest-rectangle-in-histogram', needsRepair: true })]
  const v = resolveOutlookDay(FRI, { ...ctx(log, anchors), today: '2026-10-02' })

  assert.equal(v.selected.id, 'resolve-failure')
  assert.equal(v.workload.problems, 1)
  assert.equal(v.scenarios.filter(s => s.outcome === true).length, 2)
})

test('missing second-test evidence cannot be read as both tests passing', () => {
  const v = resolveOutlookDay(FRI, { ...ctx([], null), today: '2026-10-02' })
  assert.equal(v.status, STATUS.awaiting)
  assert.equal(v.selected, null)
})

/* ---------- Acceptance check 5: Saturday recheck replaces, never adds ---------- */

test('a due Yellow recheck replaces the baseline instead of adding to it', () => {
  const log = [attempt({ result: 'yellow' })]
  const anchors = [anchor({ isDue: true, lastResult: 'yellow' })]
  const v = resolveOutlookDay(SAT, { ...ctx(log, anchors), today: '2026-10-03' })

  assert.equal(v.selected.id, 'yellow-recheck')
  assert.equal(v.workload.problems, 1)
  assert.equal(v.items[0].slug, 'next-greater-element-ii')
  assert.ok(!v.items.some(i => i.slug === 'remove-k-digits'))
})

test('"refresh coaching" is not counted as another problem', () => {
  const log = [attempt({ result: 'green' })]
  const anchors = [anchor({ isDue: false, lastResult: 'green' })]
  const v = resolveOutlookDay(SAT, { ...ctx(log, anchors), today: '2026-10-03' })

  assert.equal(v.selected.id, 'expand')
  assert.equal(v.items.length, 2)
  assert.equal(v.workload.problems, 1)
  assert.equal(v.workload.actions, 1)
})

/* ---------- Acceptance check 6: preview is presentation only ---------- */

test('preview switches tasks, count and basis together without touching facts', () => {
  const log = [attempt({ result: 'green' })]
  const before = JSON.stringify(log)

  const red = resolveOutlookDay(THU, { ...ctx(log), previewResults: { 'nge-baseline': 'red' } })
  assert.equal(red.status, STATUS.preview)
  assert.equal(red.preview, true)
  assert.equal(red.selected.id, 'recovery')
  assert.equal(red.workload.problems, 1)
  assert.match(red.basis, /Assuming/)

  const actual = resolveOutlookDay(THU, ctx(log))
  assert.equal(actual.status, STATUS.ready)
  assert.equal(actual.selected.id, 'learning-and-retention')
  assert.equal(JSON.stringify(log), before)
})

test('preview and decision map agree on the selected scenario', () => {
  const v = resolveOutlookDay(THU, { ...ctx([]), previewResults: { 'nge-baseline': 'yellow' } })
  const selectedInMap = v.scenarios.find(s => s.outcome === true)
  assert.equal(selectedInMap.id, v.selected.id)
})

/* ---------- Acceptance check 8: degraded inputs ---------- */

test('an unknown predicate produces Needs review, never a guessed branch', () => {
  const day = {
    ...THU,
    scenarios: [{ id: 'x', priority: 0, label: 'x', when: { op: 'vibes' }, items: [] }],
  }
  const v = resolveOutlookDay(day, ctx([attempt()]))
  assert.equal(v.status, STATUS.review)
  assert.equal(v.selected, null)
})

test('a condition naming a dependency that does not exist is a review state', () => {
  const day = {
    ...THU,
    scenarios: [{ id: 'x', priority: 0, when: { op: 'result_is', dependency: 'nope', values: ['green'] }, items: [] }],
  }
  assert.equal(resolveOutlookDay(day, ctx([attempt()])).status, STATUS.review)
})

test('missing time estimates are reported, not treated as zero', () => {
  const w = workloadOf([
    { type: 'problem', slug: 'a', minutes: 30 },
    { type: 'problem', slug: 'b', minutes: null },
  ])
  assert.equal(w.problems, 2)
  assert.equal(w.minutes, 30)
  assert.equal(w.timeComplete, false)
  assert.equal(w.missingEstimates, 1)
})

test('several steps on one problem stay one problem', () => {
  const w = workloadOf([
    { type: 'problem', slug: 'a', minutes: 20 },
    { type: 'problem', slug: 'a', minutes: 15 },
  ])
  assert.equal(w.problems, 1)
  assert.equal(w.steps, 2)
  assert.equal(w.minutes, 35)
})

test('legacy prose days load but stay preview-only', () => {
  const legacy = fixture('coaching-decision.legacy-prose.example.json')
  const day = legacy.nextThreeDays[0]

  const v = resolveOutlookDay(day, ctx([attempt({ result: 'green' })]))
  assert.equal(v.legacy, true)
  assert.equal(v.status, STATUS.awaiting)
  assert.equal(v.selected, null)
  assert.ok(v.scenarios.length >= 2)
  // The decision map reads workload off every scenario, legacy ones included.
  for (const s of v.scenarios) assert.equal(typeof s.workload.problems, 'number')

  const previewed = resolveOutlookDay(day, { ...ctx([]), previewBranchId: v.scenarios[0].id })
  assert.equal(previewed.status, STATUS.preview)
  assert.ok(previewed.items.length > 0)
})

test('a missing coaching file yields no plan rather than an invented one', () => {
  assert.equal(forecastValidity(null, {}).usable, false)
  assert.equal(decisionStaleness(null, {}).stale, true)
})

/* ---------- Acceptance check 7: forecast validity ---------- */

test('recording an expected dependency result does not invalidate the forecast', () => {
  const decision = { ...example, trackerSnapshot: { ...example.trackerSnapshot, lastAttemptAt: null } }
  const v = forecastValidity(decision, { practiceLog: [attempt({ result: 'green' })], today: '2026-10-01' })
  assert.equal(v.needsReview, false)
  assert.equal(v.expired, false)
})

test('evidence the plan never mentioned surfaces a review state', () => {
  const v = forecastValidity(example, {
    practiceLog: [attempt({ slug: 'two-sum', date: '2026-10-01' })],
    today: '2026-10-01',
  })
  assert.equal(v.needsReview, true)
  assert.match(v.reasons.join(' '), /two-sum/)
})

test('an expired window is reported rather than relabelled as the next three days', () => {
  const v = forecastValidity(example, { practiceLog: [], today: '2026-10-20' })
  assert.equal(v.expired, true)
  assert.equal(v.usable, false)
  assert.match(v.reasons.join(' '), /2026-10-03/)
})

/* ---------- Dates ---------- */

test('dates are read locally and never shifted through UTC', () => {
  const v = resolveOutlookDay(THU, ctx([attempt({ result: 'green' })]))
  assert.equal(v.date, '2026-10-01')
  assert.equal(v.weekday, 'Thursday')
})
