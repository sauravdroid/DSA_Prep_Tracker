import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isoWeek, isoWeekRange, monthOf, monthRange, weekPath, monthPath,
  dayReport, rollup, rollupsFor,
} from '../src/utils/rollups.js'

const authored = { assessment: '20260930T120000Z', at: '2026-09-30T12:00:00.000Z' }

const day = (date, items, over = {}) => ({
  dayVersion: 1,
  date,
  authoredBy: authored,
  scenarios: [{ id: 'main', priority: 0, when: { op: 'always' }, items }],
  ...over,
})

const problem = (slug, over = {}) => ({ type: 'problem', slug, title: slug, kind: 'cold', minutes: 25, ...over })

const attempt = (slug, date, over = {}) => ({
  slug, date, mode: 'cold', result: 'green', help: 'none', sessionRepeat: false, ...over,
})

/* ---------- Periods ---------- */

test('a week runs Monday to Sunday', () => {
  // 2026-10-01 is a Thursday.
  assert.equal(isoWeek('2026-10-01'), isoWeek('2026-09-28'), 'Monday of the same week')
  assert.equal(isoWeek('2026-10-01'), isoWeek('2026-10-04'), 'and its Sunday')
  assert.notEqual(isoWeek('2026-10-04'), isoWeek('2026-10-05'), 'Monday starts a new one')
})

test('a week belongs to the year that owns it, not the one it starts in', () => {
  // 2026-12-31 is a Thursday, so its week is 2026's last even though it runs
  // into January.
  assert.equal(isoWeek('2027-01-01'), isoWeek('2026-12-31'))
})

test('a week id round-trips to the days it covers', () => {
  const { from, to } = isoWeekRange(isoWeek('2026-10-01'))
  assert.equal(from, '2026-09-28')
  assert.equal(to, '2026-10-04')
})

test('a month id round-trips, including a short one', () => {
  assert.equal(monthOf('2026-10-01'), '2026-10')
  assert.deepEqual(monthRange('2026-10'), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' })
})

test('a period is found by its id alone', () => {
  assert.equal(weekPath('2026-W40'), 'coaching/weeks/2026-W40.json')
  assert.equal(monthPath('2026-10'), 'coaching/months/2026-10.json')
})

/* ---------- A day ---------- */

test('a day reports what it asked for and what was recorded', () => {
  const d = day('2026-10-01', [problem('cousins-in-binary-tree'), problem('jump-game-ii')])
  const r = dayReport(d, { practiceLog: [attempt('cousins-in-binary-tree', '2026-10-01')], today: '2026-10-02' })
  assert.deepEqual(r.asked, ['cousins-in-binary-tree', 'jump-game-ii'])
  assert.deepEqual(r.done, ['cousins-in-binary-tree'])
  assert.deepEqual(r.verdict, ['green'])
  assert.equal(r.branch, 'main')
  assert.equal(r.elapsed, true)
})

test('work the day never asked for is reported apart, not as a failure', () => {
  const d = day('2026-10-01', [problem('cousins-in-binary-tree')])
  const log = [attempt('cousins-in-binary-tree', '2026-10-01'), attempt('two-sum', '2026-10-01')]
  const r = dayReport(d, { practiceLog: log, today: '2026-10-02' })
  assert.deepEqual(r.unplanned, ['two-sum'])
  assert.deepEqual(r.done, ['cousins-in-binary-tree'])
})

test('an action is neither asked for nor done, since nothing records it', () => {
  const d = day('2026-10-01', [problem('cousins-in-binary-tree'), { type: 'action', title: 'Stop for today' }])
  const r = dayReport(d, { practiceLog: [attempt('cousins-in-binary-tree', '2026-10-01')], today: '2026-10-02' })
  assert.deepEqual(r.asked, ['cousins-in-binary-tree'])
  assert.deepEqual(r.done, ['cousins-in-binary-tree'])
})

test('a day still ahead has not elapsed, whatever it asked for', () => {
  const d = day('2026-10-05', [problem('two-sum')])
  assert.equal(dayReport(d, { practiceLog: [], today: '2026-10-01' }).elapsed, false)
})

/* ---------- A period ---------- */

const week = [
  day('2026-09-28', [problem('a')]),
  day('2026-09-29', [problem('b')]),
  day('2026-10-04', [problem('c')]),
  day('2026-10-05', [problem('d')]),
]

test('a rollup holds only the days inside it', () => {
  const r = rollup({ kind: 'week', id: '2026-W40', ...isoWeekRange('2026-W40') }, week, { today: '2026-10-10' })
  assert.deepEqual(r.days.map(d => d.date), ['2026-09-28', '2026-09-29', '2026-10-04'])
  assert.equal(r.totals.planned, 3)
})

test('totals count only days that have elapsed', () => {
  // Monday and Tuesday are past; Sunday is not.
  const r = rollup({ kind: 'week', id: '2026-W40', ...isoWeekRange('2026-W40') }, week, {
    practiceLog: [attempt('a', '2026-09-28')],
    today: '2026-09-30',
  })
  assert.equal(r.totals.elapsed, 2)
  assert.equal(r.totals.asked, 2, 'a and b, not c')
  assert.equal(r.totals.done, 1)
})

test('a period still running is not sealed, so its totals are not a verdict', () => {
  const open = rollup({ kind: 'week', id: '2026-W40', ...isoWeekRange('2026-W40') }, week, { today: '2026-09-30' })
  const over = rollup({ kind: 'week', id: '2026-W40', ...isoWeekRange('2026-W40') }, week, { today: '2026-10-10' })
  assert.equal(open.sealed, false)
  assert.equal(over.sealed, true)
})

test('a period verdict is every grade its elapsed days recorded, worst first', () => {
  const r = rollup({ kind: 'week', id: '2026-W40', ...isoWeekRange('2026-W40') }, week, {
    practiceLog: [attempt('a', '2026-09-28', { result: 'green' }), attempt('b', '2026-09-29', { result: 'red' })],
    today: '2026-10-10',
  })
  assert.deepEqual(r.totals.verdict, ['red', 'green'])
})

test('a period with no days is empty rather than absent', () => {
  const r = rollup({ kind: 'month', id: '2025-01', ...monthRange('2025-01') }, week, { today: '2026-10-10' })
  assert.deepEqual(r.days, [])
  assert.deepEqual(r.totals.verdict, [])
})

test('every week and month the days touch gets a file, once each', () => {
  const out = rollupsFor(week, { today: '2026-10-10' })
  assert.deepEqual(out.map(o => o.path), [
    'coaching/weeks/2026-W40.json',
    'coaching/weeks/2026-W41.json',
    'coaching/months/2026-09.json',
    'coaching/months/2026-10.json',
  ])
})
