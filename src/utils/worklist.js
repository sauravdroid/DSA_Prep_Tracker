/**
 * The worklist is the coach's document. Everything here only reads it: what
 * the app shows is the accepted version as written, plus the attempts you have
 * recorded since the coach last looked. Nothing here decides what to do next.
 */

export const LISTS = ['new', 'revision']
export const LIST_LABEL = { new: 'New', revision: 'Revision' }
export const DEFAULT_MODE = { new: 'learn', revision: 'cold' }

/** `2026-10-17T21:20:00Z` → `20261017T212000Z`, the id and file name. */
export function idFromWrittenAt(writtenAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(writtenAt || '')
  return m ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z` : null
}

export function worklistPath(id) {
  return `coaching/worklists/${id}.json`
}

/** 1-based position in the manifest, for display as "v7". */
export function versionNumber(manifest, id) {
  const i = (manifest?.versions || []).findIndex(v => v.id === id)
  return i < 0 ? null : i + 1
}

/** What to call a sheet: its own name, or its number when it has none. */
export function sheetName(sheet, number) {
  return sheet?.name || (number ? `Sheet ${number}` : 'Untitled sheet')
}

/**
 * The roadmap in rows: a pattern sits one row below the deepest pattern it
 * builds on. Within a row, patterns are placed near the patterns they build
 * on (to keep edges short), and otherwise in the coach's order.
 */
export function roadmapLayers(roadmap = []) {
  const byName = new Map(roadmap.map((n, order) => [n.pattern, { ...n, order }]))
  const parentsOf = name => (byName.get(name)?.after || []).filter(p => byName.has(p) && p !== name)

  const depth = new Map()
  const depthOf = (name, path = new Set()) => {
    if (depth.has(name)) return depth.get(name)
    if (path.has(name)) return 0
    path.add(name)
    const parents = parentsOf(name)
    const d = parents.length ? 1 + Math.max(...parents.map(p => depthOf(p, path))) : 0
    path.delete(name)
    depth.set(name, d)
    return d
  }
  for (const name of byName.keys()) depthOf(name)

  const rows = []
  for (const node of byName.values()) {
    const d = depth.get(node.pattern)
    ;(rows[d] ||= []).push(node)
  }

  const position = new Map()
  return rows.filter(Boolean).map(row => {
    const centre = node => {
      const ps = parentsOf(node.pattern).filter(p => position.has(p))
      return ps.length ? ps.reduce((s, p) => s + position.get(p), 0) / ps.length : null
    }
    const sorted = [...row].sort((a, b) => {
      const ca = centre(a)
      const cb = centre(b)
      if (ca != null && cb != null && ca !== cb) return ca - cb
      return a.order - b.order
    })
    sorted.forEach((n, i) => position.set(n.pattern, (i + 0.5) / sorted.length))
    return sorted.map(n => ({ ...n, after: parentsOf(n.pattern) }))
  })
}

/** Problems on the sheet per pattern, across both lists. */
export function countsByPattern(sheet) {
  const counts = new Map()
  for (const list of LISTS) {
    for (const group of sheet?.[list] || []) {
      const c = counts.get(group.pattern) || { new: 0, revision: 0 }
      c[list] += group.items.length
      counts.set(group.pattern, c)
    }
  }
  return counts
}

/** Every item with the list and pattern it sits in, in display order. */
export function flattenItems(worklist) {
  const out = []
  for (const list of LISTS) {
    for (const group of worklist?.[list] || []) {
      for (const item of group.items || []) out.push({ ...item, list, pattern: group.pattern })
    }
  }
  return out
}

export function itemMode(item, list) {
  return item?.mode || DEFAULT_MODE[list] || 'cold'
}

/**
 * The point after which an attempt is news to the coach: the newest attempt
 * it read, or when it wrote the list if it read none.
 */
export function seenUntil(worklist) {
  return worklist?.basedOn?.lastAttemptAt || worklist?.writtenAt || ''
}

/** Attempts recorded after the coach last looked, newest first. */
export function attemptsSince(worklist, practiceLog = []) {
  const since = seenUntil(worklist)
  return practiceLog
    .filter(e => (e.at || e.date || '') > since)
    .sort((a, b) => (b.at || b.date).localeCompare(a.at || a.date))
}

/** The latest unseen attempt for each slug. */
export function latestAttemptBySlug(worklist, practiceLog = []) {
  const map = new Map()
  for (const e of attemptsSince(worklist, practiceLog)) {
    if (!map.has(e.slug)) map.set(e.slug, e)
  }
  return map
}

const COMPARED = ['title', 'number', 'difficulty', 'flag', 'mode', 'reason', 'detail', 'checklist', 'minutes']

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * What changes between the version you follow and the one under review. The
 * coach's `changes` only supplies reasons; the comparison itself is ours, so
 * a missing or wrong change note cannot hide a change.
 */
export function diffWorklists(prev, next) {
  const before = new Map(flattenItems(prev).map(i => [i.slug, i]))
  const after = new Map(flattenItems(next).map(i => [i.slug, i]))
  const reasons = new Map((next?.changes || []).map(c => [c.slug, c.reason]))

  const added = []
  const removed = []
  const modified = []
  const moved = []

  for (const [slug, item] of after) {
    const old = before.get(slug)
    const reason = reasons.get(slug) || null
    if (!old) {
      added.push({ ...item, reason: reason || item.reason })
    } else if (old.list !== item.list) {
      moved.push({ ...item, from: old.list, to: item.list, reason: reason || item.reason })
    } else {
      const fields = COMPARED.filter(f => !sameValue(old[f], item[f]))
      if (old.pattern !== item.pattern) fields.push('pattern')
      if (fields.length > 0) modified.push({ ...item, fields, reason: reason || item.reason })
    }
  }
  for (const [slug, item] of before) {
    if (!after.has(slug)) removed.push({ ...item, reason: reasons.get(slug) || null })
  }

  const count = (w, list) => (w?.[list] || []).reduce((n, g) => n + (g.items || []).length, 0)
  const counts = Object.fromEntries(LISTS.map(l => [l, { before: count(prev, l), after: count(next, l) }]))

  return {
    added,
    removed,
    modified,
    moved,
    counts,
    total: added.length + removed.length + modified.length + moved.length,
  }
}

/** Changes grouped by the list they land in, for the review panel. */
export function changesByList(diff) {
  const out = { new: [], revision: [] }
  const push = (list, op, item) => out[list]?.push({ op, ...item })
  for (const i of diff.removed) push(i.list, 'removed', i)
  for (const i of diff.modified) push(i.list, 'modified', i)
  for (const i of diff.moved) push(i.to, 'moved', i)
  for (const i of diff.added) push(i.list, 'added', i)
  return out
}
