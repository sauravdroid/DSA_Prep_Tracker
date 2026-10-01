import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildDecisionTree, flattenTree, defaultCollapsed, describeEdge } from '../src/utils/decisionTree.js'

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

test('rows carry the guides needed to draw the lines running past them', () => {
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  const rows = flattenTree(tree.roots, () => true)
  assert.deepEqual(rows.map(r => r.node.id), [
    '2026-10-01:main',
    '2026-10-02:cousins-red',
    '2026-10-03:recovery-test',
    '2026-10-02:diameter',
    '2026-10-03:clean',
  ])
  // A root sits in no indent column, so its children need no ancestor guide.
  assert.deepEqual(rows[1].guides, [])
  // Under the first of two siblings the trunk continues; under the last it stops.
  assert.deepEqual(rows[2].guides, [true])
  assert.deepEqual(rows[4].guides, [false])
  assert.deepEqual(rows.map(r => r.depth), [0, 1, 2, 1, 2])
  assert.equal(rows[1].last, false)
  assert.equal(rows[3].last, true)
})

test('a collapsed node hides its subtree and nothing else', () => {
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  const rows = flattenTree(tree.roots, id => id !== '2026-10-02:cousins-red')
  assert.deepEqual(rows.map(r => r.node.id), [
    '2026-10-01:main',
    '2026-10-02:cousins-red',
    '2026-10-02:diameter',
    '2026-10-03:clean',
  ])
})

test('by default the taken path is open and the alternatives are folded shut', () => {
  const tree = buildDecisionTree(decision, { practiceLog: [] })
  const collapsed = defaultCollapsed(tree.roots)
  const rows = flattenTree(tree.roots, id => !collapsed.has(id))
  assert.deepEqual(rows.map(r => r.node.id), [
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
