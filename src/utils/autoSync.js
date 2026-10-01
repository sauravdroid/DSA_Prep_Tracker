import { syncToday } from '../services/leetcode'
import { backupIfConnected, pullFromGithub, remoteStatus, coachingHistory, pullCoaching, archiveCoaching, pullDays, getRepo } from './github'
import { loadDecision, saveDecision, loadDays, saveDays } from './coaching'
import { canonical } from './trackerDiff'
import * as store from '../store'

export const INTERVAL_MS = 10 * 60 * 1000

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

let noteSeq = 0

function note(text) {
  // Newest first, and bounded: this is a running commentary, not an audit log.
  noteSeq += 1
  set({ log: [{ id: noteSeq, at: new Date().toISOString(), text }, ...state.log].slice(0, 40) })
}

/**
 * At most one request in flight per path. A second caller joins the first
 * rather than starting a competing request, which matters most for the two
 * paths that read, merge and write the whole tracker.
 */
const inflight = new Map()

function once(key, fn) {
  const pending = inflight.get(key)
  if (pending) return pending
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export function pendingPaths() {
  return [...inflight.keys()]
}

/** LeetCode submissions since the last sync, merged into the store. */
async function leetcodeStep(changed) {
  const session = store.getSession()
  if (!session) {
    step('leetcode', 'skipped', 'No session cookie set')
    return
  }
  step('leetcode', 'running', 'Contacting LeetCode…')
  const r = await withTimeout(
    syncToday(session, msg => step('leetcode', 'running', msg), store.getProblems(), store.getLastSync()),
    'LeetCode sync'
  )

  // Titles are resolved before the merge, so a revision is still described by
  // the name the tracker already held rather than by its slug.
  const known = store.getProblems()
  const revisedTitles = r.resubmissions.map(x => known[x.slug]?.title || x.slug)

  if (r.results.length > 0) store.mergeProblems(r.results)
  for (const x of r.resubmissions) store.addRevision(x.slug, x.date)
  store.addFailures(r.failures)

  const total = r.results.length + r.resubmissions.length
  if (total > 0) changed.push(`${r.results.length} solved, ${r.resubmissions.length} revised`)
  step('leetcode', 'done', total > 0
    ? `${r.results.length} solved, ${r.resubmissions.length} revised`
    : 'Nothing new since the last check')

  for (const p of r.results) note(`Solved: ${p.title || p.slug}`)
  for (const t of revisedTitles) note(`Revised: ${t}`)
}

/** Remote tracker, pulled only when it is genuinely newer. */
async function pullStep(changed) {
  step('pull', 'running')
  const status = await withTimeout(remoteStatus(), 'Remote status')
  const remoteNewer = status.remote?.savedAt && status.local?.savedAt
    && status.remote.savedAt > status.local.savedAt

  if (!remoteNewer) {
    step('pull', 'done', 'Nothing newer on GitHub')
    return status
  }

  const r = await withTimeout(pullFromGithub(), 'Pull')
  const s = r.summary || {}
  const added = (s.problemsAdded || 0) + (s.revisionsAdded || 0) + (s.attemptsAdded || 0)
  step('pull', 'done', added > 0
    ? `+${s.problemsAdded || 0} problems, +${s.revisionsAdded || 0} revisions, +${s.attemptsAdded || 0} attempts`
    : 'Already up to date')
  if (added > 0) {
    changed.push('pulled from GitHub')
    note(`Pulled from GitHub: +${s.problemsAdded || 0} problems, +${s.revisionsAdded || 0} revisions, +${s.attemptsAdded || 0} attempts`)
  }
  return status
}

async function pushStep(changed, status) {
  if (!(changed.length > 0 || status?.behind)) {
    step('push', 'skipped', 'Nothing to publish')
    return
  }
  step('push', 'running')
  const r = await withTimeout(backupIfConnected(), 'Publish')
  if (r.skipped) {
    step('push', 'skipped', 'No GitHub token configured')
    return
  }
  step('push', 'done', r.committed ? `Published ${r.committed}` : 'Published')
  note(`Published tracker${r.committed ? ` (${r.committed})` : ''}`)
}

/** Copies published revisions somewhere addressable. Never blocks adoption. */
async function archiveStep() {
  try {
    const r = await withTimeout(archiveCoaching(), 'Archiving assessments')
    if (r.archived > 0) note(`Archived ${r.archived} assessment${r.archived === 1 ? '' : 's'} (${r.count} in the index)`)
    return r
  } catch (e) {
    note(`Could not archive assessments: ${e.message}`)
    return null
  }
}

/**
 * Brings the published day plans into the local store.
 *
 * Runs after archiving, which is what produces them: a revision published
 * while the app was closed becomes a day file first and is copied here second.
 */
async function daysStep(changed) {
  try {
    const remote = await withTimeout(pullDays(), 'Fetching day plans')
    if (remote.empty || !remote.index) return

    const local = await loadDays()
    const fresh = Object.keys(remote.days || {})
      .filter(d => canonical(local.days?.[d]) !== canonical(remote.days[d]))
    if (fresh.length === 0) return

    await withTimeout(saveDays({ index: remote.index, days: remote.days }), 'Storing day plans')
    note(`Updated ${fresh.length} day plan${fresh.length === 1 ? '' : 's'}`)
    changed.push(`${fresh.length} day plan${fresh.length === 1 ? '' : 's'}`)
  } catch (e) {
    note(`Could not fetch day plans: ${e.message}`)
  }
}

/** The published plan, downloaded only when its head differs from the pin. */
async function planStep(changed) {
  step('plan', 'running')
  const { decision } = await withTimeout(loadDecision(), 'Reading the adopted plan')
  const adopted = decision?.adoptedFrom?.commit || null
  const { revisions } = await withTimeout(coachingHistory(), 'Plan history')
  const head = revisions?.[0] || null

  if (!head) {
    step('plan', 'skipped', 'No plan published yet')
    return
  }
  if (adopted === head.sha) {
    // Still archive: a revision published while this app was closed would
    // otherwise never be copied, since the pin already matches.
    await archiveStep()
    await daysStep(changed)
    step('plan', 'done', `Up to date (${head.shortSha})`)
    return
  }

  const c = await withTimeout(pullCoaching(), 'Fetching the plan')
  if (c.empty) {
    step('plan', 'skipped', 'No plan published yet')
    return
  }
  if (!c.valid) {
    step('plan', 'failed', `Revision ${head.shortSha} failed validation, so it was not adopted`)
    note(`Plan ${head.shortSha} failed validation and was not adopted`)
    return
  }
  if (c.outOfScope?.length > 0) {
    step('plan', 'failed', `Revision ${head.shortSha} also changed ${c.outOfScope.join(', ')}, so it was not adopted`)
    note(`Plan ${head.shortSha} touched files outside coaching/ and was not adopted`)
    return
  }

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
  await archiveStep()
  await daysStep(changed)
  step('plan', 'done', `Adopted ${head.shortSha}`)
  note(`Adopted a new plan: ${head.shortSha} — ${head.message || 'no message'}`)
  changed.push('new plan')
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
  const fail = (label, key) => e => {
    problems.push(label)
    step(key, 'failed', e.message)
  }

  // The tracker paths share one file: LeetCode merges into it, a pull replaces
  // it wholesale, and a push sends whatever resulted. Running them together
  // would let one overwrite another's work, so only the plan — which touches a
  // different file entirely — runs alongside.
  const trackerLane = (async () => {
    let status = null
    await once('leetcode', () => leetcodeStep(changed)).catch(fail('LeetCode', 'leetcode'))
    await once('pull', () => pullStep(changed)).then(s => { status = s }).catch(fail('pull', 'pull'))
    await once('push', () => pushStep(changed, status)).catch(fail('publish', 'push'))
  })()

  const planLane = once('plan', () => planStep(changed)).catch(fail('plan', 'plan'))

  await Promise.allSettled([trackerLane, planLane])

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
