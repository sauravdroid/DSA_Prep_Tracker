const NODE_HEIGHT = 34
const LEVEL_GAP = 62
const SIBLING_GAP = 14
const CHAR_WIDTH = 7
const PADDING = 22
const MIN_WIDTH = 64
const MAX_WIDTH = 230
const MAX_LABEL_CHARS = Math.floor((MAX_WIDTH - PADDING) / CHAR_WIDTH)

// SVG text is not clipped by its rect, so long argument lists have to be
// shortened here. The full values stay available in the frame inspector.
export function nodeLabel(node) {
  const args = node.args.join(', ')
  const full = `${node.name}(${args})`
  if (full.length <= MAX_LABEL_CHARS) return full
  const room = MAX_LABEL_CHARS - node.name.length - 3
  return room > 4 ? `${node.name}(${args.slice(0, room)}\u2026)` : full.slice(0, MAX_LABEL_CHARS - 1) + '\u2026'
}

function nodeWidth(node) {
  const label = nodeLabel(node)
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, label.length * CHAR_WIDTH + PADDING))
}

// Simple tidy layout: leaves are packed left to right in call order, parents are
// centred over their children. Enough for call trees, which never need to
// resolve subtree overlap the way general graph layouts do.
// `hidden` ids keep their slot in the output array (so index === node id) but are
// left out of positioning entirely.
export function layoutTree(nodes, hidden = null) {
  const isHidden = id => hidden?.has(id) ?? false
  const children = new Map()
  const roots = []
  for (const n of nodes) {
    if (isHidden(n.id)) continue
    if (n.parentId == null || isHidden(n.parentId)) roots.push(n.id)
    else {
      if (!children.has(n.parentId)) children.set(n.parentId, [])
      children.get(n.parentId).push(n.id)
    }
  }

  const positions = new Map()
  let cursor = 0

  const place = id => {
    const node = nodes[id]
    const width = nodeWidth(node)
    const kids = children.get(id) || []

    let x
    if (kids.length === 0) {
      x = cursor + width / 2
      cursor += width + SIBLING_GAP
    } else {
      const kidPositions = kids.map(place)
      const first = kidPositions[0]
      const last = kidPositions[kidPositions.length - 1]
      x = (first + last) / 2
      // Keep the parent inside the canvas when it is wider than its subtree.
      const leftEdge = x - width / 2
      if (leftEdge < 0) x = width / 2
      cursor = Math.max(cursor, x + width / 2 + SIBLING_GAP)
    }

    positions.set(id, x)
    return x
  }

  for (const root of roots) place(root)

  const laidOut = nodes.map(n => ({
    ...n,
    x: positions.get(n.id) ?? 0,
    y: n.depth * LEVEL_GAP,
    w: nodeWidth(n),
    h: NODE_HEIGHT,
    label: nodeLabel(n),
    hidden: isHidden(n.id),
  }))

  const edges = []
  for (const n of nodes) {
    if (n.parentId == null || isHidden(n.id) || isHidden(n.parentId)) continue
    edges.push({ from: n.parentId, to: n.id })
  }

  const visible = laidOut.filter(n => !n.hidden)
  const maxX = visible.reduce((m, n) => Math.max(m, n.x + n.w / 2), 0)
  const maxDepth = visible.reduce((m, n) => Math.max(m, n.depth), 0)

  return {
    nodes: laidOut,
    edges,
    width: maxX + SIBLING_GAP,
    height: maxDepth * LEVEL_GAP + NODE_HEIGHT,
    children,
  }
}

export { NODE_HEIGHT, LEVEL_GAP }
