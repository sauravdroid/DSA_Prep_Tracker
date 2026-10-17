import test from 'node:test'
import assert from 'node:assert/strict'

import { migrateToWorklist } from '../src/utils/worklistMigration.js'
import { validateWorklist } from '../src/utils/validateWorklist.js'

const problems = {
  'daily-temperatures': { title: 'Daily Temperatures', difficulty: 'Medium', tags: ['Stack'] },
  'coin-change': { title: 'Coin Change', difficulty: 'Medium', tags: ['Dynamic Programming'] },
  'two-sum': { title: 'Two Sum', difficulty: 'Easy', tags: ['Array'] },
}

const item = (slug, kind, topic, extra = {}) => ({
  type: 'problem', slug, title: problems[slug]?.title || slug, kind, topic,
  minutes: 20, purpose: `${kind} check`, why: `Why ${slug}.`, ...extra,
})

const day = (date, scenarios, extra = {}) => ({
  dayVersion: 1, date, authoredBy: { assessment: '20260301T000000Z' }, headline: `Plan for ${date}`, scenarios, ...extra,
})

const run = (days, practiceLog = [], over = {}) => migrateToWorklist({
  days,
  practiceLog,
  problems,
  today: '2026-03-10',
  sourceCommit: 'abc1234',
  trackerFingerprint: '0123456789abcdef',
  generatedAt: '2026-03-10T08:00:00.000Z',
  extraSources: ['tracker-data.json'],
  ...over,
})

test('an always-day becomes active items, grouped by topic into the right list', () => {
  const { version, report } = run([
    day('2026-03-08', [{ id: 'main', when: { op: 'always' }, items: [
      item('daily-temperatures', 'cold', 'Stack'),
      item('coin-change', 'new', 'Dynamic Programming'),
      { type: 'action', title: 'Record the result' },
    ] }]),
  ])
  assert.ok(validateWorklist(version).valid, validateWorklist(version).errors.join('; '))
  assert.equal(version.id, '20260310T080000Z')
  assert.deepEqual(version.revision.map(g => g.pattern), ['Stack'])
  assert.deepEqual(version.new.map(g => g.pattern), ['Dynamic Programming'])
  const dt = version.revision[0].items[0]
  assert.equal(dt.mode, 'cold')
  assert.equal(dt.difficulty, 'Medium')
  assert.deepEqual(dt.sources, [{ file: 'coaching/days/2026-03-08.json', scenario: 'main' }])
  assert.equal(version.new[0].items[0].mode, 'learn')
  assert.equal(report.mentions, 2)
  assert.deepEqual(report.unaccounted, [])
})

test('a Green recorded on or after the planned day excludes the item as completed', () => {
  const { version } = run(
    [day('2026-03-08', [{ id: 'main', when: { op: 'always' }, items: [item('daily-temperatures', 'cold', 'Stack')] }])],
    [{ slug: 'daily-temperatures', date: '2026-03-09', at: '2026-03-09T10:00:00Z', mode: 'cold', result: 'green' }],
  )
  assert.equal(version.revision.length, 0)
  assert.equal(version.migration.excluded[0].reason, 'completed')
  assert.match(version.migration.excluded[0].detail, /Cold Green recorded 2026-03-09/)
})

test('a repair or assisted Green does not complete a cold check', () => {
  const plan = [day('2026-03-08', [{ id: 'main', when: { op: 'always' }, items: [item('daily-temperatures', 'cold', 'Stack')] }])]
  for (const e of [
    { mode: 'repair', help: 'none' },
    { mode: 'cold', help: 'hint' },
  ]) {
    const { version } = run(plan, [{ slug: 'daily-temperatures', date: '2026-03-09', at: '2026-03-09T10:00:00Z', result: 'green', ...e }])
    assert.equal(version.revision[0].items.length, 1, JSON.stringify(e))
  }
  const repairPlan = [day('2026-03-08', [{ id: 'main', when: { op: 'always' }, items: [item('daily-temperatures', 'repair', 'Stack')] }])]
  const { version } = run(repairPlan, [{ slug: 'daily-temperatures', date: '2026-03-09', at: '2026-03-09T10:00:00Z', result: 'green', mode: 'repair', help: 'hint' }])
  assert.equal(version.revision.length, 0)
})

test('a Yellow keeps the item active', () => {
  const { version } = run(
    [day('2026-03-08', [{ id: 'main', when: { op: 'always' }, items: [item('daily-temperatures', 'cold', 'Stack')] }])],
    [{ slug: 'daily-temperatures', date: '2026-03-09', at: '2026-03-09T10:00:00Z', mode: 'cold', result: 'yellow' }],
  )
  assert.equal(version.revision[0].items.length, 1)
  assert.equal(version.basedOn.attempts, 1)
  assert.equal(version.basedOn.lastAttemptAt, '2026-03-09T10:00:00Z')
})

test('unresolved branches are excluded, never flattened into work', () => {
  const deps = [{ id: 'dep', slug: 'daily-temperatures', date: '2026-03-07', mode: 'repair' }]
  const { version, report } = run([
    day('2026-03-08', [
      { id: 'if-red', priority: 0, when: { op: 'result_is', dependency: 'dep', values: ['red'] }, items: [item('daily-temperatures', 'repair', 'Stack')] },
      { id: 'if-green', priority: 1, when: { op: 'result_is', dependency: 'dep', values: ['green'] }, items: [item('daily-temperatures', 'cold', 'Stack')] },
    ], { dependencies: deps }),
  ])
  assert.equal(version.revision.length, 0)
  assert.deepEqual(version.migration.excluded.map(e => e.reason), ['unresolved-alternative', 'unresolved-alternative'])
  assert.deepEqual(report.unaccounted, [])
})

test('the branch the recorded result selects is taken; the others are not-selected', () => {
  const deps = [{ id: 'dep', slug: 'daily-temperatures', date: '2026-03-07', mode: 'repair' }]
  const { version } = run(
    [day('2026-03-08', [
      { id: 'if-red', priority: 0, when: { op: 'result_is', dependency: 'dep', values: ['red'] }, items: [item('daily-temperatures', 'repair', 'Stack')] },
      { id: 'if-green', priority: 1, when: { op: 'result_is', dependency: 'dep', values: ['green'] }, items: [item('daily-temperatures', 'cold', 'Stack')] },
    ], { dependencies: deps })],
    [{ slug: 'daily-temperatures', date: '2026-03-07', at: '2026-03-07T10:00:00Z', mode: 'repair', result: 'green' }],
  )
  const active = version.revision[0].items[0]
  assert.equal(active.mode, 'cold')
  assert.deepEqual(active.sources, [{ file: 'coaching/days/2026-03-08.json', scenario: 'if-green' }])
  assert.deepEqual(version.migration.excluded.map(e => e.reason), ['not-selected'])
})

test('older than the window and not done is excluded as past-day', () => {
  const { version } = run([
    day('2026-02-20', [{ id: 'main', when: { op: 'always' }, items: [item('two-sum', 'cold', 'Array')] }]),
  ])
  assert.equal(version.revision.length, 0)
  assert.equal(version.migration.excluded[0].reason, 'past-day')
})

test('the newest plan for a problem wins and keeps every mention as a source', () => {
  const { version } = run([
    day('2026-03-05', [{ id: 'a', when: { op: 'always' }, items: [item('daily-temperatures', 'repair', 'Greedy / Stack')] }]),
    day('2026-03-08', [{ id: 'b', when: { op: 'always' }, items: [item('daily-temperatures', 'cold', 'Stack')] }]),
  ])
  assert.equal(version.revision.length, 1)
  const it = version.revision[0].items[0]
  assert.equal(version.revision[0].pattern, 'Stack')
  assert.equal(it.mode, 'cold')
  assert.equal(it.flag, undefined)
  assert.equal(it.sources.length, 2)
})

test('reason is clipped to the schema limit; long text moves to detail', () => {
  const long = 'x '.repeat(200)
  const { version } = run([
    day('2026-03-08', [{ id: 'main', when: { op: 'always' }, items: [item('daily-temperatures', 'cold', 'Stack', { purpose: undefined, why: long })] }]),
  ])
  const it = version.revision[0].items[0]
  assert.ok(it.reason.length <= 140)
  assert.ok(it.detail.length > 140)
  assert.ok(validateWorklist(version).valid)
})
