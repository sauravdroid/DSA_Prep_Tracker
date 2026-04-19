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

export function getPattern(tags) {
  if (!tags || tags.length === 0) return 'Other'

  const hasTag = name => tags.includes(name)
  const hasTree = hasTag('Tree') || hasTag('Binary Tree')
  const hasGraph = hasTag('Graph')
  const hasDFS = hasTag('Depth-First Search')
  const hasBFS = hasTag('Breadth-First Search')

  if (hasTree && hasDFS) return 'Trees (DFS)'
  if (hasTree && hasBFS) return 'Trees (BFS)'
  if (hasTree) return 'Trees'
  if (hasGraph && hasBFS) return 'Graphs (BFS)'
  if (hasGraph && hasDFS) return 'Graphs (DFS)'
  if (hasGraph) return 'Graphs'

  for (const tag of PATTERN_PRIORITY) {
    if (hasTag(tag)) return DISPLAY_NAME[tag] || tag
  }

  return tags[0] || 'Other'
}
