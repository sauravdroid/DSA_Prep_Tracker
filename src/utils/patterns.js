const PATTERN_PRIORITY = [
  'Backtracking',
  'Dynamic Programming',
  'Greedy',
  'Binary Search',
  'Sliding Window',
  'Two Pointers',
  'Depth-First Search',
  'Breadth-First Search',
  'Stack',
  'Monotonic Stack',
  'Heap (Priority Queue)',
  'Graph',
  'Tree',
  'Trie',
  'Bit Manipulation',
  'Linked List',
  'Hash Table',
  'Sorting',
  'Array',
  'String',
  'Math',
]

const DISPLAY_NAME = {
  'Depth-First Search': 'DFS',
  'Breadth-First Search': 'BFS',
  'Heap (Priority Queue)': 'Heap',
  'Hash Table': 'Hash Map',
  'Monotonic Stack': 'Stack',
}

// Tags that describe the input shape rather than the technique. They only
// become a pattern when nothing more specific matched.
const GENERIC_TAGS = new Set(['Array', 'String', 'Math'])

// Already folded into the composite "Trees (DFS)" / "Graphs (BFS)" labels.
const STRUCTURE_TAGS = new Set([
  'Tree',
  'Graph',
  'Depth-First Search',
  'Breadth-First Search',
])

// Every pattern a problem belongs to, most specific first. A problem tagged
// both Greedy and Monotonic Stack counts toward both.
export function getPatterns(tags) {
  if (!tags || tags.length === 0) return ['Other']

  const out = []
  const add = name => { if (name && !out.includes(name)) out.push(name) }
  const hasTag = name => tags.includes(name)

  const hasTree = hasTag('Tree') || hasTag('Binary Tree')
  const hasGraph = hasTag('Graph')
  const hasDFS = hasTag('Depth-First Search')
  const hasBFS = hasTag('Breadth-First Search')

  if (hasTree && hasDFS) add('Trees (DFS)')
  if (hasTree && hasBFS) add('Trees (BFS)')
  if (hasTree && !hasDFS && !hasBFS) add('Trees')
  if (hasGraph && hasBFS) add('Graphs (BFS)')
  if (hasGraph && hasDFS) add('Graphs (DFS)')
  if (hasGraph && !hasDFS && !hasBFS) add('Graphs')

  for (const tag of PATTERN_PRIORITY) {
    if (!hasTag(tag) || GENERIC_TAGS.has(tag)) continue
    if ((hasTree || hasGraph) && STRUCTURE_TAGS.has(tag)) continue
    add(DISPLAY_NAME[tag] || tag)
  }

  if (out.length === 0) {
    const generic = PATTERN_PRIORITY.find(hasTag)
    add(generic ? DISPLAY_NAME[generic] || generic : tags[0] || 'Other')
  }

  return out
}

export function getPattern(tags) {
  return getPatterns(tags)[0]
}
