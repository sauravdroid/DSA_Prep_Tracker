export const EXAMPLES = [
  {
    name: 'Fibonacci',
    code: `function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

fib(6);`,
    cases: [],
  },
  {
    name: 'Subsets (LC 78)',
    entry: 'subsets',
    code: `var subsets = function(nums) {
  const result = [];

  function backtrack(start, path) {
    result.push([...path]);
    for (let i = start; i < nums.length; i++) {
      path.push(nums[i]);
      backtrack(i + 1, path);
      path.pop();
    }
  }

  backtrack(0, []);
  return result;
};`,
    cases: [
      { input: '[1,2,3]', expected: '[[],[1],[1,2],[1,2,3],[1,3],[2],[2,3],[3]]' },
      { input: '[0]', expected: '[[],[0]]' },
    ],
  },
  {
    name: 'Permutations (LC 46)',
    entry: 'permute',
    code: `var permute = function(nums) {
  const result = [];

  function backtrack(path, used) {
    if (path.length === nums.length) {
      result.push([...path]);
      return;
    }
    for (let i = 0; i < nums.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      path.push(nums[i]);
      backtrack(path, used);
      path.pop();
      used[i] = false;
    }
  }

  backtrack([], []);
  return result;
};`,
    cases: [
      { input: '[1,2,3]', expected: '[[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]' },
      { input: '[0,1]', expected: '[[0,1],[1,0]]' },
    ],
  },
  {
    name: 'Evaluate Division (LC 399)',
    entry: 'calcEquation',
    code: `var calcEquation = function(equations, values, queries) {
  const adjList = new Map();

  for (let i = 0; i < equations.length; i++) {
    const [u, v] = equations[i];
    const value = values[i];

    if (!adjList.has(u)) adjList.set(u, []);
    if (!adjList.has(v)) adjList.set(v, []);

    adjList.get(u).push([v, value]);
    adjList.get(v).push([u, 1 / value]);
  }

  const visited = new Set();

  function dfs(node, target, prod = 1) {
    if (node === target) return prod;
    if (visited.has(node)) return -1;

    visited.add(node);
    const neighbors = adjList.get(node);
    let result = -1;
    for (const [neighbor, value] of neighbors) {
      result = dfs(neighbor, target, prod * value);
      if (result !== -1) return result;
    }
    visited.delete(node);

    return -1;
  }

  const result = [];
  for (const [u, v] of queries) {
    if (!adjList.has(u) || !adjList.has(v)) {
      result.push(-1);
      continue;
    }

    result.push(dfs(u, v));
    visited.clear();
  }

  return result;
};`,
    cases: [
      {
        input: '[["a","b"],["b","c"]]\n[2.0,3.0]\n[["a","c"],["b","a"],["a","e"],["a","a"],["x","x"]]',
        expected: '[6.0,0.5,-1.0,1.0,-1.0]',
      },
      {
        input: '[["a","b"],["b","c"],["bc","cd"]]\n[1.5,2.5,5.0]\n[["a","c"],["c","b"],["bc","cd"],["cd","bc"]]',
        expected: '[3.75,0.4,5.0,0.2]',
      },
      {
        input: '[["a","b"]]\n[0.5]\n[["a","b"],["b","a"],["a","c"],["x","y"]]',
        expected: '[0.5,2.0,-1.0,-1.0]',
      },
    ],
  },
  {
    name: 'Diameter of Binary Tree (LC 543)',
    entry: 'diameterOfBinaryTree',
    paramTypes: ['TreeNode'],
    returnType: 'integer',
    code: `/**
 * @param {TreeNode} root
 * @return {number}
 */
var diameterOfBinaryTree = function(root) {
  let maxLength = 0;

  function dfs(node) {
    if (!node) return 0;

    const left = dfs(node.left);
    const right = dfs(node.right);
    maxLength = Math.max(maxLength, left + right);

    return 1 + Math.max(left, right);
  }

  dfs(root);

  return maxLength;
};`,
    cases: [
      { input: '[1,2,3,4,5]', expected: '3' },
      { input: '[1,2]', expected: '1' },
    ],
  },
  {
    name: 'Binary search (recursive)',
    entry: 'search',
    code: `var search = function(nums, target) {
  function go(lo, hi) {
    if (lo > hi) return -1;
    const mid = Math.floor((lo + hi) / 2);
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) return go(mid + 1, hi);
    return go(lo, mid - 1);
  }
  return go(0, nums.length - 1);
};`,
    cases: [
      { input: '[-1,0,3,5,9,12]\n9', expected: '4' },
      { input: '[-1,0,3,5,9,12]\n2', expected: '-1' },
    ],
  },
  {
    name: 'Binary search (iterative)',
    entry: 'search',
    code: `// Iterative code has only one call, so the tree is a single node —
// step through it and watch lo / hi / mid in the Variables panel instead.
var search = function(nums, target) {
  let lo = 0;
  let hi = nums.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return -1;
};`,
    cases: [{ input: '[-1,0,3,5,9,12]\n9', expected: '4' }],
  },
  {
    name: 'BFS level order (LC 102)',
    entry: 'levelOrder',
    paramTypes: ['TreeNode'],
    returnType: 'integer[][]',
    code: `// BFS is iterative, so watch the queue grow and shrink
// in the Variables panel rather than the call tree.
/**
 * @param {TreeNode} root
 * @return {number[][]}
 */
var levelOrder = function(root) {
  if (!root) return [];
  const out = [];
  let queue = [root];
  while (queue.length > 0) {
    const level = [];
    const next = [];
    for (const node of queue) {
      level.push(node.val);
      if (node.left) next.push(node.left);
      if (node.right) next.push(node.right);
    }
    out.push(level);
    queue = next;
  }
  return out;
};`,
    cases: [
      { input: '[3,9,20,null,null,15,7]', expected: '[[3],[9,20],[15,7]]' },
      { input: '[1]', expected: '[[1]]' },
    ],
  },
  {
    name: 'Edit Distance (LC 72) — DP table',
    entry: 'minDistance',
    code: `var minDistance = function(word1, word2) {
  const m = word1.length, n = word2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (word1[i - 1] === word2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
};`,
    cases: [
      { input: '"horse"\n"ros"', expected: '3' },
      { input: '"intention"\n"execution"', expected: '5' },
    ],
  },
  {
    name: 'Number of Islands (LC 200) — grid',
    entry: 'numIslands',
    code: `var numIslands = function(grid) {
  const rows = grid.length, cols = grid[0].length;
  let count = 0;

  function sink(i, j) {
    if (i < 0 || j < 0 || i >= rows || j >= cols) return;
    if (grid[i][j] !== '1') return;
    grid[i][j] = '0';
    sink(i + 1, j);
    sink(i - 1, j);
    sink(i, j + 1);
    sink(i, j - 1);
  }

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === '1') {
        count++;
        sink(i, j);
      }
    }
  }

  return count;
};`,
    cases: [
      { input: '[["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]', expected: '3' },
    ],
  },
  {
    name: 'Merge sort',
    code: `function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));
  return merge(left, right);
}

function merge(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    out.push(a[i] <= b[j] ? a[i++] : b[j++]);
  }
  return out.concat(a.slice(i)).concat(b.slice(j));
}

mergeSort([5, 2, 9, 1, 7, 3]);`,
    cases: [],
  },
  {
    name: 'Tower of Hanoi',
    code: `function hanoi(n, from, to, via) {
  if (n === 0) return 0;
  const a = hanoi(n - 1, from, via, to);
  console.log('move disk ' + n + ' from ' + from + ' to ' + to);
  const b = hanoi(n - 1, via, to, from);
  return a + b + 1;
}

hanoi(3, 'A', 'C', 'B');`,
    cases: [],
  },
  {
    name: 'Infinite recursion (bug)',
    code: `// The base case is never reachable for odd n — the visualizer
// stops at the depth limit instead of hanging the page.
function countdown(n) {
  if (n === 0) return 0;
  return countdown(n - 2);
}

countdown(5);`,
    cases: [],
  },
]
