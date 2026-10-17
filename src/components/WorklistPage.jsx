import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  LIST_LABEL, versionNumber, attemptsSince, latestAttemptBySlug, itemMode, sheetName,
} from '../utils/worklist'
import { loadAccepted } from '../utils/worklistStore'
import { subscribeSync } from '../utils/autoSync'
import { backupIfConnected, worklistPreview } from '../utils/github'
import WorklistDrawer from './WorklistDrawer'
import WorklistReview from './WorklistReview'
import Roadmap from './Roadmap'
import ColdTestModal from './ColdTestModal'
import * as store from '../store'

const DIFF_TONE = { Easy: 'text-[#00b8a3]', Medium: 'text-[#ffb800]', Hard: 'text-[#ff375f]' }

function shortDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function idDate(id) {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(id || '')
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

/** Filled when you have recorded an attempt the coach has not seen yet. */
function StatusIcon({ attempt }) {
  if (!attempt) {
    return (
      <svg viewBox="0 0 16 16" className="size-4" aria-label="Not attempted">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
      </svg>
    )
  }
  const fill = attempt.result === 'green' ? '#00b8a3' : attempt.result === 'yellow' ? '#ffb800' : '#ff375f'
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-label={`Recorded ${attempt.result}`}>
      <circle cx="8" cy="8" r="7" fill={fill} />
      {attempt.result === 'green' && <path d="M4.8 8.3l2.1 2.1 4.3-4.6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {attempt.result === 'yellow' && <path d="M5 8h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
      {attempt.result === 'red' && <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  )
}

function SyncButton({ onClick, available }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 5.5A5.5 5.5 0 0 0 3.2 4M3 10.5A5.5 5.5 0 0 0 12.8 12" />
        <path d="M3 1.8V4.3h2.5M13 14.2v-2.5h-2.5" />
      </svg>
      Sync
      {available && (
        <span className="rounded-full bg-[#ffa116] px-1.5 py-px text-[10px] font-bold text-white">
          {available.number ? `v${available.number}` : 'new'}
        </span>
      )}
    </button>
  )
}

/** Every sheet the coach has published, newest first. */
function SheetPicker({ manifest, currentId, shownId, onPick }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const versions = [...(manifest?.versions || [])].map((v, i) => ({ ...v, number: i + 1 })).reverse()

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        All sheets
        <span className="text-xs text-slate-400">{versions.length}</span>
        <svg viewBox="0 0 12 12" className="size-3 text-slate-400" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-[22rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="max-h-80 overflow-y-auto py-1">
            {versions.map(v => (
              <button
                key={v.id}
                onClick={() => { setOpen(false); onPick(v.id) }}
                className={`flex w-full items-start gap-3 border-0 bg-transparent px-3.5 py-2.5 text-left hover:bg-slate-50 ${v.id === shownId ? 'bg-slate-50' : ''}`}
              >
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-px font-mono text-[11px] ${v.id === currentId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  v{v.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{v.name || `Sheet ${v.number}`}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {idDate(v.id)}{v.summary ? ` · ${v.summary}` : ''}
                  </span>
                </span>
                {v.id === currentId && <span className="mt-0.5 shrink-0 text-[10px] font-bold uppercase text-emerald-600">current</span>}
              </button>
            ))}
          </div>
          <p className="border-t border-slate-100 bg-slate-50 px-3.5 py-2 text-[11px] text-slate-500">
            Sync to see sheets published since you last looked.
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ rank, item, attempt, selected, onOpen }) {
  return (
    <button
      onClick={() => onOpen(item)}
      className={`grid h-12 w-full grid-cols-[1.5rem_1.25rem_minmax(0,1fr)_4.5rem_3.5rem] items-center gap-3 border-0 border-t border-slate-100 px-4 text-left transition first:border-t-0 even:bg-[#f7f8fa] hover:bg-slate-100 ${
        selected ? '!bg-[#fff7ea] shadow-[inset_3px_0_0_#ffa116]' : ''
      }`}
    >
      <span className="text-right text-xs font-semibold tabular-nums text-slate-400">{rank}</span>
      <StatusIcon attempt={attempt} />
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className="shrink-0 font-medium text-slate-900">
          {item.number ? `${item.number}. ` : ''}{item.title}
        </span>
        {item.flag === 'repair' && (
          <span className="shrink-0 rounded bg-[#ffe8ed] px-1.5 py-px text-[11px] font-semibold text-[#ff375f] ring-1 ring-[#ff375f]/20">
            Repair
          </span>
        )}
        <span className="truncate text-[13px] text-slate-400">{item.reason}</span>
      </span>
      <span className={`text-[13px] font-medium ${DIFF_TONE[item.difficulty] || 'text-slate-400'}`}>
        {item.difficulty || ''}
      </span>
      <span className="text-right text-xs text-slate-400">{item.minutes ? `${item.minutes} min` : ''}</span>
    </button>
  )
}

function Summary({ headline, summary }) {
  const long = (summary || '').length > 320
  const [expanded, setExpanded] = useState(false)
  return (
    <section className="mt-4 rounded-[10px] border border-[#ffe2b3] bg-[#fff7ea] px-4 py-3">
      <div className="flex items-baseline gap-2.5">
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[#c2410c]">Coach</span>
        <p className="text-[13px] font-medium text-zinc-800">{headline}</p>
      </div>
      {summary && (
        <div className="mt-2 pl-[3.1rem] text-[13px] leading-relaxed text-zinc-700">
          <p className={`whitespace-pre-line ${long && !expanded ? 'line-clamp-3' : ''}`}>{summary}</p>
          {long && (
            <button onClick={() => setExpanded(e => !e)} className="mt-1 text-xs font-semibold text-[#c2410c] underline-offset-2 hover:underline">
              {expanded ? 'Show less' : 'Read the full summary'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function EmptyState({ onSync, unavailable, available }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-semibold text-slate-900">No prep sheet yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        {unavailable
          ? 'The local data server is not reachable, so your sheet cannot be read.'
          : 'The coach publishes prep sheets to your data repository. Sync to review the latest one and make it your current sheet.'}
      </p>
      <div className="mt-5"><SyncButton onClick={onSync} available={available} /></div>
    </div>
  )
}

export default function WorklistPage({ problems, practiceLog: log = [], onChanged }) {
  const [accepted, setAccepted] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [latestManifest, setLatestManifest] = useState(null)
  const [tab, setTab] = useState(null)
  const [showRoadmap, setShowRoadmap] = useState(true)
  const [open, setOpen] = useState(null)
  const [recording, setRecording] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const [available, setAvailable] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    loadAccepted().then(r => {
      setAccepted(r.accepted)
      setUnavailable(!r.available)
      setLoaded(true)
    })
  }, [])
  useEffect(() => subscribeSync(s => setAvailable(s.worklistAvailable)), [])

  const current = accepted?.version || null
  const sheet = viewing?.version || current
  const manifest = latestManifest || viewing?.manifest || accepted?.manifest
  const number = versionNumber(manifest, sheet?.id)
  const unseen = useMemo(() => attemptsSince(sheet, log), [sheet, log])
  const latestBySlug = useMemo(() => latestAttemptBySlug(sheet, log), [sheet, log])

  const count = list => (sheet?.[list] || []).reduce((n, g) => n + g.items.length, 0)
  const activeTab = tab || (count('revision') || !count('new') ? 'revision' : 'new')
  const groups = sheet?.[activeTab] || []

  const pick = useCallback(async id => {
    setTab(null)
    if (!id || id === current?.id) { setViewing(null); return }
    setViewing({ id, loading: true })
    try {
      const r = await worklistPreview({ id })
      if (r.empty || !r.version) throw new Error('That sheet could not be read.')
      setLatestManifest(r.manifest)
      setViewing({ id, version: r.version, manifest: r.manifest, valid: r.valid })
    } catch (e) {
      setViewing(null)
      setNotice({ tone: 'warn', text: `Could not open that sheet: ${e.message}` })
    }
  }, [current?.id])

  const saveAttempt = useCallback(entry => {
    store.recordAttempt(entry)
    setRecording(null)
    onChanged?.()
    setNotice({ tone: 'info', text: 'Recorded · publishing…' })
    backupIfConnected()
      .then(r => setNotice(r.skipped
        ? { tone: 'info', text: 'Recorded locally. Connect GitHub in Settings so the coach can see it.' }
        : { tone: 'ok', text: `Recorded and published${r.committed ? ` (${r.committed})` : ''}. The coach can see it.` }))
      .catch(e => setNotice({ tone: 'warn', text: `Recorded locally, but publishing failed: ${e.message}` }))
  }, [onChanged])

  const problemOf = item => problems[item.slug] || {
    slug: item.slug,
    title: item.title,
    difficulty: item.difficulty,
    url: `https://leetcode.com/problems/${item.slug}/`,
    tags: [],
  }

  return (
    <div className="tw">
      <div className="mx-auto w-full max-w-[960px] pb-16 pt-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Prep sheet
              {number && <span className="normal-case"> · v{number}</span>}
              {viewing && !viewing.loading ? ' · older sheet' : ''}
            </p>
            <h1 className="mt-0.5 truncate text-[22px] font-bold tracking-tight text-slate-900">
              {sheet ? sheetName(sheet, number) : 'Prep sheet'}
            </h1>
            {sheet && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-slate-500">
                <span>By coach, {shortDate(sheet.writtenAt)}</span>
                <span className="size-[3px] rounded-full bg-slate-300" aria-hidden="true" />
                <span>based on {sheet.basedOn?.attempts ?? '?'} attempts</span>
                {!viewing && unseen.length > 0 && (
                  <>
                    <span className="size-[3px] rounded-full bg-slate-300" aria-hidden="true" />
                    <span className="font-medium text-[#c2410c]">
                      {unseen.length} new attempt{unseen.length === 1 ? '' : 's'} since
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          {manifest && <SheetPicker manifest={manifest} currentId={current?.id} shownId={sheet?.id} onPick={pick} />}
          {current && <SyncButton onClick={() => setReviewing({})} available={available} />}
        </div>

        {viewing && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-900 px-4 py-2.5 text-[13px] text-white">
            <span className="flex-1">
              {viewing.loading ? 'Opening sheet…' : "You're looking at an older sheet. Your current sheet is unchanged."}
            </span>
            {!viewing.loading && (
              <button onClick={() => setReviewing({ id: viewing.id })} className="rounded-md bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20">
                Make this my current sheet
              </button>
            )}
            <button onClick={() => pick(current?.id)} className="rounded-md bg-white px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100">
              Back to current
            </button>
          </div>
        )}

        {notice && (
          <div className={`mt-4 flex items-start gap-3 rounded-lg px-4 py-2.5 text-[13px] ring-1 ${
            notice.tone === 'warn' ? 'bg-amber-50 text-amber-900 ring-amber-200'
              : notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                : 'bg-slate-50 text-slate-600 ring-slate-200'
          }`}>
            <span className="flex-1">{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-xs font-medium underline-offset-2 hover:underline">Dismiss</button>
          </div>
        )}

        {loaded && !current && !viewing && (
          <EmptyState onSync={() => setReviewing({})} unavailable={unavailable} available={available} />
        )}

        {sheet && (
          <>
            <Summary key={sheet.id} headline={sheet.headline} summary={sheet.summary} />

            <section className="mt-4 rounded-[10px] border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <h2 className="text-[13px] font-bold text-slate-900">Roadmap</h2>
                <span className="flex-1 text-xs text-slate-400">
                  {showRoadmap ? 'Every problem on this sheet, in the order to work through them. Click one to open it.' : ''}
                </span>
                <button onClick={() => setShowRoadmap(s => !s)} className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline">
                  {showRoadmap ? 'Hide' : 'Show'}
                </button>
              </div>
              {showRoadmap && (
                <div className="mt-3">
                  <Roadmap sheet={sheet} attempts={latestBySlug} selected={open?.slug} onOpen={setOpen} />
                </div>
              )}
            </section>

            <div className="mt-5 flex items-end gap-6 border-b border-slate-200">
              {['revision', 'new'].map(list => (
                <button
                  key={list}
                  onClick={() => setTab(list)}
                  className={`-mb-px flex items-center gap-2 border-0 border-b-2 bg-transparent px-0.5 pb-2.5 text-sm font-semibold transition ${
                    activeTab === list ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {LIST_LABEL[list]}
                  <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${
                    activeTab === list ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {count(list)}
                  </span>
                </button>
              ))}
            </div>

            {groups.length === 0 && (
              <p className="mt-8 text-center text-sm text-slate-400">
                Nothing in {LIST_LABEL[activeTab]} on this sheet.
              </p>
            )}

            {groups.map(group => {
              const done = group.items.filter(i => latestBySlug.has(i.slug)).length
              return (
                <section key={group.pattern} className="mt-6">
                  <div className="flex items-baseline gap-2.5 px-1 pb-2">
                    <h2 className="text-[15px] font-bold text-slate-900">{group.pattern}</h2>
                    <span className="text-xs font-semibold text-slate-400">{done} / {group.items.length}</span>
                    {group.note && <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{group.note}</span>}
                  </div>
                  <div className="overflow-hidden rounded-[10px] border border-slate-200 bg-white">
                    {group.items.map((item, i) => (
                      <Row
                        key={item.slug}
                        rank={i + 1}
                        item={{ ...item, list: activeTab, pattern: group.pattern }}
                        attempt={latestBySlug.get(item.slug)}
                        selected={open?.slug === item.slug}
                        onOpen={setOpen}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}
      </div>

      {open && (
        <WorklistDrawer
          item={open}
          problem={problemOf(open)}
          attempts={log.filter(e => e.slug === open.slug)}
          unseen={latestBySlug.get(open.slug)}
          onRecord={() => setRecording(open)}
          onClose={() => setOpen(null)}
        />
      )}

      {recording && (
        <ColdTestModal
          slug={recording.slug}
          problem={problemOf(recording)}
          defaultMode={itemMode(recording, recording.list)}
          existing={store.practiceEntryFor(recording.slug)}
          schedulePreview={false}
          onClose={() => setRecording(null)}
          onSave={saveAttempt}
        />
      )}

      {reviewing && (
        <WorklistReview
          accepted={accepted}
          initialId={reviewing.id}
          practiceLog={log}
          onManifest={setLatestManifest}
          onClose={() => setReviewing(null)}
          onAccepted={record => {
            setAccepted(record)
            setLatestManifest(record.manifest)
            setReviewing(null)
            setViewing(null)
            setTab(null)
                    setNotice({ tone: 'ok', text: `“${sheetName(record.version, record.source?.number)}” is now your current sheet.` })
          }}
        />
      )}
    </div>
  )
}
