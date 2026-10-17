import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  validateWorklist,
  validateWorklistManifest,
  worklistCommitProblems,
  worklistHash,
} from '../src/utils/validateWorklist.js'
import {
  idFromWrittenAt,
  versionNumber,
  flattenItems,
  itemMode,
  attemptsSince,
  latestAttemptBySlug,
  diffWorklists,
  changesByList,
  sheetName,
  roadmapLayers,
  countsByPattern,
} from '../src/utils/worklist.js'

const fixture = n => JSON.parse(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)))
const current = fixture('worklist.example.json')
const migrated = fixture('worklist.migrated.example.json')
const manifest = fixture('worklist-manifest.example.json')
const clone = v => JSON.parse(JSON.stringify(v))

/* ---------- Contract ---------- */

test('published fixtures validate', () => {
  for (const [name, w] of [['current', current], ['migrated', migrated]]) {
    const { valid, errors } = validateWorklist(w)
    assert.ok(valid, `${name}: ${errors.join('; ')}`)
  }
  const m = validateWorklistManifest(manifest)
  assert.ok(m.valid, m.errors.join('; '))
})

test('a non-object is rejected', () => {
  for (const bad of [null, undefined, 'x', 1, []]) {
    assert.equal(validateWorklist(bad).valid, false)
    assert.equal(validateWorklistManifest(bad).valid, false)
  }
})

test('id must match writtenAt', () => {
  const w = clone(current)
  w.id = '20260302T090001Z'
  assert.match(validateWorklist(w).errors.join(' '), /does not match writtenAt/)
})

test('a problem cannot be in both lists', () => {
  const w = clone(current)
  w.new[0].items.push({ ...w.revision[0].items[0] })
  assert.match(validateWorklist(w).errors.join(' '), /in both new and revision/)
})

test('a problem cannot repeat inside a list, and patterns cannot repeat', () => {
  const w = clone(current)
  w.revision[1].items.push({ ...w.revision[1].items[0] })
  w.revision.push({ ...w.revision[0] })
  const errs = validateWorklist(w).errors.join(' ')
  assert.match(errs, /appears more than once/)
  assert.match(errs, /pattern "Monotonic Stack" appears twice/)
})

test('an empty pattern group and unknown fields are rejected', () => {
  const w = clone(current)
  w.new[0].items = []
  w.revision[0].items[0].priority = 1
  assert.equal(validateWorklist(w).valid, false)
})

test('both lists may be empty', () => {
  const w = clone(current)
  w.new = []
  w.revision = []
  delete w.changes
  assert.ok(validateWorklist(w).valid)
})

test('manifest: latest must be listed, ids ordered, paths derived from ids', () => {
  const m = clone(manifest)
  m.latest = '20990101T000000Z'
  m.versions.reverse()
  m.versions[0].path = 'coaching/worklists/other.json'
  const errs = validateWorklistManifest(m).errors.join(' ')
  assert.match(errs, /latest .* is not in versions/)
  assert.match(errs, /oldest first/)
})

test('commit check: only coaching/worklists/, and published versions are never touched', () => {
  assert.deepEqual(worklistCommitProblems([
    { filename: 'coaching/worklists/20260302T090000Z.json', status: 'added' },
    { filename: 'coaching/worklists/manifest.json', status: 'modified' },
  ]), [])

  const problems = worklistCommitProblems([
    { filename: 'tracker-data.json', status: 'modified' },
    { filename: 'coaching/worklists/20260227T183000Z.json', status: 'modified' },
    { filename: 'coaching/worklists/20260101T000000Z.json', status: 'removed' },
  ])
  assert.equal(problems.length, 3)
  assert.match(problems[0], /outside coaching\/worklists/)
  assert.match(problems[1], /Changed the published version/)
  assert.match(problems[2], /Deleted the published version/)
})

test('hash ignores key order and whitespace but not item order', () => {
  const reverseKeys = v => Array.isArray(v)
    ? v.map(reverseKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reverseKeys(v[k])]))
      : v
  const reordered = reverseKeys(current)
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(current))
  assert.equal(worklistHash(reordered), worklistHash(current))

  const swapped = clone(current)
  swapped.new[0].items.reverse()
  assert.notEqual(worklistHash(swapped), worklistHash(current))
})

/* ---------- Rendering helpers ---------- */

test('ids derive from writtenAt; version numbers from manifest order', () => {
  assert.equal(idFromWrittenAt('2026-10-17T21:20:00Z'), '20261017T212000Z')
  assert.equal(idFromWrittenAt('2026-10-17T21:20:00.123Z'), '20261017T212000Z')
  assert.equal(idFromWrittenAt('2026-10-17'), null)
  assert.equal(versionNumber(manifest, '20260302T090000Z'), 2)
  assert.equal(versionNumber(manifest, 'nope'), null)
})

test('items flatten with their list and pattern; mode defaults by list', () => {
  const items = flattenItems(current)
  assert.equal(items.length, 5)
  assert.deepEqual(items[0], { ...current.new[0].items[0], list: 'new', pattern: 'Intervals' })
  assert.equal(itemMode(items[0], 'new'), 'learn')
  assert.equal(itemMode(items[3], 'revision'), 'cold')
  assert.equal(itemMode(items[2], 'revision'), 'repair')
})

test('only attempts after what the coach read count as new', () => {
  const log = [
    { slug: 'daily-temperatures', date: '2026-03-01', at: '2026-03-01T20:15:00Z', result: 'red' },
    { slug: 'daily-temperatures', date: '2026-03-02', at: '2026-03-02T10:00:00Z', result: 'yellow' },
    { slug: 'merge-intervals', date: '2026-03-02', at: '2026-03-02T11:00:00Z', result: 'green' },
  ]
  const since = attemptsSince(current, log)
  assert.deepEqual(since.map(e => e.slug), ['merge-intervals', 'daily-temperatures'])
  assert.equal(latestAttemptBySlug(current, log).get('daily-temperatures').result, 'yellow')
})

test('diff finds every change itself and borrows the coach reasons', () => {
  const d = diffWorklists(migrated, current)
  assert.deepEqual(d.added.map(i => i.slug).sort(), ['insert-interval', 'merge-intervals', 'next-greater-element-ii'])
  assert.deepEqual(d.removed.map(i => i.slug), ['two-sum-ii-input-array-is-sorted'])
  assert.equal(d.removed[0].reason, 'Cold Green Mar 1.')
  assert.deepEqual(d.modified.map(i => i.slug).sort(), ['daily-temperatures', 'longest-substring-without-repeating-characters'])
  assert.ok(d.modified.find(i => i.slug === 'daily-temperatures').fields.includes('flag'))
  assert.deepEqual(d.counts.revision, { before: 3, after: 3 })
  assert.deepEqual(d.counts.new, { before: 0, after: 2 })
  assert.equal(d.total, 6)
})

test('a change the coach did not mention is still reported', () => {
  const next = clone(current)
  delete next.changes
  next.revision[1].items[0].minutes = 40
  const d = diffWorklists(current, next)
  assert.equal(d.total, 1)
  assert.deepEqual(d.modified[0].fields, ['minutes'])
})

test('moving between lists is a move, grouped under the destination', () => {
  const next = clone(current)
  const item = next.new[0].items.shift()
  next.revision.push({ pattern: 'Intervals', items: [item] })
  const d = diffWorklists(current, next)
  assert.equal(d.moved.length, 1)
  assert.equal(d.moved[0].from, 'new')
  const grouped = changesByList(d)
  assert.equal(grouped.revision[0].op, 'moved')
  assert.equal(grouped.new.length, 0)
})

/* ---------- Sheets: name, summary, roadmap ---------- */

test('roadmap: unknown links, duplicates and cycles are rejected', () => {
  const w = clone(current)
  w.roadmap.push({ pattern: 'Trees', after: ['Graphs'] })
  w.roadmap.push({ pattern: 'Intervals' })
  const errs = validateWorklist(w).errors.join(' ')
  assert.match(errs, /"Trees" comes after "Graphs", which is not in the roadmap/)
  assert.match(errs, /"Intervals" appears twice/)

  const cyc = clone(current)
  cyc.roadmap[0].after = ['Heap / Priority Queue']
  assert.match(validateWorklist(cyc).errors.join(' '), /form a cycle/)
})

test('roadmap: every pattern on the lists must be on the roadmap', () => {
  const w = clone(current)
  w.roadmap = w.roadmap.filter(n => n.pattern !== 'Sliding Window')
  w.roadmap.find(n => n.pattern === 'Intervals').after = ['Two Pointers']
  assert.match(validateWorklist(w).errors.join(' '), /revision: pattern "Sliding Window" is not in the roadmap/)
})

test('a sheet without a roadmap, name or summary is still valid', () => {
  assert.ok(validateWorklist(migrated).valid)
  assert.equal(sheetName(migrated, 1), 'Sheet 1')
  assert.equal(sheetName(current, 2), 'Stack repair, then Intervals')
})

test('roadmap layers place a pattern below the deepest pattern it builds on', () => {
  const rows = roadmapLayers(current.roadmap).map(r => r.map(n => n.pattern))
  assert.deepEqual(rows, [
    ['Arrays & Hashing'],
    ['Two Pointers', 'Monotonic Stack'],
    ['Sliding Window', 'Intervals'],
    ['Heap / Priority Queue'],
  ])
})

test('roadmap layers order a row by where its parents sit', () => {
  const rows = roadmapLayers([
    { pattern: 'A' },
    { pattern: 'B' },
    { pattern: 'under B', after: ['B'] },
    { pattern: 'under A', after: ['A'] },
  ]).map(r => r.map(n => n.pattern))
  assert.deepEqual(rows, [['A', 'B'], ['under A', 'under B']])
})

test('counts per pattern span both lists', () => {
  const c = countsByPattern(current)
  assert.deepEqual(c.get('Monotonic Stack'), { new: 0, revision: 2 })
  assert.deepEqual(c.get('Intervals'), { new: 2, revision: 0 })
})

test('diff from nothing lists everything as added', () => {
  const d = diffWorklists(null, current)
  assert.equal(d.added.length, 5)
  assert.equal(d.removed.length, 0)
})
