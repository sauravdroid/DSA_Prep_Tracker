import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { sealOutcome, summariseOutcome } from '../src/utils/outcomes.js'
import { summarise, buildIndex } from '../src/utils/assessments.js'

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const outcomeSchema = ajv.compile(JSON.parse(fs.readFileSync('schemas/coaching-outcome.schema.json', 'utf8')))

const decision = {
  version: 1,
  assessedAt: '2026-09-30T11:55:48Z',
  assessmentDate: '2026-09-30',
  mode: { key: 'MIXED', headline: 'one Stack baseline' },
  nextThreeDays: [
    {
      date: '2026-10-01',
      dependencies: [{ id: 'nge', slug: 'next-greater-element-ii', date: '2026-09-30', mode: 'cold' }],
      scenarios: [
        { id: 'green-path', priority: 1, when: { op: 'result_is', dependency: 'nge', values: ['green'] }, items: [] },
        { id: 'fallback', priority: 2, when: { op: 'always' }, items: [] },
      ],
    },
  ],
}
const log = [{
  id: 'a', slug: 'next-greater-element-ii', date: '2026-09-30', at: '2026-09-30T13:44:53Z',
  mode: 'cold', result: 'green', help: 'none', sessionRepeat: false,
}]
const sealed = () => sealOutcome({
  decision, assessmentId: '20260930T115548Z', practiceLog: log,
  sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded', supersededBy: '20260930T135500Z',
})

test('a sealed outcome matches its published schema', () => {
  assert.ok(outcomeSchema(sealed()), JSON.stringify(outcomeSchema.errors))
})

test('the index summary says how a forecast turned out without the file', () => {
  const s = summariseOutcome(sealed())
  assert.equal(s.file, 'coaching/outcomes/20260930T115548Z.json')
  assert.equal(s.sealedBecause, 'superseded')
  assert.equal(s.supersededBy, '20260930T135500Z')
  // The assessment's own day plus its one forecast day.
  assert.equal(s.days, 2)
  assert.equal(s.daysResolved, 2)
  // Only conditional days have a branch, so today is not listed here.
  assert.deepEqual(s.branches, { '2026-10-01': 'green-path' })
  assert.ok(s.evidenceFingerprint)
})

test('a live assessment carries a null outcome, not a failed one', () => {
  const index = buildIndex([
    summarise(decision, { outcome: null }),
  ])
  assert.equal(index.assessments[0].outcome, null)
  assert.equal(index.sealed, 0)
  assert.match(index.note, /still live, not that the forecast failed/)
})

test('the index counts how many assessments are sealed', () => {
  const other = { ...decision, assessedAt: '2026-09-30T13:55:00Z' }
  const index = buildIndex([
    summarise(other, { outcome: null }),
    summarise(decision, { outcome: summariseOutcome(sealed()) }),
  ])
  assert.equal(index.count, 2)
  assert.equal(index.sealed, 1)
  assert.equal(index.assessments[0].outcome, null, 'newest is still live')
  assert.equal(index.assessments[1].outcome.daysResolved, 2)
})

test('summarising nothing yields nothing rather than an empty verdict', () => {
  assert.equal(summariseOutcome(null), null)
})
