import { parse } from 'acorn'
import { generate } from 'astring'

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

function isNode(value) {
  return value && typeof value === 'object' && typeof value.type === 'string'
}

function walk(node, visit, parent, key) {
  if (!isNode(node)) return
  visit(node, parent, key)
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'loc' || k === 'range') continue
    const child = node[k]
    if (Array.isArray(child)) {
      for (const item of child) walk(item, visit, node, k)
    } else {
      walk(child, visit, node, k)
    }
  }
}

function inferName(node, parent) {
  if (node.id?.name) return node.id.name
  if (!parent) return '(anonymous)'
  if (parent.type === 'VariableDeclarator' && parent.id?.name) return parent.id.name
  if (parent.type === 'Property' && (parent.key?.name || parent.key?.value)) {
    return String(parent.key.name ?? parent.key.value)
  }
  if (parent.type === 'MethodDefinition' && (parent.key?.name || parent.key?.value)) {
    return String(parent.key.name ?? parent.key.value)
  }
  if (parent.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') {
    return parent.left.name
  }
  return '(anonymous)'
}

function ident(name) {
  return { type: 'Identifier', name }
}

function literal(value) {
  return { type: 'Literal', value }
}

function tracerCall(method, args) {
  return {
    type: 'CallExpression',
    optional: false,
    callee: {
      type: 'MemberExpression',
      computed: false,
      optional: false,
      object: ident('__T'),
      property: ident(method),
    },
    arguments: args,
  }
}

// Builds the array expression capturing argument values at call time. Destructured
// params have no single binding to read, so they're recorded as a placeholder.
function buildArgsArray(params) {
  const elements = []
  for (const p of params) {
    if (p.type === 'Identifier') {
      elements.push(ident(p.name))
    } else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
      elements.push(ident(p.left.name))
    } else if (p.type === 'RestElement' && p.argument.type === 'Identifier') {
      elements.push({ type: 'SpreadElement', argument: ident(p.argument.name) })
    } else {
      elements.push(literal('\u2026'))
    }
  }
  return { type: 'ArrayExpression', elements }
}

// Rewrites `return X` to `return __T.ret(__c, X)` for this function only —
// the walk stops at nested function boundaries so inner returns keep their own frame.
function rewriteReturns(node, cidName) {
  if (!isNode(node)) return
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'loc' || k === 'range') continue
    const child = node[k]
    const handle = c => {
      if (!isNode(c)) return
      if (FUNCTION_TYPES.has(c.type)) return
      if (c.type === 'ReturnStatement') {
        c.argument = tracerCall('ret', [ident(cidName), c.argument || ident('undefined')])
      }
      rewriteReturns(c, cidName)
    }
    if (Array.isArray(child)) child.forEach(handle)
    else handle(child)
  }
}

const BODY_KEYS = {
  IfStatement: ['consequent', 'alternate'],
  ForStatement: ['body'],
  ForInStatement: ['body'],
  ForOfStatement: ['body'],
  WhileStatement: ['body'],
  DoWhileStatement: ['body'],
  LabeledStatement: ['body'],
}

// `if (n <= 1) return n;` has no block to inject a line marker into, so give it one.
function ensureBlock(parent, key) {
  const stmt = parent[key]
  if (!stmt || stmt.type === 'BlockStatement' || stmt.type === 'FunctionDeclaration') return
  parent[key] = { type: 'BlockStatement', body: [stmt], loc: stmt.loc }
}

const MAX_WATCHED = 16

function collectPatternNames(node, out) {
  if (!isNode(node)) return
  switch (node.type) {
    case 'Identifier': out.push(node.name); break
    case 'ObjectPattern': node.properties.forEach(p => collectPatternNames(p.value ?? p.argument, out)); break
    case 'ArrayPattern': node.elements.forEach(e => collectPatternNames(e, out)); break
    case 'AssignmentPattern': collectPatternNames(node.left, out); break
    case 'RestElement': collectPatternNames(node.argument, out); break
    case 'Property': collectPatternNames(node.value, out); break
    default: break
  }
}

function declaredNames(stmt) {
  const names = []
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) collectPatternNames(d.id, names)
  } else if ((stmt.type === 'ClassDeclaration' || stmt.type === 'FunctionDeclaration') && stmt.id) {
    names.push(stmt.id.name)
  }
  return names
}

// Reads only names already declared at this point, so `let` bindings are never
// touched inside their temporal dead zone.
function atStatement(line, scope) {
  const args = [literal(line)]
  // Keep the innermost bindings when there are too many: loop-local names are
  // what you are actually watching, outer params rarely change.
  const names = [...new Set(scope)].slice(-MAX_WATCHED)
  if (names.length > 0) {
    args.push({
      type: 'ObjectExpression',
      properties: names.map(n => ({
        type: 'Property',
        kind: 'init',
        method: false,
        shorthand: false,
        computed: false,
        key: literal(n),
        value: ident(n),
      })),
    })
  }
  return { type: 'ExpressionStatement', expression: tracerCall('at', args) }
}

function loopBindings(node) {
  const names = []
  if (node.type === 'ForStatement' && node.init?.type === 'VariableDeclaration') {
    names.push(...declaredNames(node.init))
  } else if ((node.type === 'ForOfStatement' || node.type === 'ForInStatement') && node.left?.type === 'VariableDeclaration') {
    names.push(...declaredNames(node.left))
  } else if (node.type === 'CatchClause' && node.param) {
    collectPatternNames(node.param, names)
  }
  return names
}

// Injects `__T.at(line, {vars})` before every statement in this function. Nested
// functions are not descended into — instead their enclosing scope is recorded so
// they can watch the closure variables they actually operate on.
function insertLineMarkers(node, scope, captured) {
  if (!isNode(node)) return
  if (FUNCTION_TYPES.has(node.type)) {
    captured.set(node, [...scope])
    return
  }

  const bodyKeys = BODY_KEYS[node.type]
  if (bodyKeys) for (const k of bodyKeys) ensureBlock(node, k)

  const inner = [...scope, ...loopBindings(node)]

  if (node.type === 'BlockStatement' || node.type === 'SwitchCase') {
    const key = node.type === 'SwitchCase' ? 'consequent' : 'body'
    const original = node[key]
    const visible = [...inner]
    const out = []
    for (const stmt of original) {
      const line = stmt.loc?.start.line
      if (line) out.push(atStatement(line, visible))
      insertLineMarkers(stmt, visible, captured)
      visible.push(...declaredNames(stmt))
      out.push(stmt)
    }
    node[key] = out
    return
  }

  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'loc' || k === 'range') continue
    const child = node[k]
    if (Array.isArray(child)) child.forEach(c => insertLineMarkers(c, inner, captured))
    else insertLineMarkers(child, inner, captured)
  }
}

function isFunctionInit(node) {
  return node && (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
}

// Names the test-case runner can call as an entry point.
function collectTopLevel(ast) {
  const names = []
  for (const stmt of ast.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
      names.push(stmt.id.name)
    } else if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (d.id?.type === 'Identifier' && isFunctionInit(d.init)) names.push(d.id.name)
      }
    } else if (
      stmt.type === 'ExpressionStatement' &&
      stmt.expression.type === 'AssignmentExpression' &&
      stmt.expression.left.type === 'Identifier' &&
      isFunctionInit(stmt.expression.right)
    ) {
      names.push(stmt.expression.left.name)
    }
  }
  return names
}

// Collects identifiers that are actually read, ignoring property names and object keys
// so `obj.merge` does not count as a reference to a top-level `merge`.
function collectReferences(node, into) {
  if (!isNode(node)) return
  if (node.type === 'Identifier') {
    into.add(node.name)
    return
  }
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'loc' || k === 'range') continue
    if (node.type === 'MemberExpression' && k === 'property' && !node.computed) continue
    if (node.type === 'Property' && k === 'key' && !node.computed) continue
    const child = node[k]
    if (Array.isArray(child)) child.forEach(c => collectReferences(c, into))
    else collectReferences(child, into)
  }
}

// The entry point is the function nobody else calls — `mergeSort` rather than the
// `merge` helper it delegates to. Self-recursion does not disqualify a candidate.
function orderEntryCandidates(ast, topLevel) {
  if (topLevel.length <= 1) return topLevel
  const known = new Set(topLevel)
  const calledByOthers = new Set()

  for (const stmt of ast.body) {
    let name = null
    let fnNode = null
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
      name = stmt.id.name
      fnNode = stmt
    } else if (stmt.type === 'VariableDeclaration') {
      const d = stmt.declarations.find(x => x.id?.type === 'Identifier' && isFunctionInit(x.init))
      if (d) { name = d.id.name; fnNode = d.init }
    } else if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AssignmentExpression') {
      name = stmt.expression.left.name
      fnNode = stmt.expression.right
    }
    if (!fnNode) continue

    const refs = new Set()
    collectReferences(fnNode.body, refs)
    for (const r of refs) {
      if (known.has(r) && r !== name) calledByOthers.add(r)
    }
  }

  const roots = topLevel.filter(n => !calledByOthers.has(n))
  return [...roots, ...topLevel.filter(n => calledByOthers.has(n))]
}

export function instrument(code) {
  const ast = parse(code, { ecmaVersion: 'latest', locations: true })

  const targets = []
  walk(ast, (node, parent) => {
    if (FUNCTION_TYPES.has(node.type)) targets.push({ node, parent })
  })

  const functions = targets.map(({ node, parent }, i) => ({
    id: i,
    name: inferName(node, parent),
    line: node.loc?.start.line ?? 0,
  }))

  const topLevel = orderEntryCandidates(ast, collectTopLevel(ast))

  // Targets are pre-order, so an outer function always records the scope a nested
  // one closes over before that nested function is processed.
  const captured = new Map()

  targets.forEach(({ node }, i) => {
    const meta = functions[i]
    const cidName = `__c${i}`

    if (node.body.type !== 'BlockStatement') {
      node.body = {
        type: 'BlockStatement',
        body: [{ type: 'ReturnStatement', argument: node.body, loc: node.body.loc }],
      }
    }

    const paramNames = []
    for (const p of node.params) collectPatternNames(p, paramNames)
    insertLineMarkers(node.body, [...(captured.get(node) || []), ...paramNames], captured)
    rewriteReturns(node.body, cidName)

    const enter = {
      type: 'VariableDeclaration',
      kind: 'var',
      declarations: [{
        type: 'VariableDeclarator',
        id: ident(cidName),
        init: tracerCall('enter', [
          literal(meta.id),
          literal(meta.name),
          buildArgsArray(node.params),
          literal(meta.line),
        ]),
      }],
    }

    const wrapped = {
      type: 'TryStatement',
      block: { type: 'BlockStatement', body: node.body.body },
      handler: null,
      finalizer: {
        type: 'BlockStatement',
        body: [{
          type: 'ExpressionStatement',
          expression: tracerCall('leave', [ident(cidName)]),
        }],
      },
    }

    node.body.body = [enter, wrapped]
  })

  return { code: generate(ast), functions, topLevel }
}
