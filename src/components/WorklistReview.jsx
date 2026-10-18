import { useEffect, useState, useCallback, useMemo } from 'react'
import { worklistPreview, getRepo } from '../utils/github'
import { acceptWorklist } from '../utils/worklistStore'
import { worklistAccepted } from '../utils/autoSync'
import { diffWorklists, changesByList, attemptsSince, sheetName, normalizeManifest, LIST_LABEL } from '../utils/worklist'

const ANIM_MS = 200

const OP = {
  added: { glyph: '+', tone: 'bg-[#e7f8f4] text-[#047857]', label: 'Added' },
  removed: { glyph: '−', tone: 'bg-[#ffe8ed] text-[#be123c]', label: 'Removed' },
  modified: { glyph: '~', tone: 'bg-[#fff6dc] text-[#b77f00]', label: 'Changed' },
  moved: { glyph: '→', tone: 'bg-violet-100 text-violet-700', label: 'Moved' },
}

function when(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Check({ ok, warn, children }) {
  const tone = ok ? 'bg-[#e7f8f4] text-[#047857]' : warn ? 'bg-amber-50 text-amber-800' : 'bg-[#ffe8ed] text-[#be123c]'
  return <span className={`rounded-md px-2 py-0.5 text-xs ${tone}`}>{ok ? '✓' : warn ? '!' : '✕'} {children}</span>
}

/**
 * Shows what the coach has published before anything changes: a different
 * current sheet, or an update to the one you follow. Applying stores the
 * exact snapshot shown here; anything newer needs its own review.
 */
export default function WorklistReview({ accepted, initialId, practiceLog, onManifest, onClose, onAccepted }) {
  const [shown, setShown] = useState(false)
  const [phase, setPhase] = useState('loading')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showSheets, setShowSheets] = useState(false)

  const current = accepted?.version || null
  const known = useMemo(() => (normalizeManifest(accepted?.manifest)?.sheets || []).map(s => s.id), [accepted?.manifest])

  const close = useCallback(() => {
    setShown(false)
    setTimeout(onClose, ANIM_MS)
  }, [onClose])

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { cancelAnimationFrame(id); window.removeEventListener('keydown', onKey) }
  }, [close])

  const load = useCallback(async id => {
    setPhase('loading')
    setError(null)
    try {
      const r = await worklistPreview({ id, knownSheets: known })
      setResult(r)
      if (r.manifest) onManifest?.(r.manifest)
      setPhase('ready')
    } catch (e) {
      setError(e.message)
      setPhase('error')
    }
  }, [known, onManifest])

  // Publishing your attempts is the background sync's job; the review only
  // reads. Runs once when the panel opens; later loads come from picking a sheet.
  useEffect(() => { load(initialId) }, [])

  const view = useMemo(() => {
    if (!result || result.empty || !result.manifest) return null
    const next = result.version
    const manifest = normalizeManifest(result.manifest)
    const sameSheet = !!current && current.id === result.id
    const kind = sameSheet && accepted?.source?.hash === result.hash
      ? 'current'
      : sameSheet ? 'updated' : 'switch'
    const recommended = result.id === manifest.current
    const archived = !!result.entry?.archived
    const diff = next && kind !== 'current' ? diffWorklists(current, next) : null
    const unseen = next ? attemptsSince(next, practiceLog).length : 0
    return { next, manifest, kind, recommended, archived, diff, unseen }
  }, [result, current, accepted?.source?.hash, practiceLog])

  const canApply = !!view && view.kind !== 'current' && !!result?.valid && (result.problems || []).length === 0

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const record = await acceptWorklist({
        version: result.version,
        manifest: result.manifest,
        source: {
          repo: getRepo(),
          commit: result.commit,
          shortCommit: result.shortCommit,
          hash: result.hash,
          authored: result.authored,
        },
      })
      worklistAccepted(result.id)
      onAccepted(record)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const grouped = view?.diff ? changesByList(view.diff) : null
  const title = !view ? ''
    : view.kind === 'current' ? (view.recommended ? "You're up to date" : 'This is your current sheet')
      : view.kind === 'updated' ? 'The coach updated your sheet'
        : view.archived ? 'Archived sheet'
          : view.recommended ? 'New current sheet from the coach' : 'Another sheet'
  const currentName = current ? sheetName(current, accepted?.manifest) : null

  return (
    <div
      className={`fixed inset-0 z-[45] flex justify-end bg-slate-900/20 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      onClick={close}
    >
      <aside
        className={`tw flex h-full w-full max-w-[540px] flex-col border-l border-slate-200 bg-white shadow-[-16px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-200 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-2.5 text-xs text-slate-500">
            <span>Review</span>
            <span className="size-[3px] rounded-full bg-slate-300" aria-hidden="true" />
            <span className="truncate">{getRepo()}</span>
            <button
              onClick={close}
              className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
            >
              <span className="sr-only">Close</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {phase === 'loading' && (
            <p className="mt-8 text-sm text-slate-500">Reading the coach’s sheets…</p>
          )}

          {phase === 'error' && (
            <p className="mt-6 rounded-lg bg-[#ffe8ed] px-3 py-2 text-sm text-[#be123c]">{error}</p>
          )}

          {phase === 'ready' && result?.empty && (
            <div className="mt-6">
              <h2 className="text-xl font-bold text-slate-900">Nothing published yet</h2>
              <p className="mt-2 text-sm text-slate-500">
                The coach has not written <code className="rounded bg-slate-100 px-1 text-xs">coaching/worklists/manifest.json</code> yet.
              </p>
            </div>
          )}

          {phase === 'ready' && view && (
            <>
              <h2 className="mt-3 text-xl font-bold text-slate-900">{title}</h2>
              {view.next && (
                <p className="mt-1 text-[15px] font-semibold text-slate-700">{sheetName(view.next, result.manifest)}</p>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                {view.kind === 'updated' && (
                  <>
                    <span className="rounded-md bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-500">Your copy · {when(current.writtenAt)}</span>
                    <span className="text-slate-400">→</span>
                    <span className="rounded-md bg-[#fff1db] px-2.5 py-0.5 font-semibold text-[#b45309]">Coach’s update · {when(view.next?.writtenAt)}</span>
                  </>
                )}
                {view.kind === 'switch' && (
                  <>
                    {currentName && (
                      <>
                        <span className="max-w-[12rem] truncate rounded-md bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-500">{currentName}</span>
                        <span className="text-slate-400">→</span>
                      </>
                    )}
                    <span className={`rounded-md px-2.5 py-0.5 font-semibold ${view.archived ? 'bg-slate-100 text-slate-500' : 'bg-[#fff1db] text-[#b45309]'}`}>
                      {view.archived ? 'Archived' : view.recommended ? 'Recommended by the coach' : 'Not the coach’s current sheet'}
                    </span>
                  </>
                )}
                {view.kind === 'current' && (
                  <span className="rounded-md bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-600">Last updated {when(view.next?.writtenAt)}</span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Check ok={result.valid}>{result.valid ? 'Valid sheet' : 'Invalid sheet'}</Check>
                <Check ok={(result.problems || []).length === 0}>
                  {(result.problems || []).length === 0 ? 'Only coaching/worklists/ changed' : 'Publishing rules broken'}
                </Check>
                {view.next && (
                  <Check ok={view.unseen === 0} warn>
                    {view.unseen === 0
                      ? 'Saw all your attempts'
                      : `${view.unseen} attempt${view.unseen === 1 ? '' : 's'} recorded after it was written`}
                  </Check>
                )}
              </div>

              {[...(result.errors || []), ...(result.problems || [])].length > 0 && (
                <ul className="mt-3 list-none space-y-1 rounded-lg bg-[#fff1f3] px-3 py-2 pl-3">
                  {[...(result.errors || []), ...(result.problems || [])].slice(0, 8).map(e => (
                    <li key={e} className="text-xs text-[#be123c]">· {e}</li>
                  ))}
                </ul>
              )}

              {view.next && (
                <section className="mt-5">
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Coach says</h3>
                  <div className="rounded-lg border border-l-[3px] border-[#ffe7c2] border-l-[#ffa116] bg-[#fffaf2] px-4 py-3">
                    <p className="text-sm font-medium leading-relaxed text-slate-900">{view.next.headline}</p>
                    {view.next.summary && (
                      <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-zinc-700">{view.next.summary}</p>
                    )}
                  </div>
                </section>
              )}

              {grouped && (
                <p className="mt-5 text-xs text-slate-500">
                  {view.diff.total === 0
                    ? 'Same problems as your current sheet.'
                    : view.kind === 'updated'
                      ? 'What changed since your copy:'
                      : `Compared with ${currentName ? `“${currentName}”` : 'your current sheet'}:`}
                </p>
              )}

              {grouped && view.diff.total > 0 && ['revision', 'new'].map(list => (
                <section key={list} className="mt-3">
                  <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {LIST_LABEL[list]}
                    <span className="ml-1.5 normal-case tracking-normal text-slate-500">
                      {view.diff.counts[list].before} → {view.diff.counts[list].after}
                    </span>
                  </h3>
                  {grouped[list].length === 0 ? (
                    <p className="py-1.5 text-xs text-slate-400">No changes.</p>
                  ) : grouped[list].map(c => (
                    <div key={`${c.op}:${c.slug}`} className="grid grid-cols-[1.25rem_1fr] items-baseline gap-2.5 border-b border-slate-100 py-2 last:border-b-0">
                      <span title={OP[c.op].label} className={`flex size-5 items-center justify-center rounded text-[13px] font-bold ${OP[c.op].tone}`}>
                        {OP[c.op].glyph}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">
                          {c.number ? `${c.number}. ` : ''}{c.title}
                          <span className="ml-1.5 text-xs font-normal text-slate-400">{c.pattern}</span>
                        </span>
                        <span className="block text-xs text-slate-500">
                          {c.op === 'moved' && `From ${LIST_LABEL[c.from]}. `}
                          {c.op === 'modified' && !c.reason && `Changed: ${c.fields.join(', ')}`}
                          {c.reason}
                        </span>
                      </span>
                    </div>
                  ))}
                </section>
              ))}

              <section className="mt-6">
                <button
                  onClick={() => setShowSheets(v => !v)}
                  className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
                >
                  {showSheets ? 'Hide' : 'Show'} all sheets ({view.manifest.sheets.length})
                </button>
                {showSheets && (
                  <ul className="mt-2 list-none space-y-0 pl-0">
                    {[...view.manifest.sheets].reverse().map((s, i, all) => (
                      <li key={s.id}>
                        <button
                          onClick={() => load(s.id)}
                          className={`flex w-full items-center gap-2.5 border-0 border-b border-slate-100 bg-transparent py-1.5 text-left text-xs hover:bg-slate-50 ${s.id === result.id ? 'font-semibold' : ''}`}
                        >
                          <span className={`min-w-0 flex-1 truncate ${s.archived ? 'text-slate-400' : 'text-slate-700'}`}>
                            {s.name || `Sheet ${all.length - i}`}
                          </span>
                          <span className="shrink-0 text-slate-400">{when(s.updatedAt)}</span>
                          {s.id === view.manifest.current && <span className="rounded bg-[#fff1db] px-1.5 text-[10px] font-bold uppercase text-[#b45309]">coach’s pick</span>}
                          {s.id === current?.id && <span className="rounded bg-slate-900 px-1.5 text-[10px] font-bold uppercase text-white">yours</span>}
                          {s.archived && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold uppercase text-slate-500">archived</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-6 py-3.5">
          {phase === 'ready' && view && view.kind !== 'current' && (
            <button
              onClick={apply}
              disabled={!canApply || busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {busy ? 'Saving…' : view.kind === 'updated' ? 'Apply update' : 'Make this my current sheet'}
            </button>
          )}
          <button onClick={close} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            {view?.kind === 'current' || !view ? 'Close' : 'Not now'}
          </button>
          {error && phase === 'ready' && <span className="ml-2 min-w-0 flex-1 truncate text-xs text-[#be123c]">{error}</span>}
          {!error && currentName && view && view.kind !== 'current' && (
            <span className="ml-auto truncate text-xs text-slate-400">Nothing changes until you choose.</span>
          )}
        </div>
      </aside>
    </div>
  )
}
