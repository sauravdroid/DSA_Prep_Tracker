import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  LIST_LABEL, normalizeManifest, sheetEntry, attemptsSince, latestAttemptBySlug, itemMode, sheetName,
} from '../utils/worklist'
import { loadAccepted } from '../utils/worklistStore'
import { subscribeSync, syncNow } from '../utils/autoSync'
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

/**
 * Shown only when the background check found something to review. Syncing
 * itself belongs to the background panel; this opens the review.
 */
function ReviewButton({ onClick, available }) {
  if (!available) return null
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
    >
      <span className="size-2 rounded-full bg-[#ffa116]" aria-hidden="true" />
      {available.kind === 'updated' ? 'Review update' : 'Review new sheet'}
    </button>
  )
}

function PickerRow({ sheet, currentId, shownId, onPick }) {
  return (
    <button
      onClick={() => onPick(sheet.id)}
      className={`flex w-full items-start gap-3 border-0 bg-transparent px-3.5 py-2.5 text-left hover:bg-slate-50 ${sheet.id === shownId ? 'bg-slate-50' : ''}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${sheet.archived ? 'text-slate-500' : 'text-slate-900'}`}>{sheet.label}</span>
        <span className="block truncate text-xs text-slate-500">
          {sheet.updatedAt && sheet.updatedAt !== sheet.createdAt
            ? `Updated ${shortDate(sheet.updatedAt)}`
            : `Created ${shortDate(sheet.createdAt)}`}
          {sheet.summary ? ` · ${sheet.summary}` : ''}
        </span>
      </span>
      {sheet.id === currentId && <span className="mt-0.5 shrink-0 text-[10px] font-bold uppercase text-emerald-600">yours</span>}
    </button>
  )
}

/** Every sheet the coach has published, newest first; archived ones apart. */
function SheetPicker({ manifest, currentId, shownId, onPick }) {
  const [open, setOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const all = (normalizeManifest(manifest)?.sheets || []).map((s, i) => ({ ...s, label: s.name || `Sheet ${i + 1}` })).reverse()
  const active = all.filter(s => !s.archived)
  const archived = all.filter(s => s.archived)
  const pick = id => { setOpen(false); onPick(id) }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        All sheets
        <span className="text-xs text-slate-400">{active.length}</span>
        <svg viewBox="0 0 12 12" className="size-3 text-slate-400" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-[22rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="max-h-96 overflow-y-auto py-1">
            {active.map(s => <PickerRow key={s.id} sheet={s} currentId={currentId} shownId={shownId} onPick={pick} />)}
            {active.length === 0 && <p className="px-3.5 py-2.5 text-xs text-slate-400">No active sheets.</p>}
            {archived.length > 0 && (
              <>
                <button
                  onClick={() => setShowArchived(a => !a)}
                  className="flex w-full items-center gap-1.5 border-0 border-t border-slate-100 bg-transparent px-3.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600"
                >
                  Archived · {archived.length}
                  <svg viewBox="0 0 12 12" className={`size-3 transition ${showArchived ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
                {showArchived && archived.map(s => <PickerRow key={s.id} sheet={s} currentId={currentId} shownId={shownId} onPick={pick} />)}
              </>
            )}
          </div>
          <p className="border-t border-slate-100 bg-slate-50 px-3.5 py-2 text-[11px] text-slate-500">
            The coach creates, updates and archives sheets. Changes show up here after the background sync.
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

/** The coach's headline and summary, behind an info icon next to the sheet name. */
function CoachInfo({ headline, summary }) {
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

  if (!headline && !summary) return null
  return (
    <span ref={ref} className="relative inline-flex shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="What the coach says about this sheet"
        title="What the coach says about this sheet"
        className={`flex size-7 items-center justify-center rounded-full transition ${open ? 'bg-[#fff1db] text-[#c2410c]' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
      >
        <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v4.5" strokeLinecap="round" />
          <circle cx="10" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[min(36rem,85vw)] rounded-xl border border-l-[3px] border-[#ffe2b3] border-l-[#ffa116] bg-[#fffaf2] px-5 py-4 text-left shadow-xl">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#c2410c]">Coach</p>
          {headline && <p className="mt-1 text-sm font-semibold leading-snug text-slate-900">{headline}</p>}
          {summary && (
            <p className="mt-2 max-h-[55vh] overflow-y-auto whitespace-pre-line text-[13px] font-normal leading-relaxed text-zinc-700">{summary}</p>
          )}
        </div>
      )}
    </span>
  )
}

function EmptyState({ onReview, unavailable, available, checking }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-semibold text-slate-900">No prep sheet yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        {unavailable
          ? 'The local data server is not reachable, so your sheet cannot be read.'
          : available
            ? 'The coach has published a sheet. Review it and make it your current sheet.'
            : 'The background sync checks for the coach’s sheets every 10 minutes. Nothing has been published yet.'}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <ReviewButton onClick={onReview} available={available} />
        {!available && !unavailable && (
          <button
            onClick={() => syncNow()}
            disabled={checking}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check now'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function WorklistPage({ problems, practiceLog: log = [], onChanged, reviewRequest = 0, onReviewOpened }) {
  const [accepted, setAccepted] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [latestManifest, setLatestManifest] = useState(null)
  const [tab, setTab] = useState(null)
  const [open, setOpen] = useState(null)
  const [recording, setRecording] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const [available, setAvailable] = useState(null)
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    loadAccepted().then(r => {
      setAccepted(r.accepted)
      setUnavailable(!r.available)
      setLoaded(true)
    })
  }, [])
  useEffect(() => subscribeSync(s => {
    setAvailable(s.worklistAvailable)
    setChecking(s.running)
  }), [])
  // The background panel's Review link lands here, once per click.
  useEffect(() => {
    if (!reviewRequest) return
    setReviewing({})
    onReviewOpened?.()
  }, [reviewRequest, onReviewOpened])

  const current = accepted?.version || null
  const sheet = viewing?.version || current
  const manifest = latestManifest || viewing?.manifest || accepted?.manifest
  const entry = sheetEntry(manifest, sheet?.id)
  const unseen = useMemo(() => attemptsSince(sheet, log), [sheet, log])
  const latestBySlug = useMemo(() => latestAttemptBySlug(sheet, log), [sheet, log])

  const count = list => (sheet?.[list] || []).reduce((n, g) => n + g.items.length, 0)
  const activeTab = tab || 'roadmap'
  const groups = activeTab === 'roadmap' ? [] : sheet?.[activeTab] || []

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
      <div className="w-full pb-16 pt-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Prep sheet
              {viewing && !viewing.loading && (entry?.archived ? ' · archived' : ' · not your current sheet')}
            </p>
            <h1 className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[22px] font-bold tracking-tight text-slate-900">
              <span className="truncate">{sheet ? sheetName(sheet, manifest) : 'Prep sheet'}</span>
              {sheet && <CoachInfo key={sheet.id} headline={sheet.headline} summary={sheet.summary} />}
            </h1>
            {sheet && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-slate-500">
                <span>
                  {sheet.createdAt && sheet.createdAt !== sheet.writtenAt
                    ? `By coach, ${shortDate(sheet.createdAt)} · updated ${shortDate(sheet.writtenAt)}`
                    : `By coach, ${shortDate(sheet.writtenAt)}`}
                </span>
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
          {current && <ReviewButton onClick={() => setReviewing({})} available={available} />}
        </div>

        {viewing && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-900 px-4 py-2.5 text-[13px] text-white">
            <span className="flex-1">
              {viewing.loading
                ? 'Opening sheet…'
                : entry?.archived
                  ? 'The coach archived this sheet. Your current sheet is unchanged.'
                  : "You're looking at another sheet. Your current sheet is unchanged."}
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

        {!viewing && entry?.archived && (
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 ring-1 ring-amber-200">
            The coach has archived this sheet. Pick another under <strong>All sheets</strong>, or review the sheet it recommends when one appears.
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
          <EmptyState onReview={() => setReviewing({})} unavailable={unavailable} available={available} checking={checking} />
        )}

        {sheet && (
          <>
            <div className="mt-5 flex items-end gap-6 border-b border-slate-200">
              {['roadmap', 'revision', 'new'].map(key => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`-mb-px flex items-center gap-2 border-0 border-b-2 bg-transparent px-0.5 pb-2.5 text-sm font-semibold transition ${
                    activeTab === key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {key === 'roadmap' ? 'Roadmap' : LIST_LABEL[key]}
                  <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${
                    activeTab === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {key === 'roadmap' ? count('revision') + count('new') : count(key)}
                  </span>
                </button>
              ))}
              {activeTab === 'roadmap' && (
                <span className="mb-2.5 ml-auto hidden text-xs text-slate-400 md:block">
                  Every problem in the order to work through them. Click one to open it.
                </span>
              )}
            </div>

            {activeTab === 'roadmap' && (
              <section className="mt-4 rounded-[10px] border border-slate-200 bg-white px-4 py-4">
                <Roadmap sheet={sheet} attempts={latestBySlug} selected={open?.slug} onOpen={setOpen} />
              </section>
            )}

            {activeTab !== 'roadmap' && groups.length === 0 && (
              <p className="mt-8 text-center text-sm text-slate-400">
                Nothing in {LIST_LABEL[activeTab]} on this sheet.
              </p>
            )}

            {activeTab !== 'roadmap' && groups.map(group => {
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
                    setNotice({ tone: 'ok', text: `“${sheetName(record.version, record.manifest)}” is now your current sheet.` })
          }}
        />
      )}
    </div>
  )
}
