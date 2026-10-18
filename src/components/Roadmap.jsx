import { useEffect, useMemo, useRef, useState } from 'react'
import { problemForest, packForest } from '../utils/worklist'

const CARD_W = 176
const CARD_H = 64
const COL_GAP = 16
const ROW_GAP = 28
const BAND_GAP = 36

const DIFF_DOT = { Easy: 'bg-[#00b8a3]', Medium: 'bg-[#ffb800]', Hard: 'bg-[#ff375f]' }
const RESULT_DOT = { green: 'bg-[#00b8a3]', yellow: 'bg-[#ffb800]', red: 'bg-[#ff375f]' }

function useWidth(ref) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/**
 * Every problem on the sheet as a tree, top to bottom: a problem hangs under
 * the one it comes after. Independent branches sit side by side and wrap to
 * the width of the page. Clicking a card opens the problem.
 */
export default function Roadmap({ sheet, attempts, selected, onOpen }) {
  const box = useRef(null)
  const width = useWidth(box) || 900
  const [hover, setHover] = useState(null)

  const forest = useMemo(() => problemForest(sheet), [sheet])
  const maxCols = Math.max(1, Math.floor((width + COL_GAP) / (CARD_W + COL_GAP)))

  const { cards, height, pos } = useMemo(() => {
    const bands = packForest(forest.trees, maxCols)
    const pos = new Map()
    const cards = []
    let top = 0
    for (const band of bands) {
      const bandPx = band.width * (CARD_W + COL_GAP) - COL_GAP
      const left = Math.max(0, (width - bandPx) / 2)
      for (const tree of band.trees) {
        for (const n of tree.nodes) {
          const x = left + (tree.offset + n.col) * (CARD_W + COL_GAP)
          const y = top + n.depth * (CARD_H + ROW_GAP)
          pos.set(n.slug, { x, y })
          cards.push({ ...n, x, y })
        }
      }
      top += band.height * (CARD_H + ROW_GAP) - ROW_GAP + BAND_GAP
    }
    return { cards, pos, height: Math.max(0, top - BAND_GAP) }
  }, [forest, maxCols, width])

  const focus = hover || selected
  const linked = new Set(focus ? [focus, ...forest.edges.filter(e => e.from === focus || e.to === focus).flatMap(e => [e.from, e.to])] : [])
  const hasNew = cards.some(c => c.list === 'new')

  return (
    <div>
      <div ref={box} className="relative w-full" style={{ height }}>
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width="100%" height={height} aria-hidden="true">
          {forest.edges.map(e => {
            const a = pos.get(e.from)
            const b = pos.get(e.to)
            if (!a || !b) return null
            const lit = focus && (focus === e.from || focus === e.to)
            // Extra prerequisites cross the tree, so they appear only for the
            // problem you are looking at; the tree lines are always drawn.
            if (!e.primary && !lit) return null
            const x1 = a.x + CARD_W / 2
            const y1 = a.y + CARD_H
            const x2 = b.x + CARD_W / 2
            const y2 = b.y
            const d = y2 > y1
              ? `M ${x1} ${y1} C ${x1} ${y1 + ROW_GAP * 0.6}, ${x2} ${y2 - ROW_GAP * 0.6}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1} ${y1 + 40}, ${x2} ${y2 - 40}, ${x2} ${y2}`
            return (
              <path
                key={`${e.from}->${e.to}`}
                d={d}
                fill="none"
                stroke={lit ? '#475569' : '#cbd5e1'}
                strokeWidth={lit ? 2 : 1.5}
                strokeDasharray={e.primary ? undefined : '4 4'}
              />
            )
          })}
        </svg>

        {cards.map(c => {
          const attempt = attempts.get(c.slug)
          const isSel = selected === c.slug
          const dim = focus && !linked.has(c.slug)
          const tone = isSel
            ? 'border-[#ffa116] bg-[#fff7ea]'
            : c.list === 'new'
              ? 'border-violet-200 bg-violet-50/60 hover:border-violet-400'
              : 'border-slate-200 bg-white hover:border-slate-400'
          return (
            <button
              key={c.slug}
              onClick={() => onOpen(c)}
              onMouseEnter={() => setHover(c.slug)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(c.slug)}
              onBlur={() => setHover(null)}
              title={c.reason}
              style={{ left: c.x, top: c.y, width: CARD_W, height: CARD_H }}
              className={`absolute flex flex-col justify-between rounded-lg border px-3 py-2 text-left shadow-sm transition ${tone} ${dim ? 'opacity-40' : ''}`}
            >
              <span className="flex items-start gap-1.5">
                <span className="line-clamp-2 min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-slate-900">
                  {c.number ? `${c.number}. ` : ''}{c.title}
                </span>
                {attempt && (
                  <span className={`mt-1 size-2 shrink-0 rounded-full ${RESULT_DOT[attempt.result] || 'bg-slate-400'}`} title={`Recorded ${attempt.result}`} />
                )}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
                <span className={`size-1.5 shrink-0 rounded-full ${DIFF_DOT[c.difficulty] || 'bg-slate-300'}`} />
                <span className="truncate">{c.pattern}</span>
                {c.flag === 'repair' && (
                  <span className="ml-auto shrink-0 rounded bg-[#ffe8ed] px-1 text-[10px] font-semibold text-[#e0244b]">Repair</span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-slate-300 bg-white" />Revision</span>
        {hasNew && <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-violet-300 bg-violet-50" />New</span>}
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#00b8a3]" />recorded since the coach looked</span>
        <span className="inline-flex items-center gap-1.5"><svg width="18" height="6" aria-hidden="true"><path d="M0 3h18" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" /></svg>also needs (shown on hover)</span>
        <span className="text-slate-400">Start at the top of any branch.</span>
      </div>
    </div>
  )
}
