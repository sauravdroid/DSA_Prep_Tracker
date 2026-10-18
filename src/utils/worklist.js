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

/**
 * The manifest in its current shape. Version 1 (a list of immutable
 * versions) reads as a list of sheets, each never updated.
 */
export function normalizeManifest(m) {
  if (!m) return null
  if (m.manifestVersion === 2) return m
  return {
    manifestVersion: 2,
    current: m.latest,
    sheets: (m.versions || []).map(v => ({
      id: v.id,
      path: v.path,
      name: v.name,
      summary: v.summary,
      createdAt: v.writtenAt,
      updatedAt: v.writtenAt,
      ...(v.migrated ? { migrated: true } : {}),
    })),
  }
}

export function sheetEntry(manifest, id) {
  return normalizeManifest(manifest)?.sheets.find(s => s.id === id) || null
}

/** What to call a sheet: its own name, the manifest's, or its position. */
export function sheetName(sheet, manifest) {
  if (sheet?.name) return sheet.name
  const sheets = normalizeManifest(manifest)?.sheets || []
  const i = sheets.findIndex(s => s.id === sheet?.id)
  return sheets[i]?.name || (i >= 0 ? `Sheet ${i + 1}` : 'Untitled sheet')
}

/**
 * Every problem on the sheet with the problems it comes after. An explicit
 * `after` wins; without one, an item follows the one listed before it in the
 * same pattern.
 */
export function problemEntries(sheet) {
  const entries = []
  for (const list of ['revision', 'new']) {
    for (const group of sheet?.[list] || []) {
      group.items.forEach((item, i) => {
        entries.push({
          ...item,
          key: item.slug,
          list,
          pattern: group.pattern,
          rank: i + 1,
          after: item.after ?? (i > 0 ? [group.items[i - 1].slug] : []),
        })
      })
    }
  }
  return entries
}

/**
 * The problem roadmap as a forest of tidy trees. Each problem hangs under its
 * first `after` that is on the sheet, so a chain runs straight down and a
 * parent sits centred over its children. Extra `after` links are kept as
 * edges between trees or across branches.
 *
 * Every tree is returned with its own width (in columns) and height (in rows)
 * so the caller can pack trees side by side and wrap them to the page.
 */
export function problemForest(sheet) {
  const entries = problemEntries(sheet)
  const bySlug = new Map(entries.map(e => [e.slug, e]))
  const parentOf = new Map()
  for (const e of entries) {
    const p = e.after.find(s => bySlug.has(s) && s !== e.slug)
    if (p) parentOf.set(e.slug, p)
  }

  // A primary-parent loop has no root; break it at its first member so the
  // layout still terminates. Validation reports the cycle itself.
  const isRoot = new Set(entries.filter(e => !parentOf.has(e.slug)).map(e => e.slug))
  const reached = new Set()
  const children = new Map(entries.map(e => [e.slug, []]))
  for (const e of entries) if (parentOf.has(e.slug)) children.get(parentOf.get(e.slug)).push(e.slug)
  const mark = s => { if (reached.has(s)) return; reached.add(s); children.get(s).forEach(mark) }
  isRoot.forEach(mark)
  for (const e of entries) {
    if (reached.has(e.slug)) continue
    const p = parentOf.get(e.slug)
    children.set(p, children.get(p).filter(s => s !== e.slug))
    parentOf.delete(e.slug)
    isRoot.add(e.slug)
    mark(e.slug)
  }

  const trees = []
  for (const e of entries) {
    if (!isRoot.has(e.slug)) continue
    const nodes = []
    let next = 0
    let depthMax = 0
    const place = (slug, depth) => {
      depthMax = Math.max(depthMax, depth)
      const kids = children.get(slug)
      let col
      if (kids.length === 0) {
        col = next++
      } else {
        const cols = kids.map(k => place(k, depth + 1))
        col = (cols[0] + cols[cols.length - 1]) / 2
      }
      nodes.push({ ...bySlug.get(slug), col, depth })
      return col
    }
    place(e.slug, 0)
    trees.push({ root: e.slug, width: next, height: depthMax + 1, nodes })
  }

  const edges = entries.flatMap(e =>
    e.after.filter(p => bySlug.has(p) && p !== e.slug).map(p => ({ from: p, to: e.slug, primary: parentOf.get(e.slug) === p }))
  )
  return { trees, edges }
}

/**
 * Packs trees left to right into bands no wider than `maxCols`, in priority
 * order. A tree wider than a band gets a band of its own.
 */
export function packForest(trees, maxCols) {
  const bands = []
  for (const t of trees) {
    const band = bands[bands.length - 1]
    if (band && band.width + t.width <= maxCols) {
      band.trees.push({ ...t, offset: band.width })
      band.width += t.width
      band.height = Math.max(band.height, t.height)
    } else {
      bands.push({ width: t.width, height: t.height, trees: [{ ...t, offset: 0 }] })
    }
  }
  return bands
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

const COMPARED = ['title', 'number', 'difficulty', 'flag', 'mode', 'reason', 'detail', 'checklist', 'minutes', 'after']

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
