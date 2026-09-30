import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

/* Real JSON Schema validation of the published contract. The outlook suite
   proves the resolver behaves; this proves the schema actually accepts what
   the resolver accepts, and rejects what it should. */

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)))
const schema = load('../schemas/coaching-decision.schema.json')

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)

const errors = () => ajv.errorsText(validate.errors, { separator: '\n  ' })

const structured = load('../fixtures/coaching-decision.structured.example.json')
const legacy = load('../fixtures/coaching-decision.legacy-prose.example.json')

/* ---------- The published fixtures must validate ---------- */

test('the structured fixture validates against the published schema', () => {
  assert.ok(validate(structured), `\n  ${errors()}`)
})

test('the legacy prose fixture validates against the published schema', () => {
  assert.ok(validate(legacy), `\n  ${errors()}`)
})

/* ---------- oneOf disjointness: the bug this suite exists to catch ---------- */

test('a structured day matches exactly one nextThreeDays branch', () => {
  // Regression: legacyDay once required only `date` with additionalProperties
  // true, so every structured day satisfied both branches and oneOf failed.
  const dayOnly = {
    ...structured,
    nextThreeDays: [structured.nextThreeDays[0]],
  }
  assert.ok(validate(dayOnly), `\n  ${errors()}`)
})

test('a day mixing both shapes resolves as structured, matching the resolver', () => {
  const mixed = {
    ...structured,
    nextThreeDays: [{ ...structured.nextThreeDays[0], conditional: [] }],
  }
  assert.ok(validate(mixed), `\n  ${errors()}`)
})

/* ---------- Version independence ---------- */

test('top-level version must be 1 even when the outlook is version 2', () => {
  assert.equal(structured.version, 1)
  assert.equal(structured.outlookSchemaVersion, 2)
  assert.equal(validate({ ...structured, version: 2 }), false)
})

test('an unsupported outlook version is rejected', () => {
  assert.equal(validate({ ...structured, outlookSchemaVersion: 3 }), false)
})

/* ---------- Rejections that protect the resolver ---------- */

const withDay = day => ({ ...structured, nextThreeDays: [day] })
const base = () => structured.nextThreeDays[0]

test('an unknown predicate op is rejected by the schema', () => {
  const day = {
    ...base(),
    scenarios: [{ id: 'x', when: { op: 'vibes' }, items: [] }],
  }
  assert.equal(validate(withDay(day)), false)
})

test('result_is only accepts known outcomes', () => {
  const bad = {
    ...base(),
    scenarios: [{
      id: 'x',
      when: { op: 'result_is', dependency: 'nge-baseline', values: ['probably'] },
      items: [],
    }],
  }
  assert.equal(validate(withDay(bad)), false)
})

test('a dependency without a slug is rejected', () => {
  assert.equal(validate(withDay({ ...base(), dependencies: [{ id: 'x' }] })), false)
})

test('an unknown item kind is rejected', () => {
  const day = {
    ...base(),
    scenarios: [{
      id: 'x',
      when: { op: 'always' },
      items: [{ type: 'problem', slug: 'a', kind: 'vibes' }],
    }],
  }
  assert.equal(validate(withDay(day)), false)
})

test('a non-ISO local date is rejected', () => {
  assert.equal(validate(withDay({ ...base(), date: '01-10-2026' })), false)
})

test('minutes must be a positive integer, and may be omitted', () => {
  const item = over => withDay({
    ...base(),
    scenarios: [{ id: 'x', when: { op: 'always' }, items: [{ type: 'problem', slug: 'a', ...over }] }],
  })
  assert.equal(validate(item({ minutes: 0 })), false)
  assert.equal(validate(item({ minutes: 25.5 })), false)
  // Omitted is legal: the app reports an incomplete estimate rather than zero.
  assert.ok(validate(item({})), `\n  ${errors()}`)
})

test('a scenario cannot carry unknown fields', () => {
  const day = {
    ...base(),
    scenarios: [{ id: 'x', when: { op: 'always' }, items: [], mystery: true }],
  }
  assert.equal(validate(withDay(day)), false)
})
