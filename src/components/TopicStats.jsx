import { useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'

const DIFFICULTY_COLOR = { Easy: '#10b981', Medium: '#f59e0b', Hard: '#f43f5e' }
const STRUGGLE = [
  { key: 'clean', name: 'Clean', color: '#10b981' },
  { key: 'low', name: '1–2 fails', color: '#f59e0b' },
  { key: 'high', name: '3+ fails', color: '#f43f5e' },
]

export const EMPTY_FILTERS = { difficulty: [], struggle: [], revision: [] }

export function struggleBucket(failedCount) {
  const f = failedCount || 0
  if (f === 0) return 'clean'
  return f <= 2 ? 'low' : 'high'
}

export function filterCount(filters) {
  return filters.difficulty.length + filters.struggle.length + filters.revision.length
}

function Stat({ value, label, tone = 'text-slate-900', active, onClick }) {
  const interactive = !!onClick
  return (
    <button
      onClick={onClick}
      disabled={!interactive}
      className={`rounded-lg border-0 px-2 py-1 text-left transition ${
        interactive ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'
      } ${active ? 'bg-slate-900/5 ring-1 ring-slate-900/15' : 'bg-transparent'}`}
    >
      <div className={`text-xl font-bold leading-none ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] text-slate-400">{label}</div>
    </button>
  )
}

/**
 * High-level performance for one topic, doubling as the filter control for the
 * list below. Stats always describe the whole topic, never the filtered subset.
 */
export default function TopicStats({ topic, problems, revisionMap, filters, onToggle, onClear }) {
  const [open, setOpen] = useState(true)

  const s = useMemo(() => {
    const total = problems.length
    if (total === 0) return null

    const fails = problems.map(p => p.failedCount || 0)
    const clean = fails.filter(f => f === 0).length
    const avgFails = fails.reduce((a, b) => a + b, 0) / total

    const revisionCounts = problems.map(p => (revisionMap[p.slug] || []).length)
    const totalRevisions = revisionCounts.reduce((a, b) => a + b, 0)
    const neverRevised = revisionCounts.filter(c => c === 0).length

    const acRates = problems.map(p => p.acRate).filter(v => v != null)
    const avgAcRate = acRates.length ? acRates.reduce((a, b) => a + b, 0) / acRates.length : null

    const byDifficulty = { Easy: 0, Medium: 0, Hard: 0 }
    for (const p of problems) {
      if (byDifficulty[p.difficulty] !== undefined) byDifficulty[p.difficulty]++
    }

    const struggle = STRUGGLE.map(b => ({
      ...b,
      value: problems.filter(p => struggleBucket(p.failedCount) === b.key).length,
    }))

    const hardest = [...problems].filter(p => p.acRate != null).sort((a, b) => a.acRate - b.acRate)[0]
    const costliest = [...problems].sort((a, b) => (b.failedCount || 0) - (a.failedCount || 0))[0]

    return {
      total, clean, avgFails, totalRevisions, neverRevised, avgAcRate,
      byDifficulty, struggle, hardest, costliest,
      cleanPct: Math.round((clean / total) * 100),
      revised: total - neverRevised,
    }
  }, [problems, revisionMap])

  if (!s) return null

  const difficultyData = Object.entries(s.byDifficulty)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))

  const diffActive = filters.difficulty.length > 0
  const strugActive = filters.struggle.length > 0
  const active = filterCount(filters)

  const dim = (on) => (on ? 1 : 0.25)

  return (
    <div className="tw @container rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 border-0 bg-transparent p-0 text-left"
        >
          <span className="text-[10px] text-slate-400">{open ? '▼' : '▶'}</span>
          <h3 className="text-sm font-semibold text-slate-900">{topic} overview</h3>
        </button>
        <span className="ml-auto text-xs text-slate-400">{s.cleanPct}% solved clean</span>
      </div>

      {open && (
        <>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
            <Stat value={s.total} label="problems" />
            <Stat
              value={`${s.cleanPct}%`}
              label="solved clean"
              tone={s.cleanPct >= 70 ? 'text-emerald-600' : s.cleanPct >= 40 ? 'text-amber-600' : 'text-rose-600'}
              active={filters.struggle.includes('clean')}
              onClick={() => onToggle('struggle', 'clean')}
            />
            <Stat value={s.avgFails.toFixed(1)} label="avg failed subs" />
            <Stat
              value={s.revised}
              label="revised"
              active={filters.revision.includes('some')}
              onClick={() => onToggle('revision', 'some')}
            />
            <Stat
              value={s.neverRevised}
              label="never revised"
              active={filters.revision.includes('never')}
              onClick={() => onToggle('revision', 'never')}
            />
            {s.avgAcRate != null && (
              <Stat value={`${Math.round(s.avgAcRate)}%`} label="avg LC accept" />
            )}
          </div>

          <div className="mt-4 grid gap-4 @xl:grid-cols-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Difficulty
              </span>
              <div className="mt-1 flex items-center gap-3">
                <div className="size-24 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={difficultyData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="58%"
                        outerRadius="100%"
                        paddingAngle={2}
                        stroke="none"
                        isAnimationActive={false}
                        onClick={d => onToggle('difficulty', d.name)}
                        className="cursor-pointer"
                      >
                        {difficultyData.map(d => (
                          <Cell
                            key={d.name}
                            fill={DIFFICULTY_COLOR[d.name]}
                            fillOpacity={diffActive ? dim(filters.difficulty.includes(d.name)) : 1}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 max-w-64 flex-1 space-y-1">
                  {difficultyData.map(d => (
                    <button
                      key={d.name}
                      onClick={() => onToggle('difficulty', d.name)}
                      className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-xs transition hover:bg-slate-100"
                    >
                      <span className="size-2.5 rounded-sm" style={{ background: DIFFICULTY_COLOR[d.name] }} />
                      <span className="flex-1 text-left text-slate-600">{d.name}</span>
                      <span className="font-semibold text-slate-900">{d.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Failed submissions
              </span>
              <div className="mt-1 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={s.struggle} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={32} />
                    <Tooltip
                      cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Bar
                      dataKey="value"
                      name="Problems"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                      onClick={d => onToggle('struggle', d.key)}
                      className="cursor-pointer"
                    >
                      {s.struggle.map(b => (
                        <Cell
                          key={b.key}
                          fill={b.color}
                          fillOpacity={strugActive ? dim(filters.struggle.includes(b.key)) : 1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">            {s.hardest && (
              <span>
                Hardest attempted:{' '}
                <strong className="font-medium text-slate-700">{s.hardest.title}</strong>
                {' '}({Math.round(s.hardest.acRate)}% accept)
              </span>
            )}
            {s.costliest && (s.costliest.failedCount || 0) > 0 && (
              <span>
                Most failed submissions:{' '}
                <strong className="font-medium text-slate-700">{s.costliest.title}</strong>
                {' '}(✗{s.costliest.failedCount})
              </span>
            )}
          </div>
        </>
      )}

      {/* Sits last so it reads as a caption for the list below; stays visible when collapsed. */}
      {active > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Filters
          </span>
          {filters.difficulty.map(d => (
            <button key={d} onClick={() => onToggle('difficulty', d)}
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white"
              style={{ background: DIFFICULTY_COLOR[d] }}>
              {d} ✕
            </button>
          ))}
          {filters.struggle.map(k => {
            const b = STRUGGLE.find(x => x.key === k)
            return (
              <button key={k} onClick={() => onToggle('struggle', k)}
                className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white"
                style={{ background: b.color }}>
                {b.name} ✕
              </button>
            )
          })}
          {filters.revision.map(k => (
            <button key={k} onClick={() => onToggle('revision', k)}
              className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              {k === 'never' ? 'never revised' : 'revised'} ✕
            </button>
          ))}
          <button onClick={onClear}
            className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-50">
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
