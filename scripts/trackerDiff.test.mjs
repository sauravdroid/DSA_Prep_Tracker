import test from 'node:test'
import assert from 'node:assert/strict'
import { sameFacts, unpublishedKeys } from '../src/utils/trackerDiff.js'

const json = v => JSON.stringify(v)

test('identical bytes hold the same facts', () => {
  assert.equal(sameFacts(json([1, 2]), json([1, 2])), true)
})

test('a reordered array is not unpublished work', () => {
  // The case that misfired: same 314 revisions, different sequence.
  const a = json([{ slug: 'rotting-oranges', date: '2026-05-08' }, { slug: 'longest-common-subsequence', date: '2026-05-08' }])
  const b = json([{ slug: 'longest-common-subsequence', date: '2026-05-08' }, { slug: 'rotting-oranges', date: '2026-05-08' }])
  assert.notEqual(a, b)
  assert.equal(sameFacts(a, b), true)
})

test('reordered object keys are not unpublished work', () => {
  const a = json({ 'edit-distance': { n: 1 }, 'non-overlapping-intervals': { n: 2 } })
  const b = json({ 'non-overlapping-intervals': { n: 2 }, 'edit-distance': { n: 1 } })
  assert.notEqual(a, b)
  assert.equal(sameFacts(a, b), true)
})

test('nested reordering is seen through', () => {
  const a = json({ Stack: { core: ['a', 'b'], extra: ['c'] } })
  const b = json({ Stack: { extra: ['c'], core: ['b', 'a'] } })
  assert.equal(sameFacts(a, b), true)
})

test('a changed field is still a difference', () => {
  const a = json([{ slug: 'two-sum', date: '2026-05-08' }])
  const b = json([{ slug: 'two-sum', date: '2026-05-09' }])
  assert.equal(sameFacts(a, b), false)
})

test('an added member is still a difference', () => {
  assert.equal(sameFacts(json([1, 2]), json([1, 2, 3])), false)
})

test('a repeated member is not hidden by sorting', () => {
  assert.equal(sameFacts(json([1, 1, 2]), json([1, 2, 2])), false)
})

test('plain strings compare by value, since the bytes are the fact', () => {
  assert.equal(sameFacts('2026-09-30', '2026-09-30'), true)
  assert.equal(sameFacts('2026-09-30', '2026-10-01'), false)
})

test('keys absent from the remote are reported as unpublished', () => {
  const { missing, changed } = unpublishedKeys(
    { dsa_problems: json({ a: 1 }), dsa_notes: json({}) },
    { dsa_problems: json({ a: 1 }) }
  )
  assert.deepEqual(missing, ['dsa_notes'])
  assert.deepEqual(changed, [])
})

test('a reordered snapshot reports nothing to publish', () => {
  const { missing, changed } = unpublishedKeys(
    { dsa_revisions: json([{ s: 'a' }, { s: 'b' }]), dsa_meta: json({ version: 3 }) },
    { dsa_revisions: json([{ s: 'b' }, { s: 'a' }]), dsa_meta: json({ version: 3 }) }
  )
  assert.deepEqual(missing, [])
  assert.deepEqual(changed, [])
})

test('real divergence is still reported', () => {
  const { changed } = unpublishedKeys(
    { dsa_practice_log: json([{ slug: 'x', result: 'green' }]) },
    { dsa_practice_log: json([{ slug: 'x', result: 'red' }]) }
  )
  assert.deepEqual(changed, ['dsa_practice_log'])
})
