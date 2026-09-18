import { instrument } from '../utils/instrument'
import { TreeNode, ListNode, GraphNode, convertArg, convertResult, parseJsDocTypes, isNodeType, isNodeAlias, resolveNodeType } from '../utils/leetcodeTypes'

const MAX_EVENTS = 40000
const MAX_NODES = 6000
const MAX_DEPTH = 400
const FLOAT_EPSILON = 1e-5

class TraceAborted extends Error {}

// Values are previewed eagerly at call time. Backtracking algorithms mutate the
// same array across frames, so holding a live reference would make every frame
// display the final state instead of what it actually received.
function preview(value, depth = 0) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  const t = typeof value
  if (t === 'number' || t === 'boolean') return String(value)
  if (t === 'bigint') return `${value}n`
  if (t === 'string') return JSON.stringify(value.length > 40 ? value.slice(0, 40) + '\u2026' : value)
  if (t === 'function') return `\u0192 ${value.name || 'anonymous'}`
  if (t === 'symbol') return value.toString()
  // Whole trees and lists would swamp a node label; the value identifies the node.
  if (value instanceof TreeNode) return `TreeNode(${preview(value.val, depth + 1)})`
  if (value instanceof ListNode) return `ListNode(${preview(value.val, depth + 1)})`
  if (value instanceof GraphNode) return `Node(${preview(value.val, depth + 1)})`
  if (depth > 2) return Array.isArray(value) ? '[\u2026]' : '{\u2026}'

  if (Array.isArray(value)) {
    const items = value.slice(0, 8).map(v => preview(v, depth + 1))
    if (value.length > 8) items.push(`\u2026+${value.length - 8}`)
    return `[${items.join(', ')}]`
  }
  if (value instanceof Map) {
    const items = [...value.entries()].slice(0, 5).map(([k, v]) => `${preview(k, depth + 1)} => ${preview(v, depth + 1)}`)
    return `Map(${value.size}){${items.join(', ')}}`
  }
  if (value instanceof Set) {
    const items = [...value].slice(0, 6).map(v => preview(v, depth + 1))
    return `Set(${value.size}){${items.join(', ')}}`
  }
  try {
    const keys = Object.keys(value)
    const items = keys.slice(0, 6).map(k => `${k}: ${preview(value[k], depth + 1)}`)
    if (keys.length > 6) items.push('\u2026')
    return `{${items.join(', ')}}`
  } catch {
    return '[unserializable]'
  }
}

// Full JSON for the output panel — previews are truncated, results should not be.
function display(value) {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value)
  } catch {
    return preview(value)
  }
}

// Numbers compare with tolerance because LeetCode float answers are only
// specified to 5 decimal places.
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    return Math.abs(a - b) <= FLOAT_EPSILON
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]))
  }
  return false
}

const MAX_CELLS = 48
const MAX_GRID_ROWS = 40
const MAX_GRID_COLS = 40

function isScalar(v) {
  return v === null || ['number', 'string', 'boolean', 'undefined'].includes(typeof v)
}

// A DP table or matrix has scalar cells. A BFS queue of [node, parent] pairs is
// also an array of arrays, so cell type is what separates them.
function isGrid(value) {
  if (!Array.isArray(value) || value.length < 2) return false
  let width = 0
  for (const row of value) {
    if (!Array.isArray(row)) return false
    width = Math.max(width, row.length)
    if (!row.every(isScalar)) return false
  }
  return width >= 2
}

// Arrays keep their elements separate so the UI can draw them as cells rather
// than one long string.
function snapshotValue(value) {
  const entry = { text: preview(value) }

  if (isGrid(value)) {
    entry.kind = 'grid'
    // Raw strings, not JSON: a character grid is unreadable with quotes on every cell.
    entry.rows = value.slice(0, MAX_GRID_ROWS).map(r =>
      r.slice(0, MAX_GRID_COLS).map(c => (typeof c === 'string' ? c : preview(c, 2))))
    entry.rowCount = value.length
    entry.colCount = value.reduce((m, r) => Math.max(m, r.length), 0)
  } else if (Array.isArray(value)) {
    entry.kind = 'array'
    entry.items = value.slice(0, MAX_CELLS).map(v => preview(v, 1))
    entry.length = value.length
  } else if (value instanceof TreeNode) {
    entry.kind = 'tree'
  } else if (value instanceof ListNode) {
    entry.kind = 'list'
  } else if (Number.isInteger(value)) {
    entry.kind = 'number'
    entry.index = value
  } else {
    entry.kind = 'value'
  }

  entry.sig = entry.kind === 'grid' ? JSON.stringify(entry.rows) : entry.text
  return entry
}

function createTracer() {
  const nodes = []
  const events = []
  const stack = []
  // Unchanged values reuse the same object; structured clone keeps shared
  // references, so a large static grid is only serialized once.
  const lastSnapshot = new Map()
  let aborted = null
  let armed = true
  let nextId = 0

  const check = () => {
    if (aborted) throw new TraceAborted()
    if (nodes.length >= MAX_NODES) {
      aborted = `Stopped after ${MAX_NODES} calls — the recursion is too large (or infinite) to draw.`
      throw new TraceAborted()
    }
    if (events.length >= MAX_EVENTS) {
      aborted = `Stopped after ${MAX_EVENTS} steps.`
      throw new TraceAborted()
    }
    if (stack.length >= MAX_DEPTH) {
      aborted = `Stopped at depth ${MAX_DEPTH} — this looks like infinite recursion (a missing or unreachable base case).`
      throw new TraceAborted()
    }
  }

  const tracer = {
    enter(fnId, name, args, line) {
      if (!armed) return -1
      check()
      const parent = stack.length > 0 ? stack[stack.length - 1] : null
      const node = {
        id: nextId++,
        fnId,
        name,
        line,
        curLine: line,
        depth: stack.length,
        parentId: parent,
        args: args.map(a => preview(a)),
        result: null,
        returned: false,
        threw: false,
        logs: [],
        enterStep: events.length,
        exitStep: -1,
      }
      nodes.push(node)
      stack.push(node.id)
      events.push({ type: 'enter', id: node.id, line })
      return node.id
    },
    at(line, vars) {
      if (aborted || !armed || stack.length === 0) return
      if (events.length >= MAX_EVENTS) {
        aborted = `Stopped after ${MAX_EVENTS} steps.`
        throw new TraceAborted()
      }
      const current = stack[stack.length - 1]
      nodes[current].curLine = line
      const event = { type: 'line', id: current, line }
      if (vars) {
        const snapshot = {}
        for (const key of Object.keys(vars)) {
          if (typeof vars[key] === 'function') continue
          const entry = snapshotValue(vars[key])
          const cacheKey = `${current}|${key}`
          const prev = lastSnapshot.get(cacheKey)
          if (prev && prev.sig === entry.sig) {
            snapshot[key] = prev
          } else {
            lastSnapshot.set(cacheKey, entry)
            snapshot[key] = entry
          }
        }
        event.vars = snapshot
      }
      events.push(event)
    },
    ret(id, value) {
      if (id === -1) return value
      const node = nodes[id]
      if (node && !aborted) {
        node.result = preview(value)
        node.returned = true
      }
      return value
    },
    leave(id) {
      if (aborted || id === -1) return
      const node = nodes[id]
      if (!node) return
      const top = stack.lastIndexOf(id)
      if (top !== -1) stack.splice(top, 1)
      node.exitStep = events.length
      // Point at the caller, which is where execution actually resumes.
      const caller = stack.length > 0 ? nodes[stack[stack.length - 1]] : null
      events.push({ type: 'exit', id, line: caller ? caller.curLine : node.line })
    },
    log(...args) {
      if (aborted || !armed) return
      const text = args.map(a => (typeof a === 'string' ? a : preview(a))).join(' ')
      const current = stack.length > 0 ? stack[stack.length - 1] : null
      if (current != null) nodes[current].logs.push({ step: events.length, text })
      events.push({ type: 'log', id: current, text, line: current != null ? nodes[current].curLine : null })
    },
  }

  return {
    tracer,
    nodes,
    events,
    setArmed: v => { armed = v },
    getAborted: () => aborted,
    markThrew: () => {
      const current = stack.length > 0 ? stack[stack.length - 1] : null
      if (current != null) nodes[current].threw = true
    },
    finalize: () => {
      for (const node of nodes) {
        if (node.exitStep === -1) node.exitStep = events.length
      }
    },
  }
}

function makeConsole(tracer) {
  const fn = (...args) => tracer.log(...args)
  return { log: fn, info: fn, warn: fn, error: fn, debug: fn }
}

function buildFactory(instrumented, topLevel) {
  const exportsExpr = topLevel
    .map(n => `${JSON.stringify(n)}: typeof ${n} !== "undefined" ? ${n} : undefined`)
    .join(', ')
  // `Node` and `_Node` are the names LeetCode injects for graph/list problems.
  // eslint-disable-next-line no-new-func
  const factory = new Function('__T', 'console', 'TreeNode', 'ListNode', 'Node', '_Node', `"use strict";\n${instrumented}\nreturn { ${exportsExpr} };`)
  return (tracer, sandboxConsole) => factory(tracer, sandboxConsole, TreeNode, ListNode, GraphNode, GraphNode)
}

function runScript(instrumented, topLevel) {
  const ctx = createTracer()
  let error = null
  try {
    buildFactory(instrumented, topLevel)(ctx.tracer, makeConsole(ctx.tracer))
  } catch (e) {
    if (!(e instanceof TraceAborted)) {
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      ctx.markThrew()
    }
  }
  ctx.finalize()
  return { nodes: ctx.nodes, events: ctx.events, error, aborted: ctx.getAborted(), status: 'ran' }
}

function runCase(instrumented, topLevel, entry, testCase, types) {
  const base = { id: testCase.id, input: testCase.input, expected: testCase.expected, nodes: [], events: [], output: null, aborted: null }

  let args
  let resolved
  try {
    const raw = testCase.input
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => JSON.parse(l))
    // A `Node` alias can only be pinned down from the input shape, so resolve it
    // here and reuse it for the return value, which may be null.
    resolved = raw.map((v, i) => resolveNodeType(types.params[i], v))
    args = raw.map((v, i) => convertArg(v, resolved[i]))
  } catch (e) {
    return { ...base, error: `Input is not valid JSON — one argument per line. (${e.message})`, status: 'error' }
  }

  const returnType = isNodeAlias(types.return)
    ? resolved.find(t => /^(TreeNode|ListNode|GraphNode)$/.test(t)) || types.return
    : types.return

  const ctx = createTracer()
  let error = null
  let output
  let ran = false

  try {
    // The module body runs untraced so only the entry call appears in the tree.
    ctx.setArmed(false)
    const exported = buildFactory(instrumented, topLevel)(ctx.tracer, makeConsole(ctx.tracer))
    ctx.setArmed(true)

    const fn = exported[entry]
    if (typeof fn !== 'function') {
      return { ...base, error: `"${entry}" is not a function declared at the top level.`, status: 'error' }
    }
    output = fn(...args)
    output = convertResult(output, returnType)
    ran = true
  } catch (e) {
    if (!(e instanceof TraceAborted)) {
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      ctx.markThrew()
    }
  }
  ctx.finalize()

  let status = 'ran'
  if (error) status = 'error'
  else if (ctx.getAborted()) status = 'aborted'
  else if (ran && testCase.expected.trim()) {
    try {
      status = deepEqual(output, JSON.parse(testCase.expected)) ? 'pass' : 'fail'
    } catch {
      status = 'ran'
    }
  }

  return {
    ...base,
    nodes: ctx.nodes,
    events: ctx.events,
    output: ran ? display(output) : null,
    error,
    aborted: ctx.getAborted(),
    resolvedTypes: { params: resolved, return: returnType },
    status,
  }
}

function run({ code, entry, cases, paramTypes, returnType }) {
  const { code: instrumented, topLevel } = instrument(code)

  const active = (cases || []).filter(c => c.input.trim().length > 0)
  if (active.length === 0) {
    return { mode: 'script', topLevel, results: [{ id: 'script', ...runScript(instrumented, topLevel) }] }
  }

  const resolved = topLevel.includes(entry) ? entry : topLevel[topLevel.length - 1]
  if (!resolved) {
    throw new Error('No top-level function to call. Declare one, or clear the test cases to run the code as a plain script.')
  }

  // The JSDoc header sits next to the code being run, so a node type declared there
  // beats a remembered metaData type — which may be stale, or simply wrong.
  const fromDoc = parseJsDocTypes(code)
  const pick = (declared, doc) => (isNodeType(doc) && !isNodeType(declared) ? doc : declared || doc)
  const count = Math.max(paramTypes?.length ?? 0, fromDoc.params.length)
  const types = {
    params: Array.from({ length: count }, (_, i) => pick(paramTypes?.[i] ?? '', fromDoc.params[i] ?? '')),
    return: pick(returnType ?? '', fromDoc.return),
  }

  const results = active.map(c => runCase(instrumented, topLevel, resolved, c, types))

  return {
    mode: 'cases',
    topLevel,
    entry: resolved,
    types: results[0]?.resolvedTypes ?? types,
    results,
  }
}

self.onmessage = e => {
  try {
    self.postMessage({ ok: true, ...run(e.data) })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
  }
}
