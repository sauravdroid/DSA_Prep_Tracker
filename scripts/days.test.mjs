import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  dayPath, authoredKey, dependsOn, driftedFrom, plannedSlugs,
  rewriteKeepsRecordedWork, buildDayIndex, dayEntry, linkDays,
  decisionToDays, daysFromDecisions,
} from '../src/utils/days.js'

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)))

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
ajv.addSchema(load('../schemas/coaching-decision.schema.json'))
const validate = ajv.compile(load('../schemas/coaching-day.schema.json'))
const errors = () => ajv.errorsText(validate.errors, { separator: '\n  ' })

/** Synthetic. Shaped like a real day, with nothing of anyone's history in it. */
const day = (over = {}) => ({
  dayVersion: 1,
  date: '2026-10-03',
  authoredBy: { assessment: '20261001T115245Z', at: '2026-10-01T11:52:45Z' },
  dependencies: [
    { id: 'jump-oct2', slug: 'jump-game-ii', title: 'Jump Game II', date: '2026-10-02', mode: 'cold' },
  ],
  scenarios: [{
    id: 'repair',
    priority: 0,
    when: { op: 'result_is', dependency: 'jump-oct2', values: ['red'] },
    items: [
      { type: 'problem', slug: 'jump-game-ii', title: 'Jump Game II', kind: 'repair', minutes: 25 },
      { type: 'action', title: 'Weekly review' },
    ],
  }, {
    id: 'carry-on',
    priority: 1,
    when: { op: 'result_is', dependency: 'jump-oct2', values: ['green', 'yellow'] },
    items: [
      { type: 'problem', slug: 'partition-labels', title: 'Partition Labels', kind: 'learn', minutes: 25 },
      { type: 'problem', slug: 'decode-string', title: 'Decode String', kind: 'warm', minutes: 15 },
    ],
  }],
  ...over,
})

const friday = (over = {}) => ({
  dayVersion: 1,
  date: '2026-10-02',
  authoredBy: { assessment: '20261001T115245Z', at: '2026-10-01T11:52:45Z' },
  scenarios: [{
    id: 'main',
    priority: 0,
    when: { op: 'always' },
    items: [{ type: 'problem', slug: 'jump-game-ii', title: 'Jump Game II', kind: 'cold', minutes: 25 }],
  }],
  ...over,
})

/* ---------- The contract ---------- */

test('a day validates against the published schema', () => {
  assert.ok(validate(day()), `\n  ${errors()}`)
})

test('a day must say which run wrote it, since drift is read from that', () => {
  const { authoredBy, ...orphan } = day()
  assert.equal(validate(orphan), false)
})

test('a day must plan something', () => {
  assert.equal(validate(day({ scenarios: [] })), false)
})

test('the reasoning stays in the assessment and is refused here', () => {
  // mode, debt, trackerSnapshot and provenance belong to the run, not the day.
  assert.equal(validate(day({ mode: { key: 'MIXED', headline: 'Mixed' } })), false)
  assert.equal(validate(day({ nextThreeDays: [] })), false, 'a day does not contain other days')
})

test('a path is the date, so a day is found without consulting an index', () => {
  assert.equal(dayPath('2026-10-02'), 'coaching/days/2026-10-02.json')
})

/* ---------- Dependencies ---------- */

test('a day depends on the dates its measurements fall on', () => {
  assert.deepEqual(dependsOn(day()), ['2026-10-02'])
})

test('a day does not depend on itself', () => {
  const sameDay = day({
    dependencies: [{ id: 'self', slug: 'jump-game-ii', date: '2026-10-03', mode: 'cold' }],
  })
  assert.deepEqual(dependsOn(sameDay), [])
})

test('a day with no dependencies waits on nothing', () => {
  assert.deepEqual(dependsOn(friday()), [])
})

/* ---------- Drift ---------- */

test('a day whose source was rewritten afterwards has drifted', () => {
  const rewritten = friday({ authoredBy: { assessment: '20261002T090000Z' } })
  assert.deepEqual(driftedFrom(day(), { '2026-10-02': rewritten }), ['2026-10-02'])
})

test('days written by one run have not drifted, whatever the clock says', () => {
  // Same assessment, a second apart. Comparing file timestamps would call this
  // drift; comparing the run that wrote them does not.
  const sameRun = friday({ authoredBy: { assessment: '20261001T115245Z', at: '2026-10-01T11:52:46Z' } })
  assert.deepEqual(driftedFrom(day(), { '2026-10-02': sameRun }), [])
})

test('a source written before the day that reasons about it has not drifted', () => {
  const older = friday({ authoredBy: { assessment: '20260930T171313Z' } })
  assert.deepEqual(driftedFrom(day(), { '2026-10-02': older }), [])
})

test('a missing source is not drift, because nothing has changed under it', () => {
  // It is unresolvable once the date passes, which is a different report.
  assert.deepEqual(driftedFrom(day(), {}), [])
})

/* ---------- Rewriting a day ---------- */

test('every problem any branch plans is counted as planned', () => {
  assert.deepEqual(plannedSlugs(day()), ['decode-string', 'jump-game-ii', 'partition-labels'])
})

test('a day stays open to rewriting while nothing is recorded against it', () => {
  const next = friday({ scenarios: [{ id: 'main', when: { op: 'always' }, items: [
    { type: 'problem', slug: 'gas-station', title: 'Gas Station', kind: 'learn' },
  ] }] })
  assert.deepEqual(rewriteKeepsRecordedWork(friday(), next, []), { ok: true, dropped: [] })
})

test('a rewrite may not drop a problem already graded for that day', () => {
  const next = friday({ scenarios: [{ id: 'main', when: { op: 'always' }, items: [
    { type: 'problem', slug: 'gas-station', title: 'Gas Station', kind: 'learn' },
  ] }] })
  const log = [{ slug: 'jump-game-ii', date: '2026-10-02', result: 'red' }]
  assert.deepEqual(rewriteKeepsRecordedWork(friday(), next, log), {
    ok: false,
    dropped: ['jump-game-ii'],
  })
})

test('a rewrite may add to a day that has work recorded against it', () => {
  const next = friday({ scenarios: [{ id: 'main', when: { op: 'always' }, items: [
    { type: 'problem', slug: 'jump-game-ii', title: 'Jump Game II', kind: 'cold' },
    { type: 'problem', slug: 'gas-station', title: 'Gas Station', kind: 'learn' },
  ] }] })
  const log = [{ slug: 'jump-game-ii', date: '2026-10-02', result: 'red' }]
  assert.equal(rewriteKeepsRecordedWork(friday(), next, log).ok, true)
})

test('a grade on another date does not pin this one', () => {
  const next = friday({ scenarios: [{ id: 'main', when: { op: 'always' }, items: [] }] })
  const log = [{ slug: 'jump-game-ii', date: '2026-09-30', result: 'green' }]
  assert.equal(rewriteKeepsRecordedWork(friday(), next, log).ok, true)
})

/* ---------- Index ---------- */

test('the index carries both directions, so either end of a link is findable', () => {
  const index = buildDayIndex([day(), friday()])
  assert.deepEqual(index.entries['2026-10-03'].dependsOn, ['2026-10-02'])
  assert.deepEqual(index.entries['2026-10-02'].requiredBy, ['2026-10-03'])
  assert.deepEqual(index.entries['2026-10-03'].requiredBy, [])
})

test('the index reports a day planning a range, since its branches differ', () => {
  const index = buildDayIndex([day()])
  assert.deepEqual(index.entries['2026-10-03'].problems, { min: 1, max: 2 })
})

test('the index names the drifted days rather than only counting them', () => {
  const rewritten = friday({ authoredBy: { assessment: '20261002T090000Z' } })
  const index = buildDayIndex([day(), rewritten])
  assert.deepEqual(index.drifted, ['2026-10-03'])
  assert.deepEqual(index.entries['2026-10-03'].driftedFrom, ['2026-10-02'])
})

test('the index spans the days it holds', () => {
  const index = buildDayIndex([day(), friday()])
  assert.equal(index.count, 2)
  assert.equal(index.from, '2026-10-02')
  assert.equal(index.to, '2026-10-03')
})

test('an empty index is empty rather than an error', () => {
  assert.deepEqual(buildDayIndex([]), { count: 0, from: null, to: null, drifted: [], entries: {} })
})

test('the index can be rebuilt from itself, without reading the days again', () => {
  // A run that fetched nothing still has to publish a correct day section, so
  // the links are computed over entries rather than over whole day files.
  const full = buildDayIndex([day(), friday()])
  const rebuilt = linkDays(Object.values(full.entries))
  assert.deepEqual(rebuilt, full)
})

test('a day converted this run replaces what the index said about it', () => {
  const rewritten = friday({ authoredBy: { assessment: '20261002T090000Z' } })
  const stale = buildDayIndex([day(), friday()])
  const merged = linkDays([
    dayEntry(rewritten),
    ...Object.values(stale.entries).filter(e => e.date !== rewritten.date),
  ])
  assert.equal(merged.entries['2026-10-02'].authoredBy.assessment, '20261002T090000Z')
  assert.deepEqual(merged.drifted, ['2026-10-03'], 'and the day that depended on it now says so')
})

test('a run is compared by its id, which sorts chronologically', () => {
  assert.ok(authoredKey({ authoredBy: { assessment: '20261002T090000Z' } })
    > authoredKey({ authoredBy: { assessment: '20261001T115245Z' } }))
})

/* ---------- Converting the decisions already published ---------- */

const structured = load('../fixtures/coaching-decision.structured.example.json')
const legacy = load('../fixtures/coaching-decision.legacy-prose.example.json')

test('every day a decision converts to validates as a day', () => {
  for (const d of [...decisionToDays(structured), ...decisionToDays(legacy)]) {
    assert.ok(validate(d), `${d.date}\n  ${errors()}`)
  }
})

test('a decision converts to the dates it spoke to, and no others', () => {
  assert.deepEqual(decisionToDays(structured).map(d => d.date),
    ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
})

test("today's two steps become one unconditional day", () => {
  const [first] = decisionToDays(structured)
  assert.equal(first.date, structured.assessmentDate)
  assert.equal(first.scenarios.length, 1)
  assert.deepEqual(first.scenarios[0].when, { op: 'always' })
  assert.deepEqual(first.scenarios[0].items.map(i => i.type), ['problem', 'action'])
  assert.equal(first.scenarios[0].items[0].slug, 'next-greater-element-ii')
})

test('a converted day is named by what it asks for, not by the run that wrote it', () => {
  // The mode headline belongs to the assessment and already sits above the
  // tree; repeating it on the node would say nothing about the day.
  const [first] = decisionToDays(structured)
  assert.equal(first.scenarios[0].label, 'Next Greater Element II')
  assert.equal(first.headline, structured.mode.headline, 'the run still says why, on the day')
})

test('a forecast day carries across whole, conditions and all', () => {
  const thursday = decisionToDays(structured).find(d => d.date === '2026-10-01')
  const original = structured.nextThreeDays.find(d => d.date === '2026-10-01')
  assert.deepEqual(thursday.scenarios, original.scenarios)
  assert.deepEqual(thursday.dependencies, original.dependencies)
})

test('every converted day names the run that wrote it', () => {
  for (const d of decisionToDays(structured)) {
    assert.equal(d.authoredBy.assessment, '20260930T064641Z')
    assert.equal(d.authoredBy.at, structured.assessedAt)
  }
})

test('a prose day keeps its unconditional list and drops its guesses', () => {
  // The app could never tell which `conditional` branch applied; converting
  // them into scenarios would be inventing a certainty that never existed.
  const converted = decisionToDays(legacy)
  for (const d of converted) {
    for (const s of d.scenarios) assert.deepEqual(s.when, { op: 'always' })
  }
})

test('a decision with no timestamp converts to nothing, rather than to a day with no author', () => {
  assert.deepEqual(decisionToDays({ ...structured, assessedAt: null }), [])
})

test('the latest run to write a date is the one that governs it', () => {
  const older = { ...structured, assessedAt: '2026-09-30T06:46:41.000Z' }
  const newer = {
    assessedAt: '2026-10-01T11:52:45.000Z',
    assessmentDate: '2026-10-01',
    today: { doNow: { slug: 'cousins-in-binary-tree', title: 'Cousins', mode: 'cold' } },
  }
  // Newest first, as the commit log delivers them.
  const days = daysFromDecisions([newer, older])
  const oct1 = days.find(d => d.date === '2026-10-01')
  assert.equal(oct1.authoredBy.assessment, '20261001T115245Z')
  assert.equal(oct1.scenarios[0].items[0].slug, 'cousins-in-binary-tree')
})

test('a date no later run touched keeps the day that did write it', () => {
  const newer = {
    assessedAt: '2026-10-01T11:52:45.000Z',
    assessmentDate: '2026-10-01',
    today: { doNow: { slug: 'cousins-in-binary-tree', title: 'Cousins', mode: 'cold' } },
  }
  const days = daysFromDecisions([newer, structured])
  const sept30 = days.find(d => d.date === '2026-09-30')
  assert.ok(sept30, 'the day the later run never mentioned is still here')
  assert.equal(sept30.authoredBy.assessment, '20260930T064641Z')
})

test('converted days are in date order, whatever order the runs arrived in', () => {
  const days = daysFromDecisions([structured])
  assert.deepEqual(days.map(d => d.date), [...days.map(d => d.date)].sort())
})
