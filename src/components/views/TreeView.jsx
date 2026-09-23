import { useMemo } from 'react'

const X_GAP = 46
const Y_GAP = 54
const RADIUS = 15
const PAD = 22

// In-order x placement is the standard way to draw a binary tree without
// subtrees overlapping: every node sits between its two children.
function layout(nodes, rootId) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const pos = new Map()
  let column = 0

  const walk = (id, depth) => {
    const node = byId.get(id)
    if (!node) return
    walk(node.left, depth + 1)
    pos.set(id, { x: PAD + column * X_GAP, y: PAD + depth * Y_GAP })
    column++
    walk(node.right, depth + 1)
  }
  walk(rootId, 0)

  const placed = nodes.filter(n => pos.has(n.id)).map(n => ({ ...n, ...pos.get(n.id) }))
  return {
    placed,
    byId,
    width: PAD * 2 + Math.max(0, column - 1) * X_GAP,
    height: PAD * 2 + Math.max(...placed.map(n => n.y), 0) - PAD + RADIUS * 2,
  }
}

export default function TreeView({ name, value, previous, cursors = [] }) {
  const { placed, byId, width, height } = useMemo(
    () => layout(value.tree, value.rootId),
    [value.tree, value.rootId]
  )

  const cursorIds = new Map(cursors.map(c => [c.rootId, c.name]))
  const previousVals = new Map((previous?.tree ?? []).map(n => [n.id, n.val]))

  return (
    <div className="rec-tree">
      <div className="rec-array-head">
        <span className="rec-array-name">{name}</span>
        <span className="rec-array-len">{value.tree.length} nodes</span>
        {cursors.map(c => (
          <span key={c.name} className="rec-grid-cursor">{c.name}</span>
        ))}
      </div>
      <div className="rec-tree-scroll">
        <svg width={width} height={height} className="rec-tree-svg">
          {placed.map(n => ['left', 'right'].map(side => {
            const child = byId.get(n[side])
            const childPos = child && placed.find(p => p.id === child.id)
            if (!childPos) return null
            return (
              <line
                key={`${n.id}-${side}`}
                className="rec-tree-edge"
                x1={n.x} y1={n.y + RADIUS} x2={childPos.x} y2={childPos.y - RADIUS}
              />
            )
          }))}
          {placed.map(n => {
            const cursor = cursorIds.get(n.id)
            const changed = previousVals.has(n.id) && previousVals.get(n.id) !== n.val
            return (
              <g key={n.id} className={`rec-tree-node ${cursor ? 'cursor' : ''} ${changed ? 'changed' : ''}`}>
                <circle cx={n.x} cy={n.y} r={RADIUS} />
                <text x={n.x} y={n.y + 4} textAnchor="middle">{n.val}</text>
                {cursor && <text className="rec-tree-tag" x={n.x} y={n.y - RADIUS - 5} textAnchor="middle">{cursor}</text>}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
