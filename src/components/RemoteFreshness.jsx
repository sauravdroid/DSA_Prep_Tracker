import { useState, useEffect, useCallback } from 'react'
import { remoteStatus, pushToGithub } from '../utils/github'

/** Friendly names for the storage keys a reader would otherwise have to decode. */
const KEY_LABEL = {
  dsa_problems: 'solved problems',
  dsa_revisions: 'revisions',
  dsa_failures: 'failed submissions',
  dsa_practice_log: 'graded attempts',
  dsa_anchors: 'anchor configuration',
  dsa_topic_roles: 'topic roles',
  dsa_notes: 'notes',
  dsa_meta: 'schema version',
  dsa_today_rev_list: "today's revision list",
  dsa_start_date: 'start date',
  dsa_last_sync: 'last sync',
}

const label = k => KEY_LABEL[k] || k

/**
 * Whether the published tracker still matches local work.
 *
 * This matters beyond backup: the coach reads the tracker from the data
 * repository, so an unpushed anchor change means advice is authored against
 * facts that no longer hold, with nothing on screen to say so.
 */
export default function RemoteFreshness({ compact = false, onPushed }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const check = useCallback(() => {
    setError(null)
    remoteStatus().then(setState).catch(e => setError(e.message))
  }, [])

  useEffect(() => { check() }, [check])

  const push = async () => {
    setBusy(true)
    try {
      await pushToGithub()
      check()
      onPushed?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return compact ? null : (
      <p className="text-xs text-slate-400">Could not check the remote: {error}</p>
    )
  }
  if (!state) return null

  const stale = [...(state.missingOnRemote || []), ...(state.changedSincePush || [])]

  if (!state.behind) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Published tracker matches local work
        {state.remote?.savedAt && ` · ${state.remote.savedAt.slice(0, 10)}`}
      </p>
    )
  }

  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200/60">
      <p className="text-xs font-medium text-amber-900">
        {state.remote?.empty
          ? 'Nothing published yet — the coach cannot see your tracker.'
          : 'The published tracker is behind your local work.'}
      </p>
      {stale.length > 0 && (
        <p className="mt-0.5 text-xs text-amber-800">
          Not yet published: {stale.slice(0, 5).map(label).join(', ')}
          {stale.length > 5 && ` and ${stale.length - 5} more`}.
        </p>
      )}
      {state.ahead && (
        <p className="mt-0.5 text-xs text-amber-800">
          The remote is also newer in places — pull first so another machine's work is not lost.
        </p>
      )}
      <button
        onClick={push}
        disabled={busy}
        className="mt-2 rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? 'Pushing…' : 'Push now'}
      </button>
    </div>
  )
}
