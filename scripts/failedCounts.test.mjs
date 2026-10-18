import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileFailedCounts } from '../src/utils/failedCounts.js'
import { mergeTrackerData } from '../src/utils/mergeData.js'

const fail = (slug, ts) => ({ slug, ts, date: '2026-10-18' })

test('a stale count rises to the failure log total', () => {
  const problems = { 'subsets-ii': { slug: 'subsets-ii', failedCount: 1 } }
  const log = [1, 2, 3, 4, 5, 6].map(ts => fail('subsets-ii', ts))
  assert.equal(reconcileFailedCounts(problems, log)['subsets-ii'].failedCount, 6)
})

test('a problem with no stored count picks up its logged failures', () => {
  const problems = { 'jump-game-ii': { slug: 'jump-game-ii' } }
  const out = reconcileFailedCounts(problems, [fail('jump-game-ii', 1), fail('jump-game-ii', 2)])
  assert.equal(out['jump-game-ii'].failedCount, 2)
})

test('a count larger than the log is never lowered', () => {
  const problems = { a: { slug: 'a', failedCount: 9 } }
  const out = reconcileFailedCounts(problems, [fail('a', 1)])
  assert.equal(out, problems)
  assert.equal(out.a.failedCount, 9)
})

test('nothing changed returns the same object, and inputs are not mutated', () => {
  const problems = { a: { slug: 'a', failedCount: 1 }, b: { slug: 'b', failedCount: 0 } }
  assert.equal(reconcileFailedCounts(problems, [fail('a', 1)]), problems)
  const out = reconcileFailedCounts(problems, [fail('b', 1)])
  assert.notEqual(out, problems)
  assert.equal(problems.b.failedCount, 0)
  assert.equal(out.b.failedCount, 1)
})

test('failures for untracked problems are ignored', () => {
  const problems = { a: { slug: 'a', failedCount: 0 } }
  const out = reconcileFailedCounts(problems, [fail('never-solved', 1)])
  assert.equal(out, problems)
  assert.equal(out['never-solved'], undefined)
})

test('merging tracker data reconciles counts against the merged failure log', () => {
  const local = {
    dsa_problems: JSON.stringify({ a: { slug: 'a', failedCount: 1 } }),
    dsa_failures: JSON.stringify([fail('a', 1)]),
  }
  const remote = {
    dsa_problems: JSON.stringify({ a: { slug: 'a', failedCount: 1 } }),
    dsa_failures: JSON.stringify([fail('a', 2), fail('a', 3)]),
  }
  const { merged } = mergeTrackerData(local, remote)
  assert.equal(JSON.parse(merged.dsa_problems).a.failedCount, 3)
})
