import { useState, useEffect } from 'react'
import { subscribeSync, syncNow, setEnabled, STEPS } from '../utils/autoSync'

const MARK = {
  pending: { glyph: '·', tone: 'text-slate-300' },
  running: { glyph: '◐', tone: 'text-sky-600' },
  done: { glyph: '✓', tone: 'text-emerald-600' },
  skipped: { glyph: '–', tone: 'text-slate-400' },
  failed: { glyph: '!', tone: 'text-rose-600' },
}

function relative(iso, now) {
  if (!iso) return null
  const secs = Math.round((now - new Date(iso).getTime()) / 1000)
  const ahead = secs < 0
  const n = Math.abs(secs)
  const text = n < 60 ? `${n}s` : n < 3600 ? `${Math.round(n / 60)}m` : `${Math.round(n / 3600)}h`
  return ahead ? `in ${text}` : `${text} ago`
}

/**
 * What the background sync is doing, kept on screen rather than in a toast that
 * disappears before it can be read. Collapsed it says whether anything changed;
 * expanded it says which step produced that.
 */
export default function SyncDock() {
  const [s, setS] = useState(null)
  const [open, setOpen] = useState(false)
  // Relative times are only honest if something re-renders them.
  const [now, setNow] = useState(Date.now())

  useEffect(() => subscribeSync(setS), [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  if (!s) return null

  const tone = s.running
    ? 'ring-sky-200 bg-white'
    : s.failed
      ? 'ring-amber-300 bg-amber-50'
      : 'ring-slate-200 bg-white'

  return (
    <div className="tw pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-900/10">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Background sync</p>
              <p className="text-[11px] text-slate-500">
                {s.enabled
                  ? s.running
                    ? 'Running now'
                    : `Next ${relative(s.nextRunAt, now) || 'soon'}`
                  : 'Paused'}
                {s.lastRunAt && ` · last ${relative(s.lastRunAt, now)}`}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="-m-1 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <span className="sr-only">Collapse</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-1.5 px-4 py-3">
            {(s.steps || STEPS).map(st => {
              const m = MARK[st.state] || MARK.pending
              return (
                <div key={st.key} className="flex items-start gap-2 text-xs">
                  <span className={`w-3 shrink-0 text-center font-bold ${m.tone} ${st.state === 'running' ? 'animate-pulse' : ''}`}>
                    {m.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={st.state === 'pending' ? 'text-slate-400' : 'text-slate-700'}>{st.label}</span>
                    {st.note && <span className="block text-[11px] text-slate-500">{st.note}</span>}
                  </span>
                </div>
              )
            })}
          </div>

          {s.log?.length > 0 && (
            <div className="max-h-40 overflow-y-auto border-t border-slate-100 px-4 py-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">What changed</p>
              {s.log.map(e => (
                <p key={e.id} className="text-[11px] leading-relaxed text-slate-600">
                  <span className="tabular-nums text-slate-400">{e.at.slice(11, 16)}</span> {e.text}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
            <button
              onClick={() => setEnabled(!s.enabled)}
              className="text-[11px] font-medium text-slate-500 underline-offset-2 hover:underline"
            >
              {s.enabled ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={() => syncNow()}
              disabled={s.running}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-300"
            >
              {s.running ? 'Checking…' : 'Check now'}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        className={`pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium shadow-lg ring-1 transition hover:shadow-xl ${tone}`}
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            s.running ? 'animate-pulse bg-sky-500' : s.failed ? 'bg-amber-500' : 'bg-emerald-500'
          }`}
          aria-hidden="true"
        />
        <span className="max-w-[16rem] truncate text-slate-700">
          {s.running ? 'Syncing…' : s.summary || 'Sync idle'}
        </span>
      </button>
    </div>
  )
}
