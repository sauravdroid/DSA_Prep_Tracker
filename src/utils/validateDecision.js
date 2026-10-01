import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

/**
 * Validation of a coaching decision against the published schema, plus the
 * semantic rules a JSON Schema cannot express.
 *
 * Node-side only: the Vite middleware and the tests share this so an imported
 * decision is checked by exactly the contract the coach was asked to author
 * against.
 */

const schema = JSON.parse(
  readFileSync(new URL('../../schemas/coaching-decision.schema.json', import.meta.url), 'utf8')
)
const daySchema = JSON.parse(
  readFileSync(new URL('../../schemas/coaching-day.schema.json', import.meta.url), 'utf8')
)

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
ajv.addSchema(schema)
const validateSchema = ajv.compile(schema)
const validateDaySchema = ajv.compile(daySchema)

const SUPPORTED_OUTLOOK_VERSIONS = [1, 2]

/** Every predicate op the resolver understands. */
const SUPPORTED_OPS = new Set([
  'always', 'result_is', 'not_completed', 'all', 'any', 'unresolved_failure', 'recheck_due',
])

function collectOps(pred, out = []) {
  if (!pred || typeof pred !== 'object') return out
  out.push(pred.op)
  for (const child of pred.of || []) collectOps(child, out)
  return out
}

/** `Date.parse` rolls 2026-02-31 over to March, so round-trip the parts. */
function isRealDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!m) return false
  const [, y, mo, d] = m.map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/**
 * Checks the schema cannot make, for one day. Shared so a day is held to the
 * same rules whether it arrives inside a decision or as its own document.
 */
function dayErrors(day) {
  const errors = []
  if (!isRealDate(day.date)) errors.push(`${day.date} is not a real calendar date.`)
  if (!day.scenarios) return errors

  const deps = day.dependencies || []
  const ids = new Set(deps.map(d => d.id))
  const priorities = new Map()

  // A result dated after the day that waits on it cannot arrive in time.
  for (const dep of deps) {
    if (dep.date && day.date && dep.date > day.date) {
      errors.push(`${day.date}: dependency "${dep.id}" waits on ${dep.date}, which is later.`)
    }
  }

  for (const s of day.scenarios) {
    for (const op of collectOps(s.when)) {
      if (!SUPPORTED_OPS.has(op)) {
        errors.push(`${day.date}: scenario "${s.id}" uses unknown condition "${op}".`)
      }
    }

    // A condition naming a dependency that does not exist can never resolve,
    // so the day would sit on "Needs review" forever.
    const named = [s.when, ...(s.when?.of || [])]
      .map(p => p?.dependency)
      .filter(Boolean)
    for (const dep of named) {
      if (!ids.has(dep)) {
        errors.push(`${day.date}: scenario "${s.id}" refers to unknown dependency "${dep}".`)
      }
    }

    if (s.priority != null) {
      if (priorities.has(s.priority)) {
        errors.push(`${day.date}: scenarios "${priorities.get(s.priority)}" and "${s.id}" share priority ${s.priority}.`)
      }
      priorities.set(s.priority, s.id)
    }
  }

  return errors
}

/**
 * Checks the schema cannot make: references that must resolve, priorities that
 * must be unambiguous, and dates that must be real and distinct.
 */
function semanticErrors(decision) {
  const errors = []
  const days = decision.nextThreeDays || []

  const version = decision.outlookSchemaVersion
  if (version != null && !SUPPORTED_OUTLOOK_VERSIONS.includes(version)) {
    errors.push(`Unsupported outlookSchemaVersion ${version}.`)
  }

  const seen = new Set()
  for (const day of days) {
    if (seen.has(day.date)) errors.push(`Duplicate outlook date ${day.date}.`)
    seen.add(day.date)
    errors.push(...dayErrors(day))
  }

  return errors
}

/** @returns {{ valid: boolean, errors: string[] }} */
export function validateDay(day) {
  if (!day || typeof day !== 'object' || Array.isArray(day)) {
    return { valid: false, errors: ['A day must be a JSON object.'] }
  }

  const errors = [...dayErrors(day)]
  if (!validateDaySchema(day)) {
    for (const e of validateDaySchema.errors) {
      errors.push(`${e.instancePath || '/'} ${e.message}`.trim())
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

/** @returns {{ valid: boolean, errors: string[] }} */
export function validateDecision(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return { valid: false, errors: ['Decision must be a JSON object.'] }
  }

  // Semantic messages first: a failed `oneOf` expands into a dozen internal
  // branch errors that bury the one sentence an author can act on.
  const errors = [...semanticErrors(decision)]

  if (!validateSchema(decision)) {
    for (const e of validateSchema.errors) {
      errors.push(`${e.instancePath || '/'} ${e.message}`.trim())
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

/**
 * A coaching update may change `coaching/` only. This is an adoption-side
 * check: ordinary repository write access is not directory-scoped, so it
 * prevents this app trusting an out-of-scope commit rather than preventing
 * the commit itself.
 */
export function outOfScopeFiles(files, allowedPrefix = 'coaching/') {
  return (files || [])
    .map(f => f.filename)
    .filter(name => name && !name.startsWith(allowedPrefix))
}
