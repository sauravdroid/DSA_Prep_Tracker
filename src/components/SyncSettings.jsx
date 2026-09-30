import { useState, useEffect, useCallback } from 'react'
import { syncProblems } from '../services/leetcode'
import { subscribe, saveNow, reloadFromDisk } from '../utils/dataFile'
import { githubStatus, saveToken, pullFromGithub, pushToGithub, getRepo, setRepo, pullCoaching } from '../utils/github'
import { saveDecision } from '../utils/coaching'
import RemoteFreshness from './RemoteFreshness'
import * as store from '../store'

// Overlap by a day so a timezone boundary can't drop a submission.
function stepBackOneDay(dateStr) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

const DISK_STYLE = {
  idle: 'bg-slate-100 text-slate-600',
  saving: 'bg-sky-100 text-sky-700',
  saved: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
  conflict: 'bg-amber-100 text-amber-800',
  unavailable: 'bg-amber-100 text-amber-800',
}

const btn = {
  primary: 'rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-300',
  ghost: 'rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50',
  danger: 'rounded-lg border border-rose-200 px-4 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50',
}

/** One hop in LeetCode → browser → disk → GitHub. */
function Hop({ label, value, tone = 'bg-slate-100 text-slate-600', last }) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <span className={`truncate rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
          {value}
        </span>
      </div>
      {!last && <span className="mt-4 shrink-0 text-slate-300" aria-hidden="true">→</span>}
    </>
  )
}

const STEP_MARK = {
  done: 'M5 10.5l3.2 3.2L15 7',
  failed: 'M6.5 6.5l7 7M13.5 6.5l-7 7',
  skipped: 'M6 10h8',
}

const STEP_TONE = {
  pending: 'bg-white text-slate-300 ring-1 ring-slate-200',
  running: 'bg-white text-sky-500 ring-1 ring-sky-300',
  done: 'bg-emerald-500 text-white',
  failed: 'bg-rose-500 text-white',
  skipped: 'bg-slate-300 text-white',
}

/** Which step the sync is on, so a failure is attributable rather than a line of text. */
function SyncProgress({ steps }) {
  if (!steps) return null
  return (
    <ol className="mt-3 list-none space-y-1.5 rounded-xl bg-slate-50 px-4 py-3 pl-4">
      {steps.map(s => (
        <li key={s.key} className="flex items-start gap-2.5">
          <span
            role="img"
            aria-label={`${s.label}: ${s.state}`}
            className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${STEP_TONE[s.state]}`}
          >
            <svg viewBox="0 0 20 20" className="size-2.5" fill="none" aria-hidden="true">
              {STEP_MARK[s.state] ? (
                <path d={STEP_MARK[s.state]} stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="tl-mark" />
              ) : (
                <circle cx="10" cy="10" r="4" fill="currentColor" className={s.state === 'running' ? 'tl-wait' : ''} />
              )}
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className={`text-xs font-medium ${s.state === 'pending' ? 'text-slate-400' : 'text-slate-700'}`}>
              {s.label}
            </span>
            {s.note && (
              <span className={`ml-1.5 text-xs ${s.state === 'failed' ? 'text-rose-600' : 'text-slate-500'}`}>
                {s.note}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}

export default function SyncSettings({ onSyncComplete }) {
  const [session, setSession] = useState(store.getSession())
  const [startDate, setStartDate] = useState(store.getStartDate())
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [disk, setDisk] = useState(null)
  const [gh, setGh] = useState(null)
  const [remote, setRemote] = useState(null)
  const [repo, setRepoState] = useState(getRepo())
  const [token, setToken] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [steps, setSteps] = useState(null)

  useEffect(() => subscribe(setDisk), [])
  useEffect(() => { githubStatus().then(setGh).catch(() => setGh(null)) }, [])

  const onRemoteState = useCallback(s => setRemote(s), [])

  const problemCount = Object.keys(store.getProblems()).length
  const lastSync = store.getLastSync()
  const syncSince = String(lastSync || startDate).slice(0, 10)

  // A fresh machine: nothing here yet, but the repository has a copy.
  const remoteHasData = !!remote && !remote.remote?.empty && (remote.remote?.keys || 0) > 0
  const needsRestore = problemCount === 0 && remoteHasData

  const run = async (label, fn) => {
    setBusy(label); setStatus(''); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  const step = (key, state, note) =>
    setSteps(prev => (prev || []).map(s => (s.key === key ? { ...s, state, note: note ?? s.note } : s)))

  /** Pull, fetch only what is newer, push. The whole round trip in one action. */
  const handleSync = () => run('sync', async () => {
    if (!session.trim()) throw new Error('Paste your LEETCODE_SESSION cookie first.')
    store.saveSession(session.trim())
    store.saveStartDate(startDate)

    const hasGh = !!gh?.hasToken
    const failed = []
    setSteps([
      { key: 'pull', label: 'Check GitHub for newer data', state: hasGh ? 'running' : 'skipped', note: hasGh ? '' : 'no token' },
      { key: 'fetch', label: 'Download from LeetCode', state: 'pending' },
      { key: 'push', label: 'Back up to GitHub', state: hasGh ? 'pending' : 'skipped', note: hasGh ? '' : 'no token' },
    ])

    // Step 1 — pull first, so another machine's work is merged before fetching
    // and the LeetCode window can start from the newest date either side holds.
    let resumeFrom = null
    if (hasGh) {
      try {
        const pulled = await pullFromGithub()
        if (pulled.empty) {
          step('pull', 'done', 'nothing published yet')
        } else {
          resumeFrom = pulled.resumeFrom
          const s = pulled.summary
          step('pull', 'done', `+${s.problemsAdded} problems, +${s.revisionsAdded} revisions, +${s.attemptsAdded} attempts`)
        }
      } catch (e) {
        failed.push('the GitHub check')
        step('pull', 'failed', e.message)
      }
    }

    // Step 2 — ask LeetCode only for what is newer than what is already held.
    const syncFrom = resumeFrom ? stepBackOneDay(resumeFrom) : lastSync || startDate
    const from = String(syncFrom).slice(0, 10)
    step('fetch', 'running', `since ${from}`)

    let merged, resubmissions
    try {
      const r = await syncProblems(
        session.trim(),
        syncFrom,
        m => step('fetch', 'running', `since ${from} · ${m}`),
        store.getProblems()
      )
      resubmissions = r.resubmissions
      merged = store.mergeProblems(r.results)
      for (const x of r.resubmissions) store.addRevision(x.slug, x.date)
      store.addFailures(r.failures)
      step('fetch', 'done', `${Object.keys(merged).length} problems, ${r.resubmissions.length} re-submissions`)
    } catch (e) {
      step('fetch', 'failed', e.message)
      throw e
    }

    // Step 3 — publish, so the coach and any other machine see the same facts.
    if (hasGh) {
      step('push', 'running')
      try {
        await saveNow({ force: true })
        const pushed = await pushToGithub()
        step('push', 'done', pushed.committed ? `commit ${pushed.committed}` : 'up to date')
      } catch (e) {
        failed.push('the backup')
        step('push', 'failed', e.message)
      }
    }

    // Downloaded work is saved locally either way; only the summary changes.
    setStatus(failed.length === 0
      ? `Sync complete — ${Object.keys(merged).length} problems, ${resubmissions.length} re-submissions.`
      : `Downloaded ${Object.keys(merged).length} problems, but ${failed.join(' and ')} failed. Your work is saved locally.`)
    onSyncComplete()
  })

  const handleRestore = () => run('restore', async () => {
    const r = await pullFromGithub()
    if (r.empty) {
      setStatus('The repository has no tracker copy yet.')
      return
    }
    const s = r.summary

    // The plan lives outside the tracker file, so restoring only the tracker
    // leaves a machine with evidence and no coaching.
    let plan = ''
    try {
      const c = await pullCoaching()
      if (c.empty) plan = ' No coaching plan published yet.'
      else if (!c.valid) plan = ' The published plan did not validate, so it was not adopted.'
      else {
        await saveDecision({
          ...c.decision,
          adoptedFrom: {
            repo: getRepo(),
            path: c.path || 'coaching/decision.json',
            commit: c.commit?.sha || null,
            shortCommit: c.commit?.shortSha || null,
            adoptedAt: new Date().toISOString(),
          },
        })
        plan = ` Coaching plan adopted${c.commit?.shortSha ? ` (${c.commit.shortSha})` : ''}.`
      }
    } catch (e) {
      plan = ` The tracker is restored, but the coaching plan could not be fetched: ${e.message}`
    }

    setStatus(`Restored +${s.problemsAdded} problems, +${s.revisionsAdded} revisions, +${s.attemptsAdded} graded attempts.${plan}`)
    onSyncComplete()
  })

  const handlePush = () => run('push', async () => {
    await saveNow({ force: true })
    const r = await pushToGithub()
    setStatus(`Pushed ${(r.bytes / 1024).toFixed(0)} KB${r.committed ? ` (${r.committed})` : ''}.`)
  })

  const handleToken = () => run('token', async () => {
    await saveToken(token)
    setToken('')
    setGh(await githubStatus())
    setStatus('Token saved to .github-token (gitignored).')
  })

  const handleClear = () => run('clear', async () => {
    if (!window.confirm('Clear all local data? The file on disk is cleared too (a .bak copy is kept).')) return
    localStorage.clear()
    await saveNow()
    setSession('')
    setStatus('All local data cleared.')
    onSyncComplete()
  })

  const diskUnavailable = disk?.status === 'unavailable'

  return (
    <div className="sync-page">
      <div className="tw space-y-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
          <h3 className="text-sm font-semibold text-slate-900">Your data</h3>
          <p className="mt-1 text-sm text-slate-500">
            Solves come from LeetCode, are mirrored to a file on disk, and are backed up to your
            repository so another machine can pick up where this one left off.
          </p>

          <div className="mt-4 flex items-start gap-3 overflow-x-auto rounded-xl bg-slate-50 px-4 py-3">
            <Hop
              label="LeetCode"
              value={session.trim() ? 'connected' : 'no cookie'}
              tone={session.trim() ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}
            />
            <Hop label="This browser" value={`${problemCount} problems`} />
            <Hop
              label="Disk"
              value={diskUnavailable ? 'unavailable' : (disk?.status || 'idle')}
              tone={DISK_STYLE[disk?.status] || DISK_STYLE.idle}
            />
            <Hop
              label="GitHub"
              last
              value={!gh?.hasToken ? 'no token' : remote?.behind ? 'behind' : remote ? 'in sync' : 'checking…'}
              tone={!gh?.hasToken || remote?.behind
                ? 'bg-amber-100 text-amber-800'
                : remote ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}
            />
          </div>

          {needsRestore && (
            <div className="mt-4 rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-200/60">
              <p className="text-sm font-medium text-sky-900">This looks like a new machine.</p>
              <p className="mt-0.5 text-xs text-sky-800">
                Nothing is stored here yet, but your repository has a copy. Restore it before syncing,
                so LeetCode is only asked for what is missing.
              </p>
              <button onClick={handleRestore} disabled={!!busy} className={`mt-2 ${btn.primary}`}>
                {busy === 'restore' ? 'Restoring…' : 'Restore everything from GitHub'}
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={handleSync} disabled={!!busy} className={btn.primary}>
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            {!needsRestore && gh?.hasToken && (
              <button onClick={handleRestore} disabled={!!busy} className={btn.ghost}>
                {busy === 'restore' ? 'Pulling…' : 'Pull from GitHub'}
              </button>
            )}
            <span className="text-xs text-slate-500">
              Fetches only submissions since {syncSince}, then backs up.
            </span>
          </div>

          <SyncProgress steps={steps} />

          {status && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200/60">{status}</p>}
          {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-900 ring-1 ring-rose-200/60">{error}</p>}

          {gh?.hasToken && (
            <div className="mt-3">
              <RemoteFreshness onState={onRemoteState} onPushed={onSyncComplete} />
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
          <h3 className="text-sm font-semibold text-slate-900">Connections</h3>

          <label className="mt-3 block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
              LEETCODE_SESSION cookie
            </span>
            <textarea
              value={session}
              onChange={e => setSession(e.target.value)}
              placeholder="Paste the cookie value…"
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
            />
            <span className="mt-1 block text-xs text-slate-400">
              DevTools (F12) → Application → Cookies → leetcode.com → LEETCODE_SESSION.
              Kept in the browser and deliberately excluded from the data file.
            </span>
          </label>

          <label className="mt-3 block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Repository</span>
            <input
              value={repo}
              onChange={e => setRepoState(e.target.value)}
              onBlur={() => setRepo(repo)}
              placeholder="owner/name"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
            />
          </label>

          {!gh?.hasToken ? (
            <label className="mt-3 block">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Personal access token
              </span>
              <div className="mt-1.5 flex gap-2">
                <input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="github_pat_…"
                  autoComplete="off"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
                />
                <button onClick={handleToken} disabled={!token.trim() || !!busy} className={btn.primary}>
                  Save
                </button>
              </div>
              <span className="mt-1 block text-xs text-slate-400">
                Needs <code className="rounded bg-slate-100 px-1">Contents: read and write</code> on that repo only.
                Stored in .github-token and never sent back to the browser.
              </span>
            </label>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Token loaded from {gh.tokenSource}. Tracker{' '}
              <code className="rounded bg-slate-100 px-1">{gh.remotePath}</code>, coaching{' '}
              <code className="rounded bg-slate-100 px-1">{gh.coachingPath}</code>.
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
          <button
            onClick={() => setAdvanced(v => !v)}
            aria-expanded={advanced}
            className="flex items-center gap-2 border-0 bg-transparent p-0 text-left"
          >
            <span className="text-[10px] text-slate-400">{advanced ? '▼' : '▶'}</span>
            <h3 className="text-sm font-semibold text-slate-900">Advanced</h3>
          </button>

          {advanced && (
            <div className="mt-3 space-y-4">
              <div>
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Full re-sync
                </span>
                <p className="mt-1 text-xs text-slate-500">
                  Normal syncing resumes from {syncSince}. Use this only to rebuild history from an
                  earlier date — it refetches everything since then.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-slate-400"
                  />
                  <button
                    onClick={() => { store.saveStartDate(startDate); handleSync() }}
                    disabled={!!busy}
                    className={btn.ghost}
                  >
                    Re-sync from this date
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Data file
                </span>
                {disk?.path && (
                  <code className="mt-1 block overflow-x-auto rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] text-slate-700">
                    {disk.path}
                  </code>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  {disk?.savedAt && <span>Last written {new Date(disk.savedAt).toLocaleString()}</span>}
                  {disk?.keys > 0 && <span>{disk.keys} keys</span>}
                  {disk?.error && <span className="text-rose-600">{disk.error}</span>}
                </div>
                {diskUnavailable && (
                  <p className="mt-1 text-xs text-amber-700">
                    No dev server behind this page, so data lives only in this browser.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => run('save', () => saveNow())} disabled={!!busy || diskUnavailable} className={btn.ghost}>
                    Save to disk
                  </button>
                  <button onClick={() => run('reload', () => reloadFromDisk())} disabled={!!busy || diskUnavailable} className={btn.ghost}>
                    Reload from disk
                  </button>
                  <button onClick={handlePush} disabled={!!busy || !gh?.hasToken} className={btn.ghost}>
                    Push to GitHub
                  </button>
                  {disk?.status === 'conflict' && (
                    <button
                      onClick={() => run('force', async () => {
                        if (!window.confirm('Overwrite the file with this browser’s data? The other profile’s changes are replaced (a .bak copy is kept).')) return
                        await saveNow({ force: true })
                      })}
                      disabled={!!busy}
                      className={btn.danger}
                    >
                      Overwrite anyway
                    </button>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <button onClick={handleClear} disabled={!!busy} className={btn.danger}>
                  Clear all local data
                </button>
                <p className="mt-1 text-xs text-slate-400">
                  Your repository copy is not touched, so this is recoverable with a pull.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
