/**
 * The branch structure a saved forecast already describes, as a tree.
 *
 * Parentage is read from the conditions themselves rather than guessed: a later
 * day repeats its parent's condition verbatim inside an `all` and adds one more
 * term. Nothing here decides a branch — every node's state comes from
 * resolveOutlookDay, so the tree and the day panel can never disagree.
 */

import { resolveOutlookDay } from './outlook.js'

/** Reading order for branch labels: best outcome first. */
const RESULT_ORDER = ['green', 'yellow', 'red', 'not_completed']

/** Reading order for a day's verdict: the outcome that matters most, first. */
const OUTCOME_ORDER = ['red', 'not_completed', 'yellow', 'green']

export const RESULT_LABEL = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  not_completed: 'not completed',
}

export const RESULT_TONE = {
  green: 'emerald',
  yellow: 'amber',
  red: 'red',
  not_completed: 'slate',
}

/**
 * The outcomes a day actually recorded, worst first.
 *
 * Only an explicit skip counts as not completed. A day with no grade recorded
 * is a day with no grade recorded — that is not evidence the work was skipped,
 * and must never be displayed as though it were.
 */
export function dayOutcomes(done = []) {
  const found = new Set()
  for (const entry of done) {
    for (const a of entry.attempts || []) {
      if (a.skipped || a.result === 'skipped' || a.result === 'not_completed') found.add('not_completed')
      else if (a.result) found.add(a.result)
    }
  }
  return OUTCOME_ORDER.filter(r => found.has(r))
}

/**
 * How much of a node's planned problem work has been recorded against it.
 *
 * A day that planned no problems is settled once it has passed: there was
 * nothing to record against it, and now there never will be. Today is not
 * settled on those terms, because the day can still be worked.
 */
export function nodeProgress(node, today) {
  const problems = (node?.items || []).filter(i => i.type === 'problem')
  const done = problems.filter(i => i.done).length
  const complete = problems.length > 0
    ? done === problems.length
    : !!today && !!node?.date && node.date < today
  return { done, total: problems.length, complete }
}

/** Order-independent key, so two conditions that mean the same thing compare equal. */
export function conditionKey(pred) {
  if (pred === null || pred === undefined) return 'null'
  if (Array.isArray(pred)) return `[${pred.map(conditionKey).join(',')}]`
  if (typeof pred !== 'object') return JSON.stringify(pred)
  return `{${Object.keys(pred).sort().map(k => `${k}:${conditionKey(pred[k])}`).join(',')}}`
}

/** Conjuncts of a condition, so a parent's terms can be subtracted from a child's. */
function termsOf(pred) {
  if (!pred) return []
  return pred.op === 'all' ? pred.of || [] : [pred]
}

function resultsOf(pred) {
  if (!pred) return []
  if (pred.op === 'result_is') return pred.values || []
  if (pred.op === 'not_completed') return ['not_completed']
  if (pred.op === 'all' || pred.op === 'any') return (pred.of || []).flatMap(resultsOf)
  return []
}

function dependencyIds(pred) {
  if (!pred) return []
  if (pred.dependency) return [pred.dependency]
  if (pred.of) return pred.of.flatMap(dependencyIds)
  return []
}

/** Worst first, so a branch waiting on two results takes the graver colour. */
const TONE_ORDER = ['red', 'slate', 'amber', 'emerald']

function toneOf(found) {
  if (found.has('red')) return 'red'
  if (found.has('green')) return 'emerald'
  if (found.has('yellow')) return 'amber'
  return 'slate'
}

/**
 * The branch a condition represents, as one clause per result it waits on.
 *
 * A branch can turn on two different problems, and merging their results into
 * one set describes neither: "Jump Game II Red, Diameter Green" and "Diameter
 * Red, Jump Game II Green" are opposite branches that would read identically.
 *
 * Clauses are ordered by the day's dependencies rather than by the order the
 * condition happens to list them, so the same position always means the same
 * problem across every branch of that day — which is what lets the two be told
 * apart at a glance.
 *
 * Read from the structured condition, never from the scenario's prose label.
 */
export function describeEdge(pred, deps = []) {
  if (!pred || pred.op === 'always') return null

  const clauses = []
  for (const term of termsOf(pred)) {
    const found = new Set(resultsOf(term))
    const results = RESULT_ORDER.filter(r => found.has(r))
    const dep = deps.find(d => d.id === term.dependency)

    if (results.length > 0) {
      clauses.push({
        dependency: term.dependency || null,
        title: dep?.title || dep?.slug || null,
        results,
        label: results.map(r => RESULT_LABEL[r]).join(' / '),
        tone: toneOf(found),
      })
    } else if (term.op === 'unresolved_failure') {
      clauses.push({ dependency: null, title: null, results: [], label: 'still failing', tone: 'red' })
    } else if (term.op === 'recheck_due') {
      clauses.push({ dependency: null, title: null, results: [], label: 'recheck due', tone: 'amber' })
    } else {
      clauses.push({ dependency: null, title: null, results: [], label: 'otherwise', tone: 'slate' })
    }
  }

  if (clauses.length === 0) return null

  const rank = c => {
    const i = deps.findIndex(d => d.id === c.dependency)
    return i < 0 ? deps.length : i
  }
  clauses.sort((a, b) => rank(a) - rank(b))

  return {
    tone: TONE_ORDER.find(t => clauses.some(c => c.tone === t)) || 'slate',
    clauses,
    label: clauses.map(c => c.label).join(' · '),
  }
}

/** Remaining conjuncts once the parent's are removed, as one condition again. */
function restCondition(rest) {
  if (rest.length === 0) return null
  if (rest.length === 1) return rest[0]
  return { op: 'all', of: rest }
}

/** Child terms left over once the parent's are removed, or null if it is no subset. */
function subtract(childTerms, parentTerms) {
  const rest = [...childTerms]
  for (const term of parentTerms) {
    const i = rest.findIndex(t => conditionKey(t) === conditionKey(term))
    if (i < 0) return null
    rest.splice(i, 1)
  }
  return rest
}

/**
 * The earlier node this one grows out of.
 *
 * 1. Its condition is a proper subset of ours — the structural case, exact.
 * 2. It plans the problem our condition grades — also exact, and what links a
 *    first day written as `always` to the days that branch on its result.
 * 3. It is the only node on an earlier day, so there is nothing else it could be.
 */
function findParent(when, deps, candidates) {
  const childTerms = termsOf(when)

  let best = null
  let bestRest = null
  for (const node of candidates) {
    const nodeTerms = termsOf(node.when)
    if (nodeTerms.length === 0 || nodeTerms.length >= childTerms.length) continue
    const rest = subtract(childTerms, nodeTerms)
    if (!rest) continue
    if (!best || nodeTerms.length > termsOf(best.when).length) {
      best = node
      bestRest = rest
    }
  }
  if (best) return { parent: best, rest: bestRest, exact: true }

  const slugs = dependencyIds(when).map(id => deps.find(d => d.id === id)?.slug).filter(Boolean)
  if (slugs.length > 0) {
    const byItem = candidates.filter(n => n.items.some(i => i.slug && slugs.includes(i.slug)))
    const deepest = byItem.reduce((a, b) => (!a || b.depth > a.depth ? b : a), null)
    if (deepest) return { parent: deepest, rest: termsOf(when), exact: true }
  }

  const previousDepth = candidates.length > 0 ? Math.max(...candidates.map(c => c.depth)) : null
  const previous = candidates.filter(n => n.depth === previousDepth)
  if (previous.length === 1) return { parent: previous[0], rest: termsOf(when), exact: false }

  return { parent: null, rest: termsOf(when), exact: false }
}

/**
 * @param {object[]} days  day documents, any order
 * @param {object} ctx     { practiceLog, anchors, today } — passed through to the resolver
 * @returns {{ roots, nodes, dates }}
 */
export function buildDayTree(days = [], ctx = {}) {
  const ordered = [...days].filter(d => d?.date).sort((a, b) => a.date.localeCompare(b.date))
  const nodes = []
  const roots = []
  const dates = []

  ordered.forEach((day, depth) => {
    const view = resolveOutlookDay(day, ctx)
    const rawById = new Map((day.scenarios || []).map(s => [s.id, s]))
    const earlier = nodes.filter(n => n.depth < depth)

    // Prose alternatives carry no checkable conditions, so they are not a tree.
    // The day becomes one node rather than a fan of branches the app invented.
    const branches = view.legacy || !day.scenarios?.length
      ? [{
        id: 'plan',
        label: view.headline || `${view.weekday}'s plan`,
        items: view.items,
        workload: view.workload,
        outcome: view.selected ? true : 'unknown',
        followUps: view.followUps,
        basis: view.basis,
      }]
      : view.scenarios

    const made = []
    for (const branch of branches) {
      const when = rawById.get(branch.id)?.when || null
      const taken = view.selected?.id === branch.id || (branches.length === 1 && !!view.selected)
      const { parent, rest, exact } = findParent(when, day.dependencies || [], earlier)
      const items = taken ? view.items : branch.items

      const node = {
        id: `${day.date}:${branch.id}`,
        date: day.date,
        weekday: view.weekday,
        weekdayShort: view.weekdayShort,
        depth,
        label: branch.label || branch.id,
        when,
        edge: describeEdge(restCondition(rest), day.dependencies || []),
        edgeApproximate: !!when && !exact,
        parentId: parent?.id || null,
        children: [],
        state: taken ? 'taken' : branch.outcome === false ? 'ruled-out' : 'open',
        items,
        workload: taken ? view.workload : branch.workload,
        followUps: branch.followUps || [],
        basis: branch.basis || null,
        dayView: view,
      }

      if (parent) parent.children.push(node)
      else roots.push(node)
      made.push(node)
      nodes.push(node)
    }

    dates.push({ date: day.date, depth, weekday: view.weekday, weekdayShort: view.weekdayShort, count: made.length })
  })

  return { roots, nodes, dates }
}

/**
 * The tree as rows to render, children nested inside their parent rather than
 * flattened, so a subtree can be revealed or hidden as one block.
 *
 * `guides` carries one flag per ancestor whose branch continues past this row,
 * which is what lets a row draw its share of the trunks running through it. A
 * child of a root needs none: the root sits in no indent column, so there is
 * nowhere for its trunk to be drawn.
 */
export function treeRows(list, guides = [], depth = 0) {
  return list.map((node, i) => {
    const last = i === list.length - 1
    return {
      node,
      depth,
      guides,
      last,
      hasChildren: node.children.length > 0,
      children: treeRows(node.children, depth === 0 ? [] : [...guides, !last], depth + 1),
    }
  })
}

/**
 * Whether a node's children reach today or earlier. Those days have already
 * happened, so they are not a forecast to be folded away — they are the record
 * of how you got here, and the tree is unreadable without them.
 */
export function holdsOpen(node, today) {
  return !!today && (node?.children || []).some(c => c.date <= today)
}

/** Everything but the path the facts picked, so the live route reads at a glance. */
export function defaultCollapsed(roots, today) {
  const collapsed = new Set()
  const walk = node => {
    if (node.state !== 'taken' && !holdsOpen(node, today)) collapsed.add(node.id)
    node.children.forEach(walk)
  }
  roots.forEach(walk)
  return collapsed
}
