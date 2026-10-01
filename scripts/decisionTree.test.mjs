import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildDayTree, windowTree, treeRows, defaultCollapsed, describeEdge, dayOutcomes, nodeProgress, holdsOpen } from '../src/utils/decisionTree.js'
import { decisionToDays } from '../src/utils/days.js'

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

const resultIs = (dependency, values) => ({ op: 'result_is', dependency, values })

const authored = { assessment: '20260930T120000Z', at: '2026-09-30T12:00:00.000Z' }
const day = over => ({ dayVersion: 1, authoredBy: authored, ...over })

/**
 * Synthetic, and shaped like a real forecast: an unconditional first day, a
 * second day branching on its grade, a third branching on both.
 */
const days = [
  day({
    date: '2026-10-01',
    scenarios: [{
      id: 'main',
      priority: 0,
      label: 'Cousins + Jump Game II',
      when: { op: 'always' },
      items: [
        { type: 'problem', slug: 'cousins-in-binary-tree', title: 'Cousins in Binary Tree', kind: 'cold', minutes: 25 },
        { type: 'problem', slug: 'jump-game-ii', title: 'Jump Game II', kind: 'learn', minutes: 30 },
      ],
    }],
  }),
  day({
    date: '2026-10-02',
    dependencies: [{ id: 'cousins-oct1', slug: 'cousins-in-binary-tree', title: 'Cousins in Binary Tree', date: '2026-10-01', mode: 'cold' }],
    scenarios: [
      {
        id: 'cousins-red',
        priority: 0,
        label: 'Repair',
        when: resultIs('cousins-oct1', ['red']),
        items: [{ type: 'problem', slug: 'cousins-in-binary-tree', title: 'Cousins', kind: 'repair', minutes: 25 }],
      },
      {
        id: 'diameter',
        priority: 1,
        label: 'Diameter baseline',
        when: resultIs('cousins-oct1', ['green', 'yellow']),
        items: [{ type: 'problem', slug: 'diameter-of-binary-tree', title: 'Diameter', kind: 'cold', minutes: 20 }],
      },
    ],
  }),
  day({
    date: '2026-10-03',
    dependencies: [
      { id: 'cousins-oct1', slug: 'cousins-in-binary-tree', title: 'Cousins in Binary Tree', date: '2026-10-01', mode: 'cold' },
      { id: 'diameter-oct2', slug: 'diameter-of-binary-tree', title: 'Diameter', date: '2026-10-02', mode: 'cold' },
    ],
    scenarios: [
      {
        id: 'recovery-test',
        priority: 0,
        label: 'Retest Cousins',
        when: { op: 'all', of: [resultIs('cousins-oct1', ['red']), resultIs('diameter-oct2', ['green'])] },
        items: [{ type: 'problem', slug: 'cousins-in-binary-tree', title: 'Cousins', kind: 'cold', minutes: 25 }],
      },
      {
        id: 'clean',
        priority: 1,
        label: 'Clean',
        when: { op: 'all', of: [resultIs('cousins-oct1', ['green', 'yellow']), resultIs('diameter-oct2', ['green', 'yellow'])] },
        items: [{ type: 'problem', slug: 'largest-rectangle-in-histogram', title: 'Histogram', kind: 'cold', minutes: 35 }],
      },
    ],
  }),
]

const attempt = (over = {}) => ({
  slug: 'cousins-in-binary-tree',
  date: '2026-10-01',
  mode: 'cold',
  result: 'green',
  help: 'none',
  sessionRepeat: false,
  ...over,
})

const byId = tree => Object.fromEntries(tree.nodes.map(n => [n.id, n]))

test('a day written as always is the root', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  assert.equal(tree.roots.length, 1)
  assert.equal(tree.roots[0].id, '2026-10-01:main')
  assert.equal(tree.roots[0].edge, null, 'an unconditional day is reached by no branch')
})

test('days are read in date order, however they arrive', () => {
  const tree = buildDayTree([...days].reverse(), { practiceLog: [] })
  assert.deepEqual(tree.dates.map(d => d.date), ['2026-10-01', '2026-10-02', '2026-10-03'])
  assert.equal(tree.roots[0].id, '2026-10-01:main')
})

test('a day branching on the root grade hangs off the problem it grades', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const root = tree.roots[0]
  assert.deepEqual(root.children.map(c => c.id), ['2026-10-02:cousins-red', '2026-10-02:diameter'])
  assert.equal(root.children[0].edgeApproximate, false)
})

test('the branch label and colour come from the condition, not the prose label', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const [red, pass] = tree.roots[0].children
  assert.equal(red.edge.tone, 'red')
  assert.deepEqual(red.edge.clauses.map(c => c.label), ['red'])
  assert.equal(pass.edge.tone, 'emerald')
  assert.deepEqual(pass.edge.clauses.map(c => c.label), ['green / yellow'])
})

test('a branch waiting on two problems keeps their conditions apart', () => {
  // Merged into one set these two read identically, though they are opposites.
  const deps = [
    { id: 'jump', slug: 'jump-game-ii', title: 'Jump Game II' },
    { id: 'tree', slug: 'diameter-of-binary-tree', title: 'Diameter of Binary Tree' },
  ]
  const jumpRed = describeEdge(
    { op: 'all', of: [resultIs('jump', ['red']), resultIs('tree', ['green', 'yellow'])] }, deps)
  const treeRed = describeEdge(
    { op: 'all', of: [resultIs('tree', ['red']), resultIs('jump', ['green', 'yellow'])] }, deps)

  assert.deepEqual(jumpRed.clauses.map(c => `${c.title}: ${c.label}`),
    ['Jump Game II: red', 'Diameter of Binary Tree: green / yellow'])
  assert.deepEqual(treeRed.clauses.map(c => `${c.title}: ${c.label}`),
    ['Jump Game II: green / yellow', 'Diameter of Binary Tree: red'])
})

test('clauses follow the day\'s dependencies, so a position always means one problem', () => {
  // The second branch names the Tree check first. Read in that order the two
  // branches would both show "red, green / yellow" and be indistinguishable.
  const deps = [
    { id: 'jump', slug: 'jump-game-ii', title: 'Jump Game II' },
    { id: 'tree', slug: 'diameter-of-binary-tree', title: 'Diameter of Binary Tree' },
  ]
  const jumpRed = describeEdge(
    { op: 'all', of: [resultIs('jump', ['red']), resultIs('tree', ['green', 'yellow'])] }, deps)
  const treeRed = describeEdge(
    { op: 'all', of: [resultIs('tree', ['red']), resultIs('jump', ['green', 'yellow'])] }, deps)

  assert.deepEqual(jumpRed.clauses.map(c => c.label), ['red', 'green / yellow'])
  assert.deepEqual(treeRed.clauses.map(c => c.label), ['green / yellow', 'red'])
  assert.deepEqual(jumpRed.clauses.map(c => c.dependency), ['jump', 'tree'])
  assert.deepEqual(treeRed.clauses.map(c => c.dependency), ['jump', 'tree'])
})

test('every branch of a day is told apart by its clauses alone', () => {
  const deps = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
  const outcomes = [['red'], ['green', 'yellow'], ['not_completed']]
  const seen = new Set()
  for (const x of outcomes) {
    for (const y of outcomes) {
      // Written either way round, as a real forecast does.
      for (const when of [
        { op: 'all', of: [resultIs('a', x), resultIs('b', y)] },
        { op: 'all', of: [resultIs('b', y), resultIs('a', x)] },
      ]) {
        seen.add(describeEdge(when, deps).clauses.map(c => c.label).join('|'))
      }
    }
  }
  assert.equal(seen.size, outcomes.length * outcomes.length)
})

test('a branch takes the graver colour of the results it waits on', () => {
  const edge = describeEdge(
    { op: 'all', of: [resultIs('a', ['green']), resultIs('b', ['red'])] }, [])
  assert.equal(edge.tone, 'red')
  assert.deepEqual(edge.clauses.map(c => c.tone), ['emerald', 'red'])
})

test('a third day attaches to the second whose condition it repeats', () => {
  const nodes = byId(buildDayTree(days, { practiceLog: [] }))
  assert.equal(nodes['2026-10-03:recovery-test'].parentId, '2026-10-02:cousins-red')
  assert.equal(nodes['2026-10-03:clean'].parentId, '2026-10-02:diameter')
})

test('only the term the child adds becomes its branch', () => {
  const nodes = byId(buildDayTree(days, { practiceLog: [] }))
  // Its own condition also names Thursday's Cousins, but that is the parent's.
  assert.deepEqual(nodes['2026-10-03:clean'].edge.clauses.map(c => c.label), ['green / yellow'])
  assert.deepEqual(nodes['2026-10-03:recovery-test'].edge.clauses.map(c => c.label), ['green'])
})

test('with nothing recorded every branch is open and none is ruled out', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  assert.equal(tree.roots[0].state, 'taken')
  assert.deepEqual(tree.nodes.filter(n => n.depth > 0).map(n => n.state), ['open', 'open', 'open', 'open'])
})

test('a recorded grade takes one branch and rules out its sibling', () => {
  const nodes = byId(buildDayTree(days, { practiceLog: [attempt({ result: 'green' })] }))
  assert.equal(nodes['2026-10-02:diameter'].state, 'taken')
  assert.equal(nodes['2026-10-02:cousins-red'].state, 'ruled-out')
  assert.equal(nodes['2026-10-03:recovery-test'].state, 'ruled-out', 'a branch under a ruled-out parent cannot be reached')
})

test('state is the resolver\'s, so the tree cannot disagree with the day panel', () => {
  const log = [attempt({ result: 'red' })]
  const nodes = byId(buildDayTree(days, { practiceLog: log }))
  assert.equal(nodes['2026-10-02:cousins-red'].state, 'taken')
  assert.equal(nodes['2026-10-02:cousins-red'].dayView.selected.id, 'cousins-red')
})

test('a prose day is one node, because its alternatives are not checkable', () => {
  const legacy = decisionToDays(fixture('coaching-decision.legacy-prose.example.json'))
  const tree = buildDayTree(legacy, { practiceLog: [] })
  assert.ok(tree.nodes.length > 0)
  assert.deepEqual(tree.dates.map(d => d.count), tree.dates.map(() => 1))
})

test('rows nest children inside their parent, with the guides to draw them', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const rows = treeRows(tree.roots)

  assert.deepEqual(rows.map(r => r.node.id), ['2026-10-01:main'])
  const [red, pass] = rows[0].children
  assert.deepEqual([red.node.id, pass.node.id], ['2026-10-02:cousins-red', '2026-10-02:diameter'])
  assert.deepEqual([red.depth, pass.depth], [1, 1])

  // A root sits in no indent column, so its children need no ancestor guide.
  assert.deepEqual(red.guides, [])
  // Under the first of two siblings the trunk continues; under the last it stops.
  assert.deepEqual(red.children[0].guides, [true])
  assert.deepEqual(pass.children[0].guides, [false])
  assert.equal(red.last, false)
  assert.equal(pass.last, true)
  assert.equal(red.hasChildren, true)
  assert.equal(red.children[0].hasChildren, false)
})

test('every node is present whatever is folded, so a subtree can animate shut', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const count = rows => rows.reduce((n, r) => n + 1 + count(r.children), 0)
  assert.equal(count(treeRows(tree.roots)), tree.nodes.length)
})

test('by default the taken path is open and the alternatives are folded shut', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const collapsed = defaultCollapsed(tree.roots)

  const visible = rows => rows.flatMap(r =>
    [r.node.id, ...(collapsed.has(r.node.id) ? [] : visible(r.children))])

  assert.deepEqual(visible(treeRows(tree.roots)), [
    '2026-10-01:main',
    '2026-10-02:cousins-red',
    '2026-10-02:diameter',
  ])
})

test('the days up to today are held open, whatever branch they sit on', () => {
  // Nothing is recorded, so no Friday branch is taken. Thursday still has to
  // show them: it is the day itself, not the branch, that cannot be hidden.
  const tree = buildDayTree(days, { practiceLog: [] })
  const root = tree.roots[0]
  assert.equal(holdsOpen(root, '2026-10-02'), true)
  assert.equal(defaultCollapsed(tree.roots, '2026-10-02').has(root.id), false)
})

test('a day still ahead stays foldable', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const root = tree.roots[0]
  assert.equal(holdsOpen(root, '2026-10-01'), false, 'Friday has not arrived yet')
  assert.equal(holdsOpen(root.children[0], '2026-10-02'), false, 'nor has Saturday')
})

test('a leaf holds nothing open, having nothing below it', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const leaf = tree.roots[0].children[0].children[0]
  assert.equal(holdsOpen(leaf, '2026-10-09'), false)
})

test('an unconditional branch has no edge to describe', () => {
  assert.equal(describeEdge(null), null)
  assert.equal(describeEdge({ op: 'always' }), null)
})

test('a condition with no result still gets honest wording', () => {
  assert.deepEqual(describeEdge({ op: 'unresolved_failure', scope: { topic: 'Stack' } }).clauses.map(c => c.label),
    ['still failing'])
  assert.deepEqual(describeEdge({ op: 'recheck_due', slug: 'decode-string' }).clauses.map(c => c.label),
    ['recheck due'])
})

test('not completed reads as its own outcome rather than a failure', () => {
  const edge = describeEdge({ op: 'not_completed', dependency: 'cousins-oct1' })
  assert.equal(edge.clauses[0].label, 'not completed')
  assert.equal(edge.tone, 'slate')
})

test('no days is an empty tree rather than an error', () => {
  assert.deepEqual(buildDayTree([], {}), { roots: [], nodes: [], dates: [] })
  assert.deepEqual(buildDayTree(undefined, {}), { roots: [], nodes: [], dates: [] })
})

test('a day with no date is skipped rather than given one', () => {
  assert.deepEqual(buildDayTree([{ scenarios: [] }], {}).nodes, [])
})

test("a day's verdict is the grades it recorded, worst first", () => {
  const recorded = [
    { slug: 'a', attempts: [{ result: 'green' }] },
    { slug: 'b', attempts: [{ result: 'red' }] },
    { slug: 'c', attempts: [{ result: 'green' }] },
  ]
  assert.deepEqual(dayOutcomes(recorded), ['red', 'green'])
})

test('a problem attempted twice in a day contributes both grades', () => {
  const recorded = [{ slug: 'a', attempts: [{ result: 'red' }, { result: 'green', sessionRepeat: true }] }]
  assert.deepEqual(dayOutcomes(recorded), ['red', 'green'])
})

test('an explicit skip is the only thing that reads as not completed', () => {
  assert.deepEqual(dayOutcomes([{ slug: 'a', attempts: [{ result: 'skipped' }] }]), ['not_completed'])
  assert.deepEqual(dayOutcomes([{ slug: 'a', attempts: [{ skipped: true, result: null }] }]), ['not_completed'])
})

test('work with no grade is not a verdict, and absence is not a skip', () => {
  // Solving and revising are activity. Neither grades anything, and a day with
  // none of either proves nothing about whether the work was skipped.
  assert.deepEqual(dayOutcomes([{ slug: 'a', attempts: [], solved: true, revised: true }]), [])
  assert.deepEqual(dayOutcomes([]), [])
})

test('a node reports how much of its own plan is recorded', () => {
  const log = [attempt({ slug: 'cousins-in-binary-tree' })]
  const root = buildDayTree(days, { practiceLog: log }).roots[0]
  assert.deepEqual(nodeProgress(root, '2026-10-01'), { done: 1, total: 2, complete: false })
})

test('a day is complete once every problem it planned is recorded', () => {
  const log = [
    attempt({ slug: 'cousins-in-binary-tree' }),
    attempt({ slug: 'jump-game-ii' }),
  ]
  const root = buildDayTree(days, { practiceLog: log }).roots[0]
  assert.deepEqual(nodeProgress(root, '2026-10-01'), { done: 2, total: 2, complete: true })
})

test('a past day that planned no problems is settled, having nothing left to record', () => {
  const node = { date: '2026-09-30', items: [{ type: 'action', title: 'Stop for today' }] }
  assert.deepEqual(nodeProgress(node, '2026-10-01'), { done: 0, total: 0, complete: true })
})

test('today is not settled by planning nothing, because it can still be worked', () => {
  const node = { date: '2026-10-01', items: [{ type: 'action', title: 'Stop for today' }] }
  assert.equal(nodeProgress(node, '2026-10-01').complete, false)
})

test('an earlier day is a root that the days branching on it hang from', () => {
  // What used to be the assessment's own day is now just the first day there
  // is. Nothing special marks it, and nothing has to bridge two shapes.
  const earlier = day({
    date: '2026-09-30',
    scenarios: [{
      id: 'main',
      when: { op: 'always' },
      items: [{ type: 'problem', slug: 'next-greater-element-ii', title: 'NGE II', kind: 'cold' }],
    }],
  })
  const tree = buildDayTree([earlier, ...days], { practiceLog: [] })
  assert.equal(tree.roots.length, 1)
  assert.equal(tree.roots[0].id, '2026-09-30:main')
  assert.deepEqual(tree.roots[0].children.map(c => c.id), ['2026-10-01:main'])
})

test('an action never counts as done, having nothing that could record it', () => {
  // The tracker grades problems. An action is guidance, so claiming either
  // state for it would be asserting something no evidence can support.
  const withAction = day({
    date: '2026-10-01',
    scenarios: [{
      id: 'main',
      when: { op: 'always' },
      items: [
        { type: 'problem', slug: 'cousins-in-binary-tree', title: 'Cousins', kind: 'cold' },
        { type: 'action', title: 'Record the result, then stop' },
      ],
    }],
  })
  const log = [attempt({ slug: 'cousins-in-binary-tree', date: '2026-10-01' })]
  const root = buildDayTree([withAction], { practiceLog: log }).roots[0]
  assert.deepEqual(root.items.map(i => i.done), [true, false])
  assert.deepEqual(nodeProgress(root, '2026-10-02'), { done: 1, total: 1, complete: true },
    'and it is not outstanding work holding the day open')
})

/* ---------- The window ---------- */

test('a branch repeating the day headline is named by what it asks for', () => {
  // The headline is already shown beside the node, so echoing it there costs a
  // line and says nothing about the branch.
  const echoed = day({
    date: '2026-10-01',
    headline: 'Mixed — Greedy focus and Tree sampling',
    scenarios: [{
      id: 'main',
      when: { op: 'always' },
      label: 'Mixed — Greedy focus and Tree sampling',
      items: [
        { type: 'problem', slug: 'cousins-in-binary-tree', title: 'Cousins in Binary Tree' },
        { type: 'action', title: 'Stop for today' },
      ],
    }],
  })
  const root = buildDayTree([echoed], { practiceLog: [] }).roots[0]
  assert.equal(root.label, 'Cousins in Binary Tree')
})

test('a branch with a label of its own keeps it', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  assert.equal(tree.roots[0].label, 'Cousins + Jump Game II')
})

test('a branch planning only actions is named by them, having nothing else', () => {
  const resting = day({
    date: '2026-10-04',
    headline: 'Rest',
    scenarios: [{ id: 'rest', when: { op: 'always' }, label: 'Rest', items: [{ type: 'action', title: 'Rest day' }] }],
  })
  assert.equal(buildDayTree([resting], { practiceLog: [] }).roots[0].label, 'Rest day')
})
test('a window shows the days it covers and drops the rest', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const view = windowTree(tree, ['2026-10-02', '2026-10-03'])
  assert.deepEqual([...new Set(view.nodes.map(n => n.date))], ['2026-10-02', '2026-10-03'])
  assert.deepEqual(view.dates.map(d => d.date), ['2026-10-02', '2026-10-03'])
})

test('a node whose parent fell outside the window becomes a root', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const view = windowTree(tree, ['2026-10-02', '2026-10-03'])
  assert.deepEqual(view.roots.map(n => n.id), ['2026-10-02:cousins-red', '2026-10-02:diameter'])
  assert.deepEqual(view.roots[0].children.map(n => n.id), ['2026-10-03:recovery-test'])
})

test('indentation restarts at the window, not at the tree', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  const view = windowTree(tree, ['2026-10-02', '2026-10-03'])
  assert.deepEqual(view.nodes.map(n => n.depth), [0, 0, 1, 1])
})

test('a branch keeps its condition and state through the window', () => {
  const tree = buildDayTree(days, { practiceLog: [attempt({ result: 'green' })] })
  const view = windowTree(tree, ['2026-10-02', '2026-10-03'])
  const [red, pass] = view.roots
  assert.equal(red.state, 'ruled-out')
  assert.equal(pass.state, 'taken')
  assert.deepEqual(pass.edge.clauses.map(c => c.label), ['green / yellow'])
})

test('a window covering nothing is empty rather than everything', () => {
  const tree = buildDayTree(days, { practiceLog: [] })
  assert.deepEqual(windowTree(tree, []), { roots: [], nodes: [], dates: [] })
})
