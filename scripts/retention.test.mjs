import test from 'node:test'
import assert from 'node:assert/strict'

import { computeRetention, isEligibleColdTest, MODES } from '../src/utils/retention.js'

/* Synthetic inputs only. These tests never read the user's tracker or coaching
   files — they construct every problem, revision and attempt inline. */

const TODAY = '2026-09-30'

const problem = (slug, tags, over = {}) => ({
  slug,
  title: slug,
  tags,
  difficulty: 'Medium',
  dateSolved: '2026-08-01',
  failedCount: 0,
  acRate: 50,
  url: `https://leetcode.com/problems/${slug}/`,
  ...over,
})

const attempt = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  slug: 'a1',
  date: TODAY,
  at: `${TODAY}T10:00:00.000Z`,
  mode: 'cold',
  result: 'green',
  help: 'none',
  sessionRepeat: false,
  timeMinutes: 20,
  ...over,
})

/** One tracked topic with `count` anchors, pinned so suggestions don't vary. */
function world({ log = [], role = 'maintenance', count = 2, extra = {} } = {}) {
  const slugs = Array.from({ length: count }, (_, i) => `a${i + 1}`)
  const problems = {}
  for (const s of slugs) problems[s] = problem(s, ['Stack'])
  for (const [slug, p] of Object.entries(extra.problems || {})) problems[slug] = p

  return computeRetention({
    problems,
    revisions: [],
    log,
    anchorOverrides: { Stack: { core: slugs }, ...(extra.anchorOverrides || {}) },
    topicRoles: { Stack: role, ...(extra.topicRoles || {}) },
    today: TODAY,
  })
}

const stack = r => r.topics.find(t => t.name === 'Stack')

/* ---------- Eligibility ---------- */

test('a cold label alone is not eligible evidence', () => {
  assert.equal(isEligibleColdTest(attempt()), true)
  assert.equal(isEligibleColdTest(attempt({ help: 'hint' })), false)
  assert.equal(isEligibleColdTest(attempt({ help: 'solution' })), false)
  assert.equal(isEligibleColdTest(attempt({ sessionRepeat: true })), false)
  assert.equal(isEligibleColdTest(attempt({ mode: 'warm' })), false)
  assert.equal(isEligibleColdTest(attempt({ mode: 'repair' })), false)
})

/* ---------- Cold start: unknown, not zero ---------- */

test('with no attempts, measured debt is unknown rather than zero', () => {
  const r = world()
  assert.equal(r.debtCalculable, false)
  assert.equal(r.totalDebt, null)
  assert.equal(stack(r).debt, null)
  assert.equal(stack(r).debtKnown, false)
})

test('an unmeasured topic is charged no points', () => {
  const r = world()
  assert.equal(stack(r).measuredPoints, 0)
  assert.equal(r.measuredDebt, 0)
  assert.equal(stack(r).health, 'unmeasured')
  // The old defect: a topic-level +1 for never having been tested.
  assert.ok(!stack(r).reasons.some(x => /never been cold tested/i.test(x.label)))
})

test('a cold start is provisional Mixed with one baseline reserved, not Expansion', () => {
  const r = world()
  assert.equal(r.modeProvisional, true)
  assert.equal(r.mode.key, MODES.MIXED.key)
  assert.equal(r.plan.retentionCount, 1)
  assert.match(r.plan.caveat, /unknown rather than zero/)
})

test('assisted or repeated work does not make debt calculable', () => {
  for (const over of [{ help: 'solution' }, { sessionRepeat: true }, { mode: 'warm' }]) {
    const r = world({ log: [attempt(over)] })
    assert.equal(r.debtCalculable, false, JSON.stringify(over))
    assert.equal(r.totalDebt, null)
    assert.equal(r.modeProvisional, true)
  }
})

test('evidence on an untracked topic does not make tracked debt calculable', () => {
  const r = world({
    log: [attempt({ slug: 'other' })],
    extra: { problems: { other: problem('other', ['Heap']) } },
  })
  assert.equal(r.debtCalculable, false)
  assert.equal(r.totalDebt, null)
})

test('evidence on a paused topic does not make tracked debt calculable', () => {
  const r = world({
    log: [attempt({ slug: 'p1' })],
    extra: {
      problems: { p1: problem('p1', ['Heap']) },
      anchorOverrides: { Heap: { core: ['p1'] } },
      topicRoles: { Heap: 'paused' },
    },
  })
  assert.equal(r.debtCalculable, false)
  assert.equal(r.totalDebt, null)
})

/* ---------- Once measured ---------- */

test('one eligible cold test makes debt calculable and a real number', () => {
  const r = world({ log: [attempt({ slug: 'a1', result: 'green' })] })
  assert.equal(r.debtCalculable, true)
  assert.equal(typeof r.totalDebt, 'number')
  assert.equal(r.modeProvisional, false)
  assert.equal(stack(r).debtKnown, true)
})

test('measured contributions still score: yellow 1, red 3', () => {
  const yellow = world({ count: 1, log: [attempt({ result: 'yellow' })] })
  assert.equal(yellow.totalDebt, 1)
  assert.ok(yellow.topics[0].reasons.some(x => /yellow/i.test(x.label)))

  const red = world({ count: 1, log: [attempt({ result: 'red' })] })
  assert.equal(red.totalDebt, 3)
  assert.ok(red.topics[0].reasons.some(x => /failed/i.test(x.label)))
})

test('an overdue measured anchor is charged, a never-tested one is not', () => {
  // Green long ago: due, and now overdue enough to score 2.
  const r = world({
    count: 2,
    log: [attempt({ slug: 'a1', date: '2026-08-01', at: '2026-08-01T10:00:00.000Z' })],
  })
  const t = stack(r)
  assert.equal(t.debtKnown, true)
  assert.ok(t.reasons.some(x => x.slug === 'a1'))
  // a2 has never been tested and must contribute nothing.
  assert.ok(!t.reasons.some(x => x.slug === 'a2'))
})

test('partial measurement keeps real debt and still reports remaining uncertainty', () => {
  const r = world({ count: 3, log: [attempt({ slug: 'a1', result: 'yellow' })] })
  assert.equal(r.debtCalculable, true)
  assert.equal(r.totalDebt, 1)
  assert.equal(r.unmeasuredTotal, 2)
  assert.equal(stack(r).coverage.validated, 0)
})

/* ---------- Consistency across surfaces ---------- */

test('topic debts sum to the reported total', () => {
  const r = world({ count: 2, log: [attempt({ slug: 'a1', result: 'red' })] })
  const sum = r.scheduledList.reduce((s, t) => s + t.measuredPoints, 0)
  assert.equal(sum, r.measuredDebt)
  assert.equal(r.totalDebt, r.measuredDebt)
})

test('an unknown total never renders as a badge number', () => {
  const r = world()
  // App.jsx gates the badge on `calculable && totalDebt > 0`.
  assert.equal(r.debtCalculable && r.totalDebt > 0, false)
})
