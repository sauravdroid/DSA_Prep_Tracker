import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildDecisionTree, treeRows, defaultCollapsed, describeEdge, dayOutcomes, nodeProgress } from '../src/utils/decisionTree.js'

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

const resultIs = (dependency, values) => ({ op: 'result_is', dependency, values })

/**
 * Synthetic, and shaped like a real forecast: an unconditional first day, a
 * second day branching on its grade, a third branching on both.
 */
const decision = {
  nextThreeDays: [
    {
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
    },
    {
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
    },
    {
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
    },
  ],
}

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
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  assert.equal(tree.roots.length, 1)
  assert.equal(tree.roots[0].id, '2026-10-01:main')
  assert.equal(tree.roots[0].edge, null, 'an unconditional day is reached by no branch')
})

test('a day branching on the root grade hangs off the problem it grades', () => {
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  const root = tree.roots[0]
  assert.deepEqual(root.children.map(c => c.id), ['2026-10-02:cousins-red', '2026-10-02:diameter'])
  assert.equal(root.children[0].edgeApproximate, false)
})

test('the branch label and colour come from the condition, not the prose label', () => {
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  const [red, pass] = tree.roots[0].children
  assert.deepEqual(red.edge, { tone: 'red', label: 'red', results: ['red'] })
  assert.deepEqual(pass.edge, { tone: 'emerald', label: 'green / yellow', results: ['green', 'yellow'] })
})

test('a third day attaches to the second whose condition it repeats', () => {
  const nodes = byId(buildDecisionTree(decision, { practiceLog: [] }))
  assert.equal(nodes['2026-10-03:recovery-test'].parentId, '2026-10-02:cousins-red')
  assert.equal(nodes['2026-10-03:clean'].parentId, '2026-10-02:diameter')
})

test('only the term the child adds becomes its branch', () => {
  const nodes = byId(buildDecisionTree(decision, { practiceLog: [] }))
  // Its own condition also names Monday's Cousins, but that is the parent's.
  assert.equal(nodes['2026-10-03:clean'].edge.label, 'green / yellow')
  assert.equal(nodes['2026-10-03:recovery-test'].edge.label, 'green')
})

test('with nothing recorded every branch is open and none is ruled out', () => {
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  assert.equal(tree.roots[0].state, 'taken')
  assert.deepEqual(tree.nodes.filter(n => n.depth > 0).map(n => n.state), ['open', 'open', 'open', 'open'])
})

test('a recorded grade takes one branch and rules out its sibling', () => {
  const nodes = byId(buildDecisionTree(decision, { practiceLog: [attempt({ result: 'green' })] }))
  assert.equal(nodes['2026-10-02:diameter'].state, 'taken')
  assert.equal(nodes['2026-10-02:cousins-red'].state, 'ruled-out')
  assert.equal(nodes['2026-10-03:recovery-test'].state, 'ruled-out', 'a branch under a ruled-out parent cannot be reached')
})

test('state is the resolver\'s, so the tree cannot disagree with the day panel', () => {
  const log = [attempt({ result: 'red' })]
  const nodes = byId(buildDecisionTree(decision, { practiceLog: log }))
  assert.equal(nodes['2026-10-02:cousins-red'].state, 'taken')
  assert.equal(nodes['2026-10-02:cousins-red'].dayView.selected.id, 'cousins-red')
})

test('a prose day is one node, because its alternatives are not checkable', () => {
  const legacy = fixture('coaching-decision.legacy-prose.example.json')
  const tree = buildDecisionTree(legacy, { practiceLog: [] })
  assert.ok(tree.nodes.length > 0)
  assert.deepEqual(tree.dates.map(d => d.count), tree.dates.map(() => 1))
})

test('rows nest children inside their parent, with the guides to draw them', () => {
  const tree = buildDecisionTree(decision, { practiceLog: [] })
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
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  const count = rows => rows.reduce((n, r) => n + 1 + count(r.children), 0)
  assert.equal(count(treeRows(tree.roots)), tree.nodes.length)
})

test('by default the taken path is open and the alternatives are folded shut', () => {
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  const collapsed = defaultCollapsed(tree.roots)

  const visible = rows => rows.flatMap(r =>
    [r.node.id, ...(collapsed.has(r.node.id) ? [] : visible(r.children))])

  assert.deepEqual(visible(treeRows(tree.roots)), [
    '2026-10-01:main',
    '2026-10-02:cousins-red',
    '2026-10-02:diameter',
  ])
})

test('an unconditional branch has no edge to describe', () => {
  assert.equal(describeEdge(null), null)
  assert.equal(describeEdge({ op: 'always' }), null)
})

test('a condition with no result still gets honest wording', () => {
  assert.deepEqual(describeEdge({ op: 'unresolved_failure', scope: { topic: 'Stack' } }),
    { tone: 'red', label: 'still failing', results: [] })
  assert.deepEqual(describeEdge({ op: 'recheck_due', slug: 'decode-string' }),
    { tone: 'amber', label: 'recheck due', results: [] })
})

test('not completed reads as its own outcome rather than a failure', () => {
  const edge = describeEdge({ op: 'not_completed', dependency: 'cousins-oct1' })
  assert.equal(edge.label, 'not completed')
  assert.equal(edge.tone, 'slate')
})

test('an empty forecast is an empty tree rather than an error', () => {
  assert.deepEqual(buildDecisionTree(null, {}), { roots: [], nodes: [], dates: [] })
})

test("a day's verdict is the grades it recorded, worst first", () => {
  const day = [
    { slug: 'a', attempts: [{ result: 'green' }] },
    { slug: 'b', attempts: [{ result: 'red' }] },
    { slug: 'c', attempts: [{ result: 'green' }] },
  ]
  assert.deepEqual(dayOutcomes(day), ['red', 'green'])
})

test('a problem attempted twice in a day contributes both grades', () => {
  const day = [{ slug: 'a', attempts: [{ result: 'red' }, { result: 'green', sessionRepeat: true }] }]
  assert.deepEqual(dayOutcomes(day), ['red', 'green'])
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
  const root = buildDecisionTree(decision, { practiceLog: log }).roots[0]
  assert.deepEqual(nodeProgress(root), { done: 1, total: 2, complete: false })
})

test('a day is complete once every problem it planned is recorded', () => {
  const log = [
    attempt({ slug: 'cousins-in-binary-tree' }),
    attempt({ slug: 'jump-game-ii' }),
  ]
  const root = buildDecisionTree(decision, { practiceLog: log }).roots[0]
  assert.deepEqual(nodeProgress(root), { done: 2, total: 2, complete: true })
})

test('a day planning no problems is never complete, having nothing to finish', () => {
  assert.deepEqual(
    nodeProgress({ items: [{ type: 'action', title: 'Stop for today' }] }),
    { done: 0, total: 0, complete: false }
  )
})

test('a plan adopted today gets a node for today, which the forecast does not cover', () => {
  const adopted = {
    assessmentDate: '2026-09-30',
    mode: { headline: 'Mixed — one Stack baseline' },
    today: {
      doNow: { slug: 'cousins-in-binary-tree', title: 'Cousins in Binary Tree', mode: 'cold', minutes: 25 },
      then: { action: 'Record the result' },
    },
    ...decision,
  }
  const tree = buildDecisionTree(adopted, { practiceLog: [] })
  assert.equal(tree.roots.length, 1)
  assert.equal(tree.roots[0].id, '2026-09-30:today')
  assert.equal(tree.roots[0].state, 'taken')
  assert.deepEqual(tree.roots[0].items.map(i => i.type), ['problem', 'action'])
  // The first forecast day grades that problem, so it branches off it.
  assert.deepEqual(tree.roots[0].children.map(c => c.id), ['2026-10-01:main'])
})

test('the assessment day is not repeated when the forecast already covers it', () => {
  const overlapping = {
    assessmentDate: '2026-10-01',
    today: { doNow: { slug: 'cousins-in-binary-tree', title: 'Cousins', mode: 'cold' } },
    ...decision,
  }
  const tree = buildDecisionTree(overlapping, { practiceLog: [] })
  assert.deepEqual(tree.dates.map(d => d.date), ['2026-10-01', '2026-10-02', '2026-10-03'])
})
