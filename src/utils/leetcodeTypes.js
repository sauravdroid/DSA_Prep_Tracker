// LeetCode passes trees and linked lists as serialized arrays and expects the
// solution to receive real nodes. These mirror the classes LeetCode injects.
export class TreeNode {
  constructor(val, left, right) {
    this.val = val === undefined ? 0 : val
    this.left = left === undefined ? null : left
    this.right = right === undefined ? null : right
  }
}

export class ListNode {
  constructor(val, next) {
    this.val = val === undefined ? 0 : val
    this.next = next === undefined ? null : next
  }
}

// LeetCode's `Node` for graph problems (LC 133 etc).
export class GraphNode {
  constructor(val, neighbors) {
    this.val = val === undefined ? 0 : val
    this.neighbors = neighbors === undefined ? [] : neighbors
  }
}

// adj[i] holds the neighbour *values* of the node whose val is i + 1.
export function buildGraph(adj) {
  if (!Array.isArray(adj) || adj.length === 0) return null
  const nodes = adj.map((_, i) => new GraphNode(i + 1))
  adj.forEach((neighbors, i) => {
    nodes[i].neighbors = (neighbors || []).map(v => nodes[v - 1]).filter(Boolean)
  })
  return nodes[0]
}

export function serializeGraph(node) {
  if (!node) return []
  const seen = new Map([[node.val, node]])
  const queue = [node]
  while (queue.length > 0) {
    const n = queue.shift()
    for (const nb of n.neighbors || []) {
      if (!seen.has(nb.val)) {
        seen.set(nb.val, nb)
        queue.push(nb)
      }
    }
  }
  return [...seen.keys()]
    .sort((a, b) => a - b)
    .map(v => (seen.get(v).neighbors || []).map(x => x.val))
}

export function buildTree(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr[0] === null) return null
  const root = new TreeNode(arr[0])
  const queue = [root]
  let i = 1
  while (queue.length > 0 && i < arr.length) {
    const node = queue.shift()
    if (i < arr.length) {
      const v = arr[i++]
      if (v !== null) { node.left = new TreeNode(v); queue.push(node.left) }
    }
    if (i < arr.length) {
      const v = arr[i++]
      if (v !== null) { node.right = new TreeNode(v); queue.push(node.right) }
    }
  }
  return root
}

export function serializeTree(root) {
  if (!root) return []
  const out = []
  const queue = [root]
  while (queue.length > 0) {
    const node = queue.shift()
    if (node) {
      out.push(node.val)
      queue.push(node.left, node.right)
    } else {
      out.push(null)
    }
  }
  while (out.length > 0 && out[out.length - 1] === null) out.pop()
  return out
}

export function buildList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null
  const head = new ListNode(arr[0])
  let cur = head
  for (let i = 1; i < arr.length; i++) {
    cur.next = new ListNode(arr[i])
    cur = cur.next
  }
  return head
}

export function serializeList(head) {
  const out = []
  let cur = head
  // Guard against cycles, which several linked-list problems construct on purpose.
  const seen = new Set()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    out.push(cur.val)
    cur = cur.next
  }
  return out
}

const BUILDERS = { TreeNode: buildTree, ListNode: buildList, GraphNode: buildGraph }
const SERIALIZERS = { TreeNode: serializeTree, ListNode: serializeList, GraphNode: serializeGraph }

function normalize(type) {
  return String(type || '').replace(/\s+/g, '')
}

const NODE_TYPE = /^(_?Node|TreeNode|ListNode|GraphNode)(\[\])?$/

export function isNodeType(type) {
  return NODE_TYPE.test(normalize(type))
}

export function isNodeAlias(type) {
  const t = normalize(type)
  return t === 'Node' || t === '_Node'
}

// `Node` / `_Node` mean different classes per problem, so fall back to the shape
// of the actual input: adjacency rows are arrays of ints, a tree is flat.
function inferNodeType(value) {
  if (!Array.isArray(value)) return null
  if (value.length === 0) return 'GraphNode'
  if (value.every(r => Array.isArray(r) && r.every(Number.isInteger))) return 'GraphNode'
  if (value.every(v => v === null || typeof v === 'number')) return 'TreeNode'
  return null
}

export function resolveNodeType(type, value) {
  const t = normalize(type)
  return isNodeAlias(t) ? inferNodeType(value) || t : t
}

export function convertArg(value, type) {
  const t = resolveNodeType(type, value)
  if (BUILDERS[t]) return BUILDERS[t](value)
  const listMatch = t.match(/^(TreeNode|ListNode|GraphNode)\[\]$/)
  if (listMatch && Array.isArray(value)) return value.map(BUILDERS[listMatch[1]])
  return value
}

// `metaData` lies for problems marked "manual" — Clone Graph reports
// integer[][] -> boolean. The real class is only declared in typescriptCustomType,
// so the field names there are the authoritative signal.
export function nodeShapeFromCustomType(source) {
  if (!source) return null
  const fields = new Set()
  for (const m of String(source).matchAll(/\b(val|neighbors|next|random|prev|child|left|right)\s*[?:]/g)) {
    fields.add(m[1])
  }
  if (fields.has('neighbors')) return 'GraphNode'
  if (fields.has('left') || fields.has('right')) return 'TreeNode'
  if (fields.has('random') || fields.has('child') || fields.has('next')) return 'ListNode'
  return null
}

export function convertResult(value, type) {
  const t = normalize(type)
  if (SERIALIZERS[t]) return SERIALIZERS[t](value)
  const listMatch = t.match(/^(TreeNode|ListNode|GraphNode)\[\]$/)
  if (listMatch && Array.isArray(value)) return value.map(SERIALIZERS[listMatch[1]])
  // Safety net when the declared return type is missing or wrong.
  if (value instanceof TreeNode) return serializeTree(value)
  if (value instanceof ListNode) return serializeList(value)
  if (value instanceof GraphNode) return serializeGraph(value)
  return value
}

export function needsConversion(types) {
  return (types || []).some(t => /TreeNode|ListNode/.test(normalize(t)))
}

// Fallback for code pasted without loading the problem: LeetCode's starter
// comment carries the same type information as its metaData.
export function parseJsDocTypes(code) {
  const header = String(code || '')
  const params = []
  const paramRe = /@param\s*\{([^}]+)\}/g
  let m
  while ((m = paramRe.exec(header))) params.push(m[1].trim())
  const ret = header.match(/@returns?\s*\{([^}]+)\}/)
  return { params, return: ret ? ret[1].trim() : '' }
}
