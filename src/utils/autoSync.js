import { syncToday } from '../services/leetcode'
import { backupIfConnected, pullFromGithub, remoteStatus, coachingHistory, pullCoaching, getRepo } from './github'
import { loadDecision, saveDecision } from './coaching'
import * as store from '../store'

export const INTERVAL_MS = 2 * 60 * 1000

// A step that never settles would otherwise leave the cycle marked running,
// and the guard at the top of runCycle would then refuse every later cycle.
const STEP_TIMEOUT_MS = 30 * 1000
const CYCLE_STUCK_MS = 3 * 60 * 1000

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${STEP_TIMEOUT_MS / 1000}s`)), STEP_TIMEOUT_MS)
    ),
  ])
}

/**
 * Steps are declared rather than inferred, so a cycle that skips one still
 * shows why instead of silently doing less than the reader expects.
 */
export const STEPS = [
  { key: 'leetcode', label: 'LeetCode submissions' },
  { key: 'pull', label: 'Tracker from GitHub' },
  { key: 'push', label: 'Publish tracker' },
  { key: 'plan', label: 'Coaching plan' },
]

let state = {
  enabled: true,
  running: false,
  startedAt: null,
  lastRunAt: null,
  nextRunAt: null,
  steps: STEPS.map(s => ({ ...s, state: 'pending', note: null })),
  summary: null,
  failed: false,
  log: [],
}

const listeners = new Set()
let timer = null
let onChanged = null

export function subscribeSync(fn) {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

function set(patch) {
  state = { ...state, ...patch }
  for (const fn of listeners) fn(state)
}

function step(key, next, note) {
  set({
    steps: state.steps.map(s => (s.key === key ? { ...s, state: next, note: note ?? s.note } : s)),
  })
}

function note(text) {
  // Newest first, and bounded: this is a running commentary, not an audit log.
  set({ log: [{ at: new Date().toISOString(), text }, ...state.log].slice(0, 40) })
}

/** One pass. Never throws: a failed step is reported, the rest still run. */
export async function runCycle({ manual = false } = {}) {
  const stuck = state.running && state.startedAt
    && Date.now() - new Date(state.startedAt).getTime() > CYCLE_STUCK_MS
  if (state.running && !stuck) return state
  if (stuck) note('Previous check never finished; starting a new one')

  set({
    running: true,
    startedAt: new Date().toISOString(),
    failed: false,
    summary: manual ? 'Checking now…' : 'Checking…',
    steps: STEPS.map(s => ({ ...s, state: 'pending', note: null })),
  })

  const changed = []
  const problems = []

  // --- LeetCode
  try {
    const session = store.getSession()
    if (!session) {
      step('leetcode', 'skipped', 'No session cookie set')
    } else {
      step('leetcode', 'running')
      const r = await withTimeout(syncToday(session, () => {}, store.getProblems(), store.getLastSync()), 'LeetCode sync')
      if (r.results.length > 0) store.mergeProblems(r.results)
      for (const x of r.resubmissions) store.addRevision(x.slug, x.date)
      store.addFailures(r.failures)
      const total = r.results.length + r.resubmissions.length
      if (total > 0) changed.push(`${r.results.length} solved, ${r.resubmissions.length} revised`)
      step('leetcode', 'done', total > 0
        ? `${r.results.length} solved, ${r.resubmissions.length} revised`
        : 'Nothing new')
      if (total > 0) note(`LeetCode: ${r.results.length} solved, ${r.resubmissions.length} revised`)
    }
  } catch (e) {
    problems.push('LeetCode')
    step('leetcode', 'failed', e.message)
    note(`LeetCode sync failed: ${e.message}`)
  }

  // --- GitHub, both directions. Checked before acting so an idle cycle is
  // cheap and says so.
  let status = null
  try {
    step('pull', 'running')
    status = await withTimeout(remoteStatus(), 'Remote status')
    const remoteNewer = status.remote?.savedAt && status.local?.savedAt
      && status.remote.savedAt > status.local.savedAt
    if (remoteNewer) {
      const r = await withTimeout(pullFromGithub(), 'Pull')
      const s = r.summary || {}
      const added = (s.problemsAdded || 0) + (s.revisionsAdded || 0) + (s.attemptsAdded || 0)
      step('pull', 'done', added > 0 ? `+${s.problemsAdded || 0} problems, +${s.revisionsAdded || 0} revisions, +${s.attemptsAdded || 0} attempts` : 'Already up to date')
      if (added > 0) {
        changed.push('pulled from GitHub')
        note(`Pulled from GitHub: +${s.problemsAdded || 0} problems, +${s.revisionsAdded || 0} revisions, +${s.attemptsAdded || 0} attempts`)
      }
    } else {
      step('pull', 'done', 'Nothing newer on GitHub')
    }
  } catch (e) {
    problems.push('pull')
    step('pull', 'failed', e.message)
  }

  try {
    const needsPush = changed.length > 0 || status?.behind
    if (!needsPush) {
      step('push', 'skipped', 'Nothing to publish')
    } else {
      step('push', 'running')
      const r = await withTimeout(backupIfConnected(), 'Publish')
      if (r.skipped) step('push', 'skipped', 'No GitHub token configured')
      else {
        step('push', 'done', r.committed ? `Published ${r.committed}` : 'Published')
        note(`Published tracker${r.committed ? ` (${r.committed})` : ''}`)
      }
    }
  } catch (e) {
    problems.push('publish')
    step('push', 'failed', e.message)
    note(`Publishing failed: ${e.message}`)
  }

  // --- Coaching plan. The history call is one small request, so a cycle that
  // finds nothing new never downloads the decision.
  try {
    step('plan', 'running')
    const { decision } = await withTimeout(loadDecision(), 'Reading the adopted plan')
    const adopted = decision?.adoptedFrom?.commit || null
    const { revisions } = await withTimeout(coachingHistory(), 'Plan history')
    const head = revisions?.[0] || null

    if (!head) {
      step('plan', 'skipped', 'No plan published yet')
    } else if (adopted === head.sha) {
      step('plan', 'done', `Up to date (${head.shortSha})`)
    } else {
      const c = await withTimeout(pullCoaching(), 'Fetching the plan')
      if (c.empty) {
        step('plan', 'skipped', 'No plan published yet')
      } else if (!c.valid) {
        step('plan', 'failed', `Revision ${head.shortSha} failed validation, so it was not adopted`)
        note(`Plan ${head.shortSha} failed validation and was not adopted`)
      } else if (c.outOfScope?.length > 0) {
        step('plan', 'failed', `Revision ${head.shortSha} also changed ${c.outOfScope.join(', ')}, so it was not adopted`)
        note(`Plan ${head.shortSha} touched files outside coaching/ and was not adopted`)
      } else {
        await withTimeout(saveDecision({
          ...c.decision,
          adoptedFrom: {
            repo: getRepo(),
            path: c.path || 'coaching/decision.json',
            commit: c.commit?.sha || head.sha,
            shortCommit: c.commit?.shortSha || head.shortSha,
            adoptedAt: new Date().toISOString(),
            adoptedAutomatically: true,
          },
        }), 'Adopting the plan')
        step('plan', 'done', `Adopted ${head.shortSha}`)
        note(`Adopted a new plan: ${head.shortSha} — ${head.message || 'no message'}`)
        changed.push('new plan')
      }
    }
  } catch (e) {
    problems.push('plan')
    step('plan', 'failed', e.message)
  }

  const failed = problems.length > 0
  set({
    running: false,
    startedAt: null,
    failed,
    lastRunAt: new Date().toISOString(),
    summary: failed
      ? `${problems.join(' and ')} failed`
      : changed.length > 0
        ? changed.join(' · ')
        : 'Everything up to date',
  })

  if (changed.length > 0) onChanged?.()
  return state
}

function schedule() {
  clearTimeout(timer)
  if (!state.enabled) {
    set({ nextRunAt: null })
    return
  }
  set({ nextRunAt: new Date(Date.now() + INTERVAL_MS).toISOString() })
  timer = setTimeout(async () => {
    await runCycle()
    schedule()
  }, INTERVAL_MS)
}

/** Begins the loop and runs one pass immediately. */
export function startAutoSync(handlers = {}) {
  onChanged = handlers.onChanged || null
  set({ enabled: true })
  runCycle().finally(schedule)
  return () => {
    clearTimeout(timer)
    timer = null
  }
}

export function setEnabled(on) {
  set({ enabled: on })
  if (on) schedule()
  else { clearTimeout(timer); set({ nextRunAt: null }) }
}

export function syncNow() {
  clearTimeout(timer)
  return runCycle({ manual: true }).finally(schedule)
}
