const ROW_NAME = /^(i|r|row|ri|y|di)$/i
const COL_NAME = /^(j|c|col|ci|x|dj)$/i
const INDEX_NAME = /^(i|j|k|l|r|lo|hi|mid|left|right|start|end|head|tail|front|back|slow|fast|idx|index|ptr|p|q|pos|cur|curr)$/i

const KIND_ORDER = { grid: 0, array: 1 }

// Deterministic, type-driven: the worker already tagged each value's shape.
export function detectViews(snapshot) {
  if (!snapshot) return []
  return Object.entries(snapshot)
    .filter(([, v]) => v.kind === 'grid' || v.kind === 'array')
    .map(([name, v]) => ({ kind: v.kind, name }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

export function indexPointers(snapshot) {
  if (!snapshot) return []
  return Object.entries(snapshot)
    .filter(([name, v]) => v.index != null && INDEX_NAME.test(name))
    .map(([name, v]) => ({ name, value: v.index }))
}

// Row/column cursors for grid views. Falls back to any integer variable whose
// name reads like an axis, which is how nearly all grid code is written.
export function gridCursor(snapshot) {
  if (!snapshot) return { row: null, col: null }
  let row = null
  let col = null
  for (const [name, v] of Object.entries(snapshot)) {
    if (v.index == null) continue
    if (row == null && ROW_NAME.test(name)) row = { name, value: v.index }
    else if (col == null && COL_NAME.test(name)) col = { name, value: v.index }
  }
  return { row, col }
}

// A spec may only rebind views that the trace actually supports; anything that
// does not match the real snapshot is dropped so a bad spec cannot mislead.
export function applyViewSpec(spec, snapshot, fallback) {
  if (!spec?.views?.length || !snapshot) return fallback
  const valid = spec.views.filter(v => {
    const entry = snapshot[v.name]
    if (!entry) return false
    if (v.kind === 'grid') return entry.kind === 'grid'
    if (v.kind === 'array') return entry.kind === 'array'
    return false
  })
  return valid.length > 0 ? valid : fallback
}
