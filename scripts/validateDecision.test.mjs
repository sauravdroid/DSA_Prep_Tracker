import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { validateDecision, outOfScopeFiles } from '../src/utils/validateDecision.js'

/* Guards the import path: what the app will accept from a committed file. */

const fixture = n => JSON.parse(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)))
const structured = fixture('coaching-decision.structured.example.json')
const legacy = fixture('coaching-decision.legacy-prose.example.json')

const withDay = day => ({ ...structured, nextThreeDays: [day] })
const base = () => structured.nextThreeDays[0]

/* ---------- Accepts what the coach is asked to author ---------- */

test('both published fixtures pass import validation', () => {
  for (const [name, d] of [['structured', structured], ['legacy', legacy]]) {
    const { valid, errors } = validateDecision(d)
    assert.ok(valid, `${name}: ${errors.join('; ')}`)
  }
})

/* ---------- Rejects what would break the resolver ---------- */

test('a non-object is rejected', () => {
  for (const bad of [null, undefined, 'a string', 42, ['array']]) {
    assert.equal(validateDecision(bad).valid, false)
  }
})

test('a condition naming a dependency that does not exist is rejected', () => {
  // This would otherwise sit on "Needs review" forever with no way to resolve.
  const day = {
    ...base(),
    scenarios: [{
      id: 'x',
      when: { op: 'result_is', dependency: 'typo-id', values: ['green'] },
      items: [],
    }],
  }
  const { valid, errors } = validateDecision(withDay(day))
  assert.equal(valid, false)
  assert.match(errors.join(' '), /unknown dependency "typo-id"/)
})

test('a nested condition referencing an unknown dependency is caught too', () => {
  const day = {
    ...base(),
    scenarios: [{
      id: 'x',
      when: { op: 'all', of: [{ op: 'result_is', dependency: 'ghost', values: ['green'] }] },
      items: [],
    }],
  }
  assert.match(validateDecision(withDay(day)).errors.join(' '), /unknown dependency "ghost"/)
})

test('two scenarios sharing a priority are rejected as ambiguous', () => {
  const day = {
    ...base(),
    scenarios: [
      { id: 'a', priority: 1, when: { op: 'always' }, items: [] },
      { id: 'b', priority: 1, when: { op: 'always' }, items: [] },
    ],
  }
  const { valid, errors } = validateDecision(withDay(day))
  assert.equal(valid, false)
  assert.match(errors.join(' '), /share priority 1/)
})

test('an unknown predicate op is rejected', () => {
  const day = { ...base(), scenarios: [{ id: 'x', when: { op: 'vibes' }, items: [] }] }
  assert.equal(validateDecision(withDay(day)).valid, false)
})

test('duplicate outlook dates are rejected', () => {
  const d = { ...structured, nextThreeDays: [base(), base()] }
  assert.match(validateDecision(d).errors.join(' '), /Duplicate outlook date/)
})

test('an impossible calendar date is rejected', () => {
  assert.equal(validateDecision(withDay({ ...base(), date: '2026-02-31' })).valid, false)
})

test('an unsupported outlook version is rejected', () => {
  assert.equal(validateDecision({ ...structured, outlookSchemaVersion: 3 }).valid, false)
})

test('raising the decision version to 2 is rejected', () => {
  assert.equal(validateDecision({ ...structured, version: 2 }).valid, false)
})

test('errors are collected, not just the first', () => {
  const day = {
    ...base(),
    date: '2026-13-45',
    scenarios: [{ id: 'x', when: { op: 'nope' }, items: [] }],
  }
  assert.ok(validateDecision(withDay(day)).errors.length > 1)
})

/* ---------- The coaching/ write boundary ---------- */

test('files outside coaching/ are reported', () => {
  const files = [
    { filename: 'coaching/decision.json' },
    { filename: 'tracker-data.json' },
    { filename: 'coaching/handoffs/2026-09-30.json' },
  ]
  assert.deepEqual(outOfScopeFiles(files), ['tracker-data.json'])
})

test('a commit confined to coaching/ reports nothing', () => {
  const files = [{ filename: 'coaching/decision.json' }]
  assert.deepEqual(outOfScopeFiles(files), [])
})

test('a commit touching practice facts is flagged, so advice cannot rewrite them', () => {
  const files = [{ filename: 'coaching/decision.json' }, { filename: 'tracker-data.json' }]
  assert.ok(outOfScopeFiles(files).includes('tracker-data.json'))
})
