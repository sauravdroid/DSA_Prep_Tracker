import { useMemo, useState } from 'react'
import { problemRoadmap } from '../utils/worklist'

const NODE_W = 168
const NODE_H = 60
const COL_GAP = 14
const ROW_GAP = 30
const PAD = 8

const DIFF = { Easy: '#00b8a3', Medium: '#ffb800', Hard: '#ff375f' }
const RESULT = { green: '#00b8a3', yellow: '#ffb800', red: '#ff375f' }
const LIST_STYLE = {
  revision: { fill: '#ffffff', stroke: '#cbd5e1' },
  new: { fill: '#f5f3ff', stroke: '#c4b5fd' },
}

/** Up to two lines of about `max` characters. */
function wrap(text, max) {
  const lines = ['']
  for (const w of text.split(' ')) {
    const cur = lines[lines.length - 1]
    if (!cur) lines[lines.length - 1] = w
    else if ((cur + ' ' + w).length <= max) lines[lines.length - 1] = `${cur} ${w}`
    else lines.push(w)
  }
  if (lines.length > 2) return [lines[0], `${lines.slice(1).join(' ').slice(0, max - 1)}…`]
  return lines
}

/**
 * Every problem on the sheet as a roadmap, top to bottom: a problem sits below
 * the problems it comes after. Clicking one opens it.
 */
export default function Roadmap({ sheet, attempts, selected, onOpen }) {
  const [hover, setHover] = useState(null)

  const { nodes, edges, width, height } = useMemo(() => {
    const rows = problemRoadmap(sheet)
    const widest = Math.max(1, ...rows.map(r => r.length))
    const width = widest * (NODE_W + COL_GAP) - COL_GAP + PAD * 2
    const at = new Map()
    const nodes = []
    rows.forEach((row, r) => {
      const rowWidth = row.length * (NODE_W + COL_GAP) - COL_GAP
      const left = (width - rowWidth) / 2
      row.forEach((n, i) => {
        const node = { ...n, x: left + i * (NODE_W + COL_GAP), y: PAD + r * (NODE_H + ROW_GAP) }
        at.set(n.key, node)
        nodes.push(node)
      })
    })
    const edges = nodes.flatMap(n => n.after.map(p => ({ from: at.get(p), to: n })))
    return { nodes, edges, width, height: PAD * 2 + rows.length * (NODE_H + ROW_GAP) - ROW_GAP }
  }, [sheet])

  const focus = hover || selected
  const near = new Set(focus ? [focus, ...edges.filter(e => e.from.key === focus || e.to.key === focus).flatMap(e => [e.from.key, e.to.key])] : [])
  const hasNew = nodes.some(n => n.list === 'new')

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="mx-auto block"
          role="group"
          aria-label="Problem roadmap"
        >
          {edges.map(({ from, to }) => {
            const x1 = from.x + NODE_W / 2
            const y1 = from.y + NODE_H
            const x2 = to.x + NODE_W / 2
            const y2 = to.y
            const mid = (y1 + y2) / 2
            const lit = focus && (focus === from.key || focus === to.key)
            return (
              <path
                key={`${from.key}->${to.key}`}
                d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                fill="none"
                stroke={lit ? '#475569' : '#d4d9e1'}
                strokeWidth={lit ? 2 : 1.5}
              />
            )
          })}

          {nodes.map(n => {
            const s = LIST_STYLE[n.list]
            const attempt = attempts.get(n.slug)
            const isSel = selected === n.slug
            const dim = focus && !near.has(n.slug)
            const title = `${n.number ? `${n.number}. ` : ''}${n.title}`
            const lines = wrap(title, 21)
            return (
              <g
                key={n.key}
                role="button"
                tabIndex={0}
                aria-label={`${title}, ${n.pattern}${n.flag === 'repair' ? ', repair' : ''}${attempt ? `, recorded ${attempt.result}` : ''}`}
                onClick={() => onOpen(n)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(n) } }}
                onMouseEnter={() => setHover(n.slug)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer outline-none"
                opacity={dim ? 0.45 : 1}
              >
                <title>{[title, n.reason].filter(Boolean).join(' — ')}</title>
                <rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={9}
                  fill={isSel ? '#fff7ea' : s.fill}
                  stroke={isSel ? '#ffa116' : n.flag === 'repair' ? '#ff375f' : s.stroke}
                  strokeWidth={isSel || n.flag === 'repair' ? 2 : 1.5}
                />
                <rect x={n.x + 1} y={n.y + 10} width={3.5} height={NODE_H - 20} rx={1.75} fill={DIFF[n.difficulty] || '#cbd5e1'} />
                {lines.map((line, i) => (
                  <text
                    key={i}
                    x={n.x + 14}
                    y={n.y + (lines.length === 1 ? 26 : 20) + i * 15}
                    fontSize="12"
                    fontWeight="600"
                    fill="#0f172a"
                  >
                    {line}
                  </text>
                ))}
                <text x={n.x + 14} y={n.y + NODE_H - 9} fontSize="10.5" fill="#94a3b8">
                  {n.pattern}{n.flag === 'repair' ? ' · repair' : ''}
                </text>
                {attempt && (
                  <circle cx={n.x + NODE_W - 12} cy={n.y + 12} r={5.5} fill={RESULT[attempt.result] || '#94a3b8'} />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ boxShadow: 'inset 0 0 0 1.5px #cbd5e1' }} />Revision
        </span>
        {hasNew && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: '#f5f3ff', boxShadow: 'inset 0 0 0 1.5px #c4b5fd' }} />New
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ boxShadow: 'inset 0 0 0 2px #ff375f' }} />Repair
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#00b8a3]" />recorded since the coach looked
        </span>
        <span className="text-slate-400">Top to bottom: do a problem after the ones above it that lead to it.</span>
      </div>
    </div>
  )
}
