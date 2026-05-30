# 🔗 Linked List — Learn → Solve Plan

> **Method:** Study solutions in the LEARN list first (understand the pointer manipulation, draw the state before/after each step, rewrite from memory). Then after 2-3 days, attempt the SOLVE list cold with a timer.
>
> ⚠️ Linked List problems test **pointer manipulation under pressure**. The code is short but the edge cases are brutal (empty list, single node, head changes). The key skill is knowing WHICH pattern applies and handling edges without panicking.

---

## 🧠 The 5 Core Linked List Patterns (Know These Cold)

### 1. Dummy Head (Sentinel Node)
```
Create a dummy node before head → build/modify list → return dummy.next
```
- **When you see:** "merge lists", "remove nodes", "partition", head might change
- **Why it works:** Eliminates all head-is-null / head-changes edge cases
- **Example:** Merge Two Sorted Lists — dummy simplifies first-node selection

### 2. Fast & Slow Pointers (Floyd's)
```
slow moves 1 step, fast moves 2 steps → they meet or fast hits null
```
- **When you see:** "cycle detection", "find middle", "palindrome check"
- **Why it works:** Fast covers 2x distance — when fast hits end, slow is at middle. In a cycle, they must meet.
- **Example:** Linked List Cycle — if fast and slow meet, cycle exists

### 3. In-Place Reversal
```
prev = null, curr = head → re-point curr.next to prev → advance both
```
- **When you see:** "reverse list", "reverse between positions", "reorder"
- **Why it works:** Three pointers (prev, curr, next) are all you need to flip direction
- **Example:** Reverse Linked List — the foundational 3-pointer technique

### 4. K-th From End / Runner Technique
```
Advance first pointer k steps → move both until first hits end → second is at target
```
- **When you see:** "remove nth from end", "rotate list", "kth node"
- **Why it works:** Fixed gap between two pointers means when leader finishes, follower is exactly k behind
- **Example:** Remove Nth Node From End — advance fast by n, then move both

### 5. Merge / Weave
```
Compare heads of two lists → pick smaller → advance that pointer
```
- **When you see:** "merge sorted lists", "interleave", "reorder list"
- **Why it works:** Since both lists are sorted, the smallest available is always at one of the two heads
- **Example:** Merge Two Sorted Lists — classic two-pointer merge with dummy head

---

### 🔑 Linked List Identification Checklist

Before coding, ask yourself:
1. **Can the head change?** → Use a dummy/sentinel node
2. **Do I need the middle or detect a cycle?** → Fast & slow pointers
3. **Am I reversing all or part of the list?** → In-place reversal (prev/curr/next)
4. **Do I need a position relative to the end?** → Runner technique (advance one pointer first)
5. **Am I combining two lists?** → Merge pattern with dummy head

### ⚠️ Edge Cases to ALWAYS Check
- Empty list (`head === null`)
- Single node (`head.next === null`)
- Two nodes (reversal, removal, cycle)
- Head is the target node (removal, partition)
- List has a cycle (don't infinite loop)

---

## 🟢 EASY TIER (Core Pattern Problems)

### 📖 Learn List — Study these solutions first

| # | Problem | Pattern | Why Learn This |
|---|---------|---------|---------------|
| 206 | [Reverse Linked List](https://leetcode.com/problems/reverse-linked-list/) | In-Place Reversal | **THE** foundational LL problem. Master iterative (prev/curr/next) AND recursive. Every medium builds on this. |
| 21 | [Merge Two Sorted Lists](https://leetcode.com/problems/merge-two-sorted-lists/) | Dummy Head + Merge | **THE** merge pattern. Dummy node + compare-and-attach. Used in merge sort, reorder list, and more. |
| 141 | [Linked List Cycle](https://leetcode.com/problems/linked-list-cycle/) | Fast & Slow | **THE** cycle detection problem. Floyd's algorithm — if fast meets slow, cycle exists. Foundation for 142. |
| 876 | [Middle of the Linked List](https://leetcode.com/problems/middle-of-the-linked-list/) | Fast & Slow | When fast reaches end, slow is at middle. You'll reuse this in Reorder List, Palindrome, Sort List. |

**How to study each:**
1. Read the problem, don't attempt it
2. Read the solution — **draw the pointer states** at each step on paper
3. Close the solution, rewrite it from memory
4. If stuck, look at just the part you forgot, then close and retry
5. Articulate in one sentence: *what are the pointers doing and why?*

---

### ✏️ Solve List — Attempt these cold (20 min timer)

| # | Problem | Pattern It Tests | Move to Learn if stuck? |
|---|---------|-----------------|------------------------|
| 83 | [Remove Duplicates from Sorted List](https://leetcode.com/problems/remove-duplicates-from-sorted-list/) | Traversal | Yes — compare curr.val to curr.next.val, skip duplicates |
| 160 | [Intersection of Two Linked Lists](https://leetcode.com/problems/intersection-of-two-linked-lists/) | Two Pointers | Yes — when pointer reaches end, redirect to other list's head |
| 203 | [Remove Linked List Elements](https://leetcode.com/problems/remove-linked-list-elements/) | Dummy Head | Yes — dummy handles head removal; scan with prev/curr |
| 234 | [Palindrome Linked List](https://leetcode.com/problems/palindrome-linked-list/) | Fast & Slow + Reversal | Yes — find middle, reverse second half, compare |

---

## 🟡 MEDIUM TIER (Combinations + Harder Constraints)

### 📖 Learn List — Study these solutions

| # | Problem | Pattern | Why Learn This |
|---|---------|---------|---------------|
| 19 | [Remove Nth Node From End of List](https://leetcode.com/problems/remove-nth-node-from-end-of-list/) | Runner + Dummy Head | **Runner technique** — advance fast by n, move both, slow lands right before target. Dummy handles edge case when head is removed. |
| 143 | [Reorder List](https://leetcode.com/problems/reorder-list/) | Fast & Slow + Reversal + Merge | **Combines 3 patterns** — find middle (876), reverse second half (206), merge/weave both halves. The ultimate combo problem. |
| 92 | [Reverse Linked List II](https://leetcode.com/problems/reverse-linked-list-ii/) | In-Place Reversal (sublist) | **Partial reversal** — navigate to position, reverse a window, reconnect. Harder than full reversal because of the reconnection step. |
| 138 | [Copy List with Random Pointer](https://leetcode.com/problems/copy-list-with-random-pointer/) | Hash Map | **Deep copy with arbitrary pointers** — use a map from old→new node to resolve random pointers. O(1) space variant uses interleaving. |
| 148 | [Sort List](https://leetcode.com/problems/sort-list/) | Fast & Slow + Merge | **Merge sort on linked list** — find middle (876), recursively sort halves, merge (21). O(n log n) time, O(1) space. |

**How to study each:**
1. Same process as Easy tier
2. Additionally: **identify which Easy-tier patterns combine** and in what order
3. Write down the sub-steps (e.g., *"143 = find middle → reverse second half → weave"*)

---

### ✏️ Solve List — Attempt these cold (30 min timer)

| # | Problem | Pattern It Tests | Hint (only if stuck > 15 min) |
|---|---------|-----------------|------------------------------|
| 2 | [Add Two Numbers](https://leetcode.com/problems/add-two-numbers/) | Dummy Head + Traversal | Process both lists digit by digit, carry forward. Dummy simplifies building result |
| 142 | [Linked List Cycle II](https://leetcode.com/problems/linked-list-cycle-ii/) | Fast & Slow | After detecting cycle (141), reset one pointer to head, move both at speed 1 — they meet at cycle start |
| 24 | [Swap Nodes in Pairs](https://leetcode.com/problems/swap-nodes-in-pairs/) | In-Place Reversal | Reverse in groups of 2. Dummy head + careful pointer rewiring per pair |
| 328 | [Odd Even Linked List](https://leetcode.com/problems/odd-even-linked-list/) | Weave / Rearrange | Separate into odd-indexed and even-indexed chains, then connect odd tail → even head |
| 86 | [Partition List](https://leetcode.com/problems/partition-list/) | Dummy Head (x2) | Two dummy heads: one for < x, one for >= x. Scan and append, then connect |
| 61 | [Rotate List](https://leetcode.com/problems/rotate-list/) | Runner + Cycle | Find length, k %= length, find new tail (len-k from start), break and reconnect |
| 287 | [Find the Duplicate Number](https://leetcode.com/problems/find-the-duplicate-number/) | Fast & Slow (on array) | Treat array as linked list (val → index). Floyd's cycle detection finds the duplicate |
| 146 | [LRU Cache](https://leetcode.com/problems/lru-cache/) | Doubly Linked List + HashMap | DLL for order (most/least recent), HashMap for O(1) lookup. Move-to-front on access |
| 25 | [Reverse Nodes in k-Group](https://leetcode.com/problems/reverse-nodes-in-k-group/) | In-Place Reversal | Count k nodes ahead. If enough, reverse that group (like 92), reconnect, repeat |
| 23 | [Merge k Sorted Lists](https://leetcode.com/problems/merge-k-sorted-lists/) | Merge + Min-Heap | Extend 21 to k lists — use a min-heap of size k, or divide-and-conquer pairwise merge |

---

## 📋 Progress Tracker

| Problem | Status | Date | Notes |
|---------|--------|------|-------|
| 206. Reverse Linked List | ⬜ | | |
| 21. Merge Two Sorted Lists | ⬜ | | |
| 141. Linked List Cycle | ⬜ | | |
| 876. Middle of the Linked List | ⬜ | | |
| 83. Remove Duplicates from Sorted List | ⬜ | | |
| 160. Intersection of Two Linked Lists | ⬜ | | |
| 203. Remove Linked List Elements | ⬜ | | |
| 234. Palindrome Linked List | ⬜ | | |
| 19. Remove Nth Node From End | ⬜ | | |
| 143. Reorder List | ⬜ | | |
| 92. Reverse Linked List II | ⬜ | | |
| 138. Copy List with Random Pointer | ⬜ | | |
| 148. Sort List | ⬜ | | |
| 2. Add Two Numbers | ⬜ | | |
| 142. Linked List Cycle II | ⬜ | | |
| 24. Swap Nodes in Pairs | ⬜ | | |
| 328. Odd Even Linked List | ⬜ | | |
| 86. Partition List | ⬜ | | |
| 61. Rotate List | ⬜ | | |
| 287. Find the Duplicate Number | ⬜ | | |
| 146. LRU Cache | ⬜ | | |
| 25. Reverse Nodes in k-Group | ⬜ | | |
| 23. Merge k Sorted Lists | ⬜ | | |

> ⬜ = Not started | 📖 = Studied solution | ✅ = Solved cold | 🔁 = Moved back to learn
