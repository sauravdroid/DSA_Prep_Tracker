import test from 'node:test'
import assert from 'node:assert/strict'
import { assessmentId, coveredDates, summarise, buildIndex, assessmentInForce } from '../src/utils/assessments.js'

// Modelled on the two assessments actually published on 2026-09-30.
const morning = {
  assessedAt: '2026-09-30T11:55:48Z',
  assessmentDate: '2026-09-30',
  mode: { key: 'MIXED', headline: 'Mixed (provisional) — one Stack baseline' },
  debt: { calculable: false, score: null },
  today: { doNow: { slug: 'next-greater-element-ii' } },
  nextThreeDays: [{ date: '2026-10-01' }, { date: '2026-10-02' }, { date: '2026-10-03' }],
}
const afternoon = {
  assessedAt: '2026-09-30T13:55:00Z',
  assessmentDate: '2026-09-30',
  mode: { key: 'MIXED', headline: 'Mixed (provisional) — Greedy learning + one retention slot' },
  debt: { calculable: true, score: 0 },
  today: { then: { action: 'Stop for today' } },
  nextThreeDays: [{ date: '2026-10-01' }, { date: '2026-10-02' }, { date: '2026-10-03' }],
}

test('the id is the assessment timestamp, filename-safe and chronological', () => {
  assert.equal(assessmentId('2026-09-30T13:55:00Z'), '20260930T135500Z')
  assert.ok(assessmentId(morning.assessedAt) < assessmentId(afternoon.assessedAt))
  assert.equal(assessmentId(null), null)
})

test('an assessment covers its own day and every forecast day', () => {
  assert.deepEqual(coveredDates(morning), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
})

test('the summary carries enough to skip fetching the file', () => {
  const s = summarise(afternoon, { commit: 'ffa4995', bytes: 19014 })
  assert.equal(s.file, 'coaching/assessments/20260930T135500Z.json')
  assert.equal(s.mode, 'MIXED')
  assert.equal(s.debtCalculable, true)
  assert.equal(s.sourceCommit, 'ffa4995')
  assert.match(s.headline, /Greedy learning/)
})

test('the index is newest first and lists every assessment per date', () => {
  const index = buildIndex([summarise(morning), summarise(afternoon)])
  assert.equal(index.count, 2)
  assert.equal(index.latest, '20260930T135500Z')
  assert.equal(index.coversThrough, '2026-10-03')
  assert.deepEqual(index.byDate['2026-10-02'], ['20260930T135500Z', '20260930T115548Z'])
})

test('a superseded assessment is still reachable', () => {
  const index = buildIndex([summarise(morning), summarise(afternoon)])
  const ids = index.assessments.map(a => a.id)
  assert.ok(ids.includes('20260930T115548Z'), 'the replaced morning plan must survive')
})

test('what was in force on a day is not simply the newest that covers it', () => {
  // Written on Oct 1, but also speaking to Sep 30.
  const later = {
    assessedAt: '2026-10-01T09:00:00Z',
    assessmentDate: '2026-10-01',
    mode: { key: 'EXPANSION', headline: 'Written the next day' },
    nextThreeDays: [{ date: '2026-09-30' }],
  }
  const index = buildIndex([summarise(morning), summarise(afternoon), summarise(later)])

  assert.equal(index.assessments[0].id, assessmentId(later.assessedAt))
  // Sep 30 was governed by the afternoon plan, not by one written on Oct 1.
  assert.equal(assessmentInForce(index, '2026-09-30').id, '20260930T135500Z')
})

test('entries without a timestamp are dropped rather than given a made-up id', () => {
  const index = buildIndex([summarise({ assessmentDate: '2026-09-30' }), summarise(afternoon)])
  assert.equal(index.count, 1)
})

test('an empty archive is stated rather than implied', () => {
  const index = buildIndex([])
  assert.equal(index.count, 0)
  assert.equal(index.latest, null)
  assert.deepEqual(index.byDate, {})
  assert.deepEqual(index.days, { count: 0, from: null, to: null, drifted: [], entries: {} })
})

test('one index answers both questions, so orienting costs one read', () => {
  const day = {
    dayVersion: 1,
    date: '2026-10-02',
    authoredBy: { assessment: '20260930T135500Z' },
    scenarios: [{ id: 'main', when: { op: 'always' }, items: [{ type: 'problem', slug: 'jump-game-ii' }] }],
  }
  const index = buildIndex([summarise(afternoon)], [day])
  assert.equal(index.assessments[0].id, '20260930T135500Z', 'the run that reasoned')
  assert.equal(index.days.entries['2026-10-02'].file, 'coaching/days/2026-10-02.json', 'the plan it wrote')
  assert.equal(index.days.entries['2026-10-02'].authoredBy.assessment, '20260930T135500Z')
})
