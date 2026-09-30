import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyShards, buildManifest, publishSet, fingerprint } from '../src/utils/publishSet.js'

const data = () => ({
  dsa_problems: JSON.stringify({
    'two-sum': { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', tags: ['Array'], dateSolved: '2026-08-04' },
    'gas-station': { slug: 'gas-station', title: 'Gas Station', difficulty: 'Medium', tags: ['Greedy'], dateSolved: '2026-09-10' },
  }),
  dsa_revisions: JSON.stringify([
    { slug: 'two-sum', date: '2026-09-12' },
    { slug: 'gas-station', date: '2026-09-20' },
  ]),
  dsa_failures: JSON.stringify([
    { slug: 'gas-station', date: '2026-09-10' },
    { slug: 'gas-station', date: '2026-09-10' },
  ]),
  dsa_practice_log: JSON.stringify([
    { id: 'a', slug: 'gas-station', date: '2026-09-20', at: '2026-09-20T10:00:00Z', mode: 'cold', result: 'green', help: 'none', sessionRepeat: false },
  ]),
})

test('evidence is split by the month each fact is dated to', () => {
  const shards = monthlyShards(data())
  assert.deepEqual(shards.map(s => s.month), ['2026-08', '2026-09'])
  assert.equal(shards[0].content.counts.solved, 1)
  assert.deepEqual(shards[1].content.counts, { solved: 1, revised: 2, failed: 2, graded: 1 })
})

test('a shard carries the problems it touches, so it reads on its own', () => {
  const sept = monthlyShards(data()).find(s => s.month === '2026-09')
  // Two Sum was solved in August but revised in September, so September still
  // has to describe it.
  assert.deepEqual(Object.keys(sept.content.problems).sort(), ['gas-station', 'two-sum'])
  assert.equal(sept.content.problems['two-sum'].title, 'Two Sum')
  assert.equal(sept.content.problems['two-sum'].firstSolved, '2026-08-04')
})

test('repeated failures are kept, because the repetition is the count', () => {
  const sept = monthlyShards(data()).find(s => s.month === '2026-09')
  assert.equal(sept.content.failed.length, 2)
  assert.deepEqual([...new Set(sept.content.failed.map(f => f.slug))], ['gas-station'])
})

test('graded attempts are carried whole, notes included', () => {
  const d = data()
  const log = JSON.parse(d.dsa_practice_log)
  log[0].notes = { invariant: 'two pointers', whyHelp: '', clicked: '' }
  d.dsa_practice_log = JSON.stringify(log)
  const sept = monthlyShards(d).find(s => s.month === '2026-09')
  assert.equal(sept.content.graded[0].notes.invariant, 'two pointers')
})

test('the same tracker always produces the same bytes', () => {
  const a = publishSet({ data: data(), savedAt: 'T', repo: 'o/r', codeCommit: 'c' })

  // The same facts, arriving in a different order.
  const d = data()
  d.dsa_revisions = JSON.stringify(JSON.parse(d.dsa_revisions).reverse())
  d.dsa_problems = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(d.dsa_problems)).reverse()))
  const b = publishSet({ data: d, savedAt: 'T', repo: 'o/r', codeCommit: 'c' })

  for (const [path, content] of a) assert.equal(b.get(path), content, path)
})

test('the manifest timestamp follows the tracker, not the clock', () => {
  const m1 = buildManifest({ data: data(), savedAt: '2026-09-30T14:22:46.098Z', shards: [], repo: 'o/r' })
  const m2 = buildManifest({ data: data(), savedAt: '2026-09-30T14:22:46.098Z', shards: [], repo: 'o/r' })
  assert.deepEqual(m1, m2)
  assert.equal(m1.generatedFor, '2026-09-30T14:22:46.098Z')
})

test('the manifest counts eligible cold tests, which decides whether debt exists', () => {
  const d = data()
  const log = JSON.parse(d.dsa_practice_log)
  log.push({ id: 'b', slug: 'two-sum', date: '2026-09-21', at: '2026-09-21T10:00:00Z', mode: 'cold', result: 'green', help: 'hint', sessionRepeat: false })
  log.push({ id: 'c', slug: 'two-sum', date: '2026-09-22', at: '2026-09-22T10:00:00Z', mode: 'warm', result: 'green', help: 'none', sessionRepeat: false })
  d.dsa_practice_log = JSON.stringify(log)
  const m = buildManifest({ data: d, savedAt: 'T', shards: monthlyShards(d), repo: 'o/r' })
  assert.equal(m.evidence.totals.graded, 3)
  assert.equal(m.evidence.totals.eligibleColdTests, 1)
})

test('the manifest states no conclusions of its own', () => {
  const m = buildManifest({ data: data(), savedAt: 'T', shards: monthlyShards(data()), repo: 'o/r' })
  const text = JSON.stringify(m)
  for (const word of ['"mode"', '"debt"', '"health"', 'EXPANSION', 'CONSOLIDATION']) {
    assert.ok(!text.includes(word), `manifest should not interpret: found ${word}`)
  }
})

test('each shard is fingerprinted, so an unchanged month need not be fetched', () => {
  const shards = monthlyShards(data())
  const m = buildManifest({ data: data(), savedAt: 'T', shards, repo: 'o/r' })
  const sept = m.evidence.shards.find(s => s.month === '2026-09')
  assert.equal(sept.fingerprint, fingerprint(shards.find(s => s.month === '2026-09').content))
})

test('a publish covers every month plus the manifest', () => {
  const files = publishSet({ data: data(), savedAt: 'T', repo: 'o/r', codeCommit: 'c' })
  assert.deepEqual([...files.keys()].sort(), ['evidence/2026-08.json', 'evidence/2026-09.json', 'manifest.json'])
})

test('an empty tracker publishes a manifest and no shards', () => {
  const files = publishSet({ data: {}, savedAt: 'T', repo: 'o/r' })
  assert.deepEqual([...files.keys()], ['manifest.json'])
  assert.equal(JSON.parse(files.get('manifest.json')).evidence.coverage, null)
})

test('malformed tracker keys are treated as absent rather than throwing', () => {
  const files = publishSet({ data: { dsa_problems: 'not json', dsa_revisions: '[' }, savedAt: 'T', repo: 'o/r' })
  assert.equal(JSON.parse(files.get('manifest.json')).evidence.totals.solved, 0)
})
