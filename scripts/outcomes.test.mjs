import test from 'node:test'
import assert from 'node:assert/strict'
import { sealReason, sealOutcome, outcomeDrift, outcomePath } from '../src/utils/outcomes.js'

const decision = {
  version: 1,
  outlookSchemaVersion: 2,
  assessedAt: '2026-09-30T11:55:48Z',
  assessmentDate: '2026-09-30',
  nextThreeDays: [
    {
      date: '2026-10-01',
      dependencies: [{ id: 'nge', slug: 'next-greater-element-ii', date: '2026-09-30', mode: 'cold' }],
      scenarios: [
        { id: 'green-path', priority: 1, when: { op: 'result_is', dependency: 'nge', values: ['green'] }, items: [{ type: 'problem', slug: 'decode-string', title: 'Decode String' }] },
        { id: 'fallback', priority: 2, when: { op: 'always' }, items: [{ type: 'problem', slug: 'next-greater-element-ii', title: 'NGE II' }] },
      ],
    },
    {
      date: '2026-10-05',
      dependencies: [{ id: 'ds', slug: 'decode-string', date: '2026-10-01', mode: 'cold' }],
      scenarios: [{ id: 'later', priority: 1, when: { op: 'always' }, items: [] }],
    },
  ],
}

const attempt = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  slug: 'next-greater-element-ii', date: '2026-09-30', at: '2026-09-30T13:44:53Z',
  mode: 'cold', result: 'green', help: 'none', sessionRepeat: false, timeMinutes: 5,
  ...over,
})

test('an assessment is sealed once something newer replaces it', () => {
  assert.equal(sealReason({ decision, covers: ['2026-10-01'], isLatest: false, today: '2026-09-30' }), 'superseded')
})

test('the current assessment is sealed only once its days are behind us', () => {
  const covers = ['2026-09-30', '2026-10-01']
  assert.equal(sealReason({ decision, covers, isLatest: true, today: '2026-09-30' }), null)
  assert.equal(sealReason({ decision, covers, isLatest: true, today: '2026-10-02' }), 'window elapsed')
})

test('a sealed outcome records which branch the evidence selected', () => {
  const o = sealOutcome({
    decision, assessmentId: '20260930T115548Z', practiceLog: [attempt()],
    sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded', supersededBy: '20260930T135500Z',
  })
  const oct1 = o.days.find(d => d.date === '2026-10-01')
  assert.equal(oct1.branch, 'green-path')
  assert.equal(oct1.resolved, true)
  assert.deepEqual(oct1.dependencies[0], {
    slug: 'next-greater-element-ii', date: '2026-09-30', state: 'known', result: 'green',
  })
  assert.equal(o.supersededBy, '20260930T135500Z')
})

test('a day still in the future when sealed is marked, not scored as unfollowed', () => {
  const o = sealOutcome({
    decision, assessmentId: 'x', practiceLog: [attempt()],
    sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded',
  })
  assert.equal(o.days.find(d => d.date === '2026-10-01').elapsed, true)
  assert.equal(o.days.find(d => d.date === '2026-10-05').elapsed, false)
})

test('a branch the evidence never settled is recorded as unresolved', () => {
  const o = sealOutcome({
    decision, assessmentId: 'x', practiceLog: [],
    sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded',
  })
  const oct1 = o.days.find(d => d.date === '2026-10-01')
  assert.equal(oct1.resolved, false)
  assert.equal(oct1.dependencies[0].state, 'missing')
})

test('the evidence behind a verdict is recorded with it', () => {
  const log = [attempt()]
  const o = sealOutcome({ decision, assessmentId: 'x', practiceLog: log, sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded' })
  assert.equal(o.evidence.attempts, 1)
  assert.equal(o.evidence.lastAttemptAt, '2026-09-30T13:44:53Z')
  assert.equal(outcomeDrift(o, log).drifted, false)
})

test('evidence corrected after sealing shows as drift rather than a new verdict', () => {
  const log = [attempt()]
  const o = sealOutcome({ decision, assessmentId: 'x', practiceLog: log, sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded' })

  // The attempt is deleted afterwards, as a correction would.
  const d = outcomeDrift(o, [])
  assert.equal(d.drifted, true)
  assert.notEqual(d.sealedFingerprint, d.currentFingerprint)
  // The sealed verdict itself is untouched.
  assert.equal(o.days.find(x => x.date === '2026-10-01').branch, 'green-path')
})

test('reordering the log is not drift, since the facts are the same', () => {
  const a = attempt({ slug: 'a' })
  const b = attempt({ slug: 'b', at: '2026-09-30T14:00:00Z' })
  const o = sealOutcome({ decision, assessmentId: 'x', practiceLog: [a, b], sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded' })
  assert.equal(outcomeDrift(o, [b, a]).drifted, false)
})

test('the assessment day is recorded, not only the forecast', () => {
  const withToday = {
    ...decision,
    today: { doNow: { slug: 'next-greater-element-ii', mode: 'cold' }, then: { action: 'Stop for today' } },
  }
  const o = sealOutcome({
    decision: withToday, assessmentId: 'x', practiceLog: [attempt()],
    sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded',
  })
  const own = o.days[0]
  assert.equal(own.date, '2026-09-30')
  assert.equal(own.kind, 'today')
  assert.equal(own.elapsed, true)
  // Stated outright, so there is nothing for evidence to settle.
  assert.equal(own.resolved, true)
  assert.equal(own.branch, null)
  assert.deepEqual(own.items, [{
    slug: 'next-greater-element-ii', type: 'problem', role: 'doNow',
    done: true, askedMode: 'cold', recordedMode: 'cold', recordedResult: 'green',
  }])
})

test('a grade in a different mode than asked is visible, not just done', () => {
  const withToday = {
    ...decision,
    today: { doNow: { slug: 'next-greater-element-ii', mode: 'cold' } },
  }
  const o = sealOutcome({
    decision: withToday, assessmentId: 'x', practiceLog: [attempt({ mode: 'warm' })],
    sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded',
  })
  const item = o.days[0].items[0]
  assert.equal(item.done, true)
  assert.equal(item.askedMode, 'cold')
  assert.equal(item.recordedMode, 'warm')
})

test('a step never recorded is not done', () => {
  const withToday = { ...decision, today: { doNow: { slug: 'gas-station', mode: 'cold' } } }
  const o = sealOutcome({
    decision: withToday, assessmentId: 'x', practiceLog: [attempt()],
    sealedAt: '2026-10-02T09:00:00Z', sealedBecause: 'superseded',
  })
  assert.equal(o.days[0].items[0].done, false)
  assert.equal(o.days[0].items[0].recordedMode, null)
})

test('the outcome path is derived from the assessment id', () => {
  assert.equal(outcomePath('20260930T115548Z'), 'coaching/outcomes/20260930T115548Z.json')
})
