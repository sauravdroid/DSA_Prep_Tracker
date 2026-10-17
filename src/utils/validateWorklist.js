import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { idFromWrittenAt, worklistPath } from './worklist.js'

/**
 * Node-side checks on what the coach publishes. The Vite middleware, the
 * migration and the tests share these, so a worklist is held to one contract
 * wherever it is read.
 */

const load = name => JSON.parse(readFileSync(new URL(`../../schemas/${name}`, import.meta.url), 'utf8'))
const worklistSchema = load('worklist.schema.json')
const manifestSchema = load('worklist-manifest.schema.json')

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
ajv.addSchema(worklistSchema)
const checkWorklist = ajv.getSchema(worklistSchema.$id)
const checkManifest = ajv.compile(manifestSchema)

export const WORKLIST_DIR = 'coaching/worklists/'
export const WORKLIST_MANIFEST = 'coaching/worklists/manifest.json'

const schemaErrors = errs => (errs || []).map(e => `${e.instancePath || '/'} ${e.message}`.trim())

function worklistSemantics(w) {
  const errors = []
  if (w.writtenAt && idFromWrittenAt(w.writtenAt) !== w.id) {
    errors.push(`id ${w.id} does not match writtenAt ${w.writtenAt}.`)
  }
  if (w.replaces && w.replaces === w.id) errors.push('A version cannot replace itself.')

  const listOf = new Map()
  for (const list of ['new', 'revision']) {
    const patterns = new Set()
    for (const group of w[list] || []) {
      if (patterns.has(group.pattern)) errors.push(`${list}: pattern "${group.pattern}" appears twice.`)
      patterns.add(group.pattern)
      for (const item of group.items || []) {
        const seen = listOf.get(item.slug)
        if (seen === list) errors.push(`${list}: ${item.slug} appears more than once.`)
        else if (seen) errors.push(`${item.slug} is in both new and revision.`)
        listOf.set(item.slug, list)
      }
    }
  }
  if (Array.isArray(w.roadmap)) errors.push(...roadmapErrors(w))
  return errors
}

function roadmapErrors(w) {
  const errors = []
  const names = new Set()
  for (const node of w.roadmap) {
    if (names.has(node.pattern)) errors.push(`roadmap: "${node.pattern}" appears twice.`)
    names.add(node.pattern)
  }
  for (const node of w.roadmap) {
    for (const parent of node.after || []) {
      if (parent === node.pattern) errors.push(`roadmap: "${node.pattern}" cannot come after itself.`)
      else if (!names.has(parent)) errors.push(`roadmap: "${node.pattern}" comes after "${parent}", which is not in the roadmap.`)
    }
  }

  // A cycle has no first pattern, so it cannot be drawn as a roadmap.
  const after = new Map(w.roadmap.map(n => [n.pattern, (n.after || []).filter(p => names.has(p) && p !== n.pattern)]))
  const state = new Map()
  const visit = name => {
    if (state.get(name) === 'done') return false
    if (state.get(name) === 'open') return true
    state.set(name, 'open')
    const cyclic = after.get(name).some(visit)
    state.set(name, 'done')
    return cyclic
  }
  if ([...names].some(visit)) errors.push('roadmap: the "after" links form a cycle.')

  for (const list of ['new', 'revision']) {
    for (const group of w[list] || []) {
      if (!names.has(group.pattern)) errors.push(`${list}: pattern "${group.pattern}" is not in the roadmap.`)
    }
  }
  return errors
}

/** @returns {{ valid: boolean, errors: string[] }} */
export function validateWorklist(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) {
    return { valid: false, errors: ['A worklist must be a JSON object.'] }
  }
  const errors = [...worklistSemantics(w)]
  if (!checkWorklist(w)) errors.push(...schemaErrors(checkWorklist.errors))
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

/** @returns {{ valid: boolean, errors: string[] }} */
export function validateWorklistManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    return { valid: false, errors: ['The manifest must be a JSON object.'] }
  }
  const errors = []
  if (!checkManifest(m)) errors.push(...schemaErrors(checkManifest.errors))

  const ids = (m.versions || []).map(v => v.id)
  if (new Set(ids).size !== ids.length) errors.push('A version id is listed twice.')
  if (ids.some((id, i) => i > 0 && id < ids[i - 1])) errors.push('Versions must be listed oldest first.')
  for (const v of m.versions || []) {
    if (v.id && v.path && v.path !== worklistPath(v.id)) errors.push(`${v.id}: path should be ${worklistPath(v.id)}.`)
  }
  if (m.latest && !ids.includes(m.latest)) errors.push(`latest ${m.latest} is not in versions.`)
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

/**
 * Whether a publishing commit kept to the rules: only coaching/worklists/,
 * and no published version edited or deleted. `files` is the GitHub commit
 * API's list, with `filename` and `status`.
 */
export function worklistCommitProblems(files = []) {
  const problems = []
  for (const f of files) {
    const name = f.filename || ''
    if (!name.startsWith(WORKLIST_DIR)) {
      problems.push(`Also changed ${name}, outside ${WORKLIST_DIR}.`)
    } else if (name !== WORKLIST_MANIFEST && f.status !== 'added') {
      problems.push(`${f.status === 'removed' ? 'Deleted' : 'Changed'} the published version ${name}.`)
    }
  }
  return problems
}

// Keys sorted, arrays kept in order: the coach's ordering is content here.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Identity of a version's content, independent of whitespace and key order. */
export function worklistHash(w) {
  return crypto.createHash('sha256').update(stable(w)).digest('hex').slice(0, 16)
}
