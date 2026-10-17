import { useEffect, useMemo, useState, useCallback } from 'react'
import { LISTS, LIST_LABEL, versionNumber, attemptsSince, latestAttemptBySlug, itemMode } from '../utils/worklist'
import { loadAccepted } from '../utils/worklistStore'
import { subscribeSync } from '../utils/autoSync'
import { backupIfConnected } from '../utils/github'
import WorklistDrawer from './WorklistDrawer'
import WorklistReview from './WorklistReview'
import ColdTestModal from './ColdTestModal'
import * as store from '../store'

export const DIFF_TONE = { Easy: 'text-[#00b8a3]', Medium: 'text-[#ffb800]', Hard: 'text-[#ff375f]' }

function shortDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Filled when you have recorded an attempt the coach has not seen yet. */
export function StatusIcon({ attempt }) {
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

function Row({ item, attempt, selected, onOpen }) {
  return (
    <button
      onClick={() => onOpen(item)}
      className={`grid h-12 w-full grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_3.5rem] items-center gap-3.5 border-0 border-t border-slate-100 px-4 text-left transition first:border-t-0 even:bg-[#f7f8fa] hover:bg-slate-100 ${
        selected ? '!bg-[#fff7ea] shadow-[inset_3px_0_0_#ffa116]' : ''
      }`}
    >
      <StatusIcon attempt={attempt} />
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className="shrink-0 font-medium text-slate-900">
          {item.number ? `${item.number}. ` : ''}{item.title}
        </span>
        {item.flag === 'repair' && (
          <span className="shrink-0 rounded px-1.5 py-px text-[11px] font-semibold text-[#ff375f] ring-1 ring-[#ff375f]/20 bg-[#ffe8ed]">
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

function EmptyState({ onSync, unavailable, available }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-semibold text-slate-900">No worklist yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        {unavailable
          ? 'The local data server is not reachable, so the accepted worklist cannot be read.'
          : 'The coach publishes worklists to your data repository. Sync to review the latest one and accept it.'}
      </p>
      <div className="mt-5"><SyncButton onClick={onSync} available={available} /></div>
    </div>
  )
}

export default function WorklistPage({ problems, practiceLog: log = [], onChanged }) {
  const [accepted, setAccepted] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [tab, setTab] = useState(null)
  const [open, setOpen] = useState(null)
  const [recording, setRecording] = useState(null)
  const [reviewing, setReviewing] = useState(false)
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

  const version = accepted?.version || null
  const number = versionNumber(accepted?.manifest, version?.id)
  const unseen = useMemo(() => attemptsSince(version, log), [version, log])
  const latestBySlug = useMemo(() => latestAttemptBySlug(version, log), [version, log])

  const activeTab = tab || (version?.revision?.length || !version?.new?.length ? 'revision' : 'new')
  const groups = version?.[activeTab] || []
  const count = list => (version?.[list] || []).reduce((n, g) => n + g.items.length, 0)

  const openItem = useCallback(item => setOpen({ ...item, list: item.list || activeTab }), [activeTab])

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
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Worklist</h1>
            {version && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-slate-500">
                <span>
                  <strong className="font-semibold text-slate-900">{number ? `v${number}` : 'Accepted'}</strong>
                  {' '}by coach, {shortDate(version.writtenAt)}
                </span>
                <span className="size-[3px] rounded-full bg-slate-300" aria-hidden="true" />
                <span>based on {version.basedOn?.attempts ?? '?'} attempts</span>
                {unseen.length > 0 && (
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
          {version && <SyncButton onClick={() => setReviewing(true)} available={available} />}
        </div>

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

        {loaded && !version && <EmptyState onSync={() => setReviewing(true)} unavailable={unavailable} available={available} />}

        {version && (
          <>
            <div className="mt-4 flex items-center gap-2.5 rounded-[10px] border border-[#ffe2b3] bg-[#fff7ea] px-4 py-2.5 text-[13px] text-zinc-700">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#c2410c]">Coach</span>
              <span>{version.headline}</span>
            </div>

            <div className="mt-5 flex gap-6 border-b border-slate-200">
              {LISTS.slice().reverse().map(list => (
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
                Nothing in {LIST_LABEL[activeTab]} right now.
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
                    {group.items.map(item => (
                      <Row
                        key={item.slug}
                        item={{ ...item, list: activeTab, pattern: group.pattern }}
                        attempt={latestBySlug.get(item.slug)}
                        selected={open?.slug === item.slug}
                        onOpen={openItem}
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
          practiceLog={log}
          onClose={() => setReviewing(false)}
          onAccepted={record => {
            setAccepted(record)
            setReviewing(false)
            setTab(null)
            setNotice({ tone: 'ok', text: `Now following ${record.source?.number ? `v${record.source.number}` : 'the new worklist'}.` })
          }}
        />
      )}
    </div>
  )
}
