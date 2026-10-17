import { useMemo } from 'react'
import { roadmapLayers } from '../utils/worklist'

const W = 900
const NODE_W = 164
const NODE_H = 48
const GAP = 34
const PAD = 8

const STATUS = {
  done: { fill: '#e7f8f4', stroke: '#00b8a3', text: '#065f46', label: 'Done' },
  active: { fill: '#fff1db', stroke: '#ffa116', text: '#9a3412', label: 'Working on' },
  next: { fill: '#ffffff', stroke: '#334155', text: '#0f172a', label: 'Up next' },
  later: { fill: '#f8fafc', stroke: '#cbd5e1', text: '#94a3b8', label: 'Later' },
}
const PLAIN = { fill: '#ffffff', stroke: '#cbd5e1', text: '#334155' }

/** Up to two lines of about 20 characters, so names fit their box. */
function wrap(text, max = 20) {
  const words = text.split(' ')
  const lines = ['']
  for (const w of words) {
    const cur = lines[lines.length - 1]
    if (!cur) lines[lines.length - 1] = w
    else if ((cur + ' ' + w).length <= max) lines[lines.length - 1] = `${cur} ${w}`
    else lines.push(w)
  }
  if (lines.length > 2) return [lines[0], `${lines.slice(1).join(' ').slice(0, max - 1)}…`]
  return lines
}

/**
 * The coach's pattern roadmap: which pattern builds on which, and where each
 * stands. Clicking a pattern filters the lists below to it.
 */
export default function Roadmap({ roadmap, counts, selected, onSelect }) {
  const { nodes, edges, height, width } = useMemo(() => {
    const rows = roadmapLayers(roadmap)
    const widest = Math.max(1, ...rows.map(r => r.length))
    const width = Math.max(W, widest * (NODE_W + 28) + 24)
    const at = new Map()
    const nodes = []
    rows.forEach((row, r) => {
      row.forEach((n, i) => {
        const node = { ...n, cx: ((i + 0.5) / row.length) * width, y: PAD + 6 + r * (NODE_H + GAP) }
        at.set(n.pattern, node)
        nodes.push(node)
      })
    })
    const edges = nodes.flatMap(n => n.after.map(p => ({ from: at.get(p), to: n })))
    return { nodes, edges, width, height: PAD * 2 + 6 + rows.length * (NODE_H + GAP) - GAP }
  }, [roadmap])

  const used = new Set(nodes.map(n => n.status).filter(Boolean))

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="group" aria-label="Pattern roadmap">
        {edges.map(({ from, to }) => {
          const y1 = from.y + NODE_H
          const y2 = to.y
          const mid = (y1 + y2) / 2
          const lit = selected && (selected === from.pattern || selected === to.pattern)
          return (
            <path
              key={`${from.pattern}->${to.pattern}`}
              d={`M ${from.cx} ${y1} C ${from.cx} ${mid}, ${to.cx} ${mid}, ${to.cx} ${y2}`}
              fill="none"
              stroke={lit ? '#64748b' : '#d4d9e1'}
              strokeWidth={lit ? 2 : 1.5}
            />
          )
        })}

        {nodes.map(n => {
          const s = STATUS[n.status] || PLAIN
          const c = counts.get(n.pattern)
          const total = c ? c.new + c.revision : 0
          const isSel = selected === n.pattern
          const lines = wrap(n.pattern)
          const x = n.cx - NODE_W / 2
          return (
            <g
              key={n.pattern}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={`${n.pattern}${n.status ? `, ${STATUS[n.status].label}` : ''}${total ? `, ${total} problems` : ''}`}
              onClick={() => onSelect(isSel ? null : n.pattern)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(isSel ? null : n.pattern) } }}
              className="cursor-pointer outline-none"
            >
              <title>{[n.pattern, n.note].filter(Boolean).join(' — ')}</title>
              <rect
                x={x}
                y={n.y}
                width={NODE_W}
                height={NODE_H}
                rx={9}
                fill={s.fill}
                stroke={isSel ? '#0f172a' : s.stroke}
                strokeWidth={isSel ? 2.5 : 1.5}
              />
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={n.cx}
                  y={n.y + NODE_H / 2 + (i - (lines.length - 1) / 2) * 15 + 4.5}
                  textAnchor="middle"
                  fontSize="13.5"
                  fontWeight="600"
                  fill={s.text}
                >
                  {line}
                </text>
              ))}
              {total > 0 && (
                <g>
                  <circle cx={x + NODE_W - 4} cy={n.y + 4} r={10} fill="#0f172a" />
                  <text x={x + NODE_W - 4} y={n.y + 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{total}</text>
                </g>
              )}
            </g>
          )
        })}
      </svg>

      {used.size > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          {Object.entries(STATUS).filter(([k]) => used.has(k)).map(([k, s]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.fill, boxShadow: `inset 0 0 0 1.5px ${s.stroke}` }} />
              {s.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="flex size-3.5 items-center justify-center rounded-full bg-slate-900 text-[8px] font-bold text-white">n</span>
            problems on this sheet
          </span>
        </div>
      )}
    </div>
  )
}
