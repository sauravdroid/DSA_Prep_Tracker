import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { idFromWrittenAt, worklistPath, problemEntries } from './worklist.js'

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
ajv.addSchema(manifestSchema)
const checkWorklist = ajv.getSchema(worklistSchema.$id)
// Checked against the branch its version names, so an error reads as one
// sentence instead of a failed oneOf across both formats.
const checkManifest = {
  1: ajv.getSchema(`${manifestSchema.$id}#/$defs/v1`),
  2: ajv.getSchema(`${manifestSchema.$id}#/$defs/v2`),
}

export const WORKLIST_DIR = 'coaching/worklists/'
export const WORKLIST_MANIFEST = 'coaching/worklists/manifest.json'

const schemaErrors = errs => (errs || []).map(e => `${e.instancePath || '/'} ${e.message}`.trim())

function worklistSemantics(w) {
  const errors = []
  const created = w.createdAt || w.writtenAt
  if (created && idFromWrittenAt(created) !== w.id) {
    errors.push(w.createdAt
      ? `id ${w.id} does not match createdAt ${w.createdAt}.`
      : `id ${w.id} does not match writtenAt ${w.writtenAt}; an updated sheet needs createdAt.`)
  }
  if (w.createdAt && w.writtenAt && w.writtenAt < w.createdAt) errors.push('writtenAt is earlier than createdAt.')
  if (w.replaces && w.replaces === w.id) errors.push('A sheet cannot be started from itself.')

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
  errors.push(...problemLinkErrors(w))
  return errors
}

function hasCycle(keys, parentsOf) {
  const state = new Map()
  const visit = key => {
    if (state.get(key) === 'done') return false
    if (state.get(key) === 'open') return true
    state.set(key, 'open')
    const cyclic = parentsOf(key).some(visit)
    state.set(key, 'done')
    return cyclic
  }
  return keys.some(visit)
}

function problemLinkErrors(w) {
  const errors = []
  const entries = problemEntries(w)
  const slugs = new Set(entries.map(e => e.slug))
  for (const e of entries) {
    for (const p of e.after) {
      if (p === e.slug) errors.push(`${e.slug} cannot come after itself.`)
      else if (!slugs.has(p)) errors.push(`${e.slug} comes after ${p}, which is not on this sheet.`)
    }
  }
  const parents = new Map(entries.map(e => [e.slug, e.after.filter(p => slugs.has(p) && p !== e.slug)]))
  if (hasCycle([...slugs], k => parents.get(k) || [])) {
    errors.push('The "after" links between problems form a cycle.')
  }
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
  const check = checkManifest[m.manifestVersion]
  if (!check) return { valid: false, errors: [`Unsupported manifestVersion ${m.manifestVersion}.`] }
  const errors = []
  if (!check(m)) errors.push(...schemaErrors(check.errors))

  const entries = m.manifestVersion === 2 ? m.sheets || [] : m.versions || []
  const ids = entries.map(v => v.id)
  if (new Set(ids).size !== ids.length) errors.push('A sheet id is listed twice.')
  if (ids.some((id, i) => i > 0 && id < ids[i - 1])) errors.push('Sheets must be listed oldest first.')
  for (const v of entries) {
    if (v.id && v.path && v.path !== worklistPath(v.id)) errors.push(`${v.id}: path should be ${worklistPath(v.id)}.`)
  }

  if (m.manifestVersion === 2) {
    const current = entries.find(s => s.id === m.current)
    if (m.current && !current) errors.push(`current ${m.current} is not in sheets.`)
    if (current?.archived) errors.push(`current ${m.current} is archived.`)
    for (const s of entries) {
      if (s.createdAt && idFromWrittenAt(s.createdAt) !== s.id) errors.push(`${s.id}: createdAt does not match the id.`)
      if (s.archivedAt && !s.archived) errors.push(`${s.id}: archivedAt is set but the sheet is not archived.`)
    }
  } else if (m.latest && !ids.includes(m.latest)) {
    errors.push(`latest ${m.latest} is not in versions.`)
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

/**
 * Whether a publishing commit kept to the rules: only coaching/worklists/,
 * and no sheet file deleted or renamed (archive instead). Updating a sheet
 * by overwriting its file is allowed. `files` is the GitHub commit API's
 * list, with `filename` and `status`.
 */
export function worklistCommitProblems(files = []) {
  const problems = []
  for (const f of files) {
    const name = f.filename || ''
    if (!name.startsWith(WORKLIST_DIR)) {
      problems.push(`Also changed ${name}, outside ${WORKLIST_DIR}.`)
    } else if (f.status === 'removed') {
      problems.push(`Deleted ${name}. Archive a sheet instead of deleting it.`)
    } else if (f.status === 'renamed') {
      problems.push(`Renamed ${name}. A sheet keeps its file for life.`)
    }
  }
  return problems
}

/**
 * Sheets the user has seen that the new manifest no longer lists. Entries are
 * never removed, only archived, so a missing one means a broken manifest.
 */
export function droppedSheets(previous, next) {
  const before = (previous?.sheets || previous?.versions || []).map(s => s.id)
  const after = new Set((next?.sheets || next?.versions || []).map(s => s.id))
  return before.filter(id => !after.has(id))
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
