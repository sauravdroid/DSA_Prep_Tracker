import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ComposedChart, Line,
} from 'recharts'
import { computeStats, getDataDateRange } from '../utils/stats'
import { toLocalDateStr, todayStr } from '../utils/dateUtils'
import { getStartDate, getFailures } from '../store'

const COLORS = {
  new: '#22c55e',
  rev: '#8b5cf6',
  fail: '#ff375f',
  acRate: '#0077b6',
  hard: '#ff375f',
  Easy: '#00b8a3',
  Medium: '#ffc01e',
  Hard: '#ff375f',
  Unknown: '#9ca3af',
}

const PRESETS = [
  { label: 'All time', days: null },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6m', days: 182 },
  { label: '1y', days: 365 },
]

function shiftDays(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return toLocalDateStr(d)
}

function fmt(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

function StatCard({ label, value, sub, tone }) {
  return (
    <div className={`stat-card ${tone || ''}`}>
      <span className="stat-card-value">{value}</span>
      <span className="stat-card-label">{label}</span>
      {sub && <span className="stat-card-sub">{sub}</span>}
    </div>
  )
}

export default function StatsPage({ problems, revisions }) {
  const failures = useMemo(() => getFailures(), [])

  const dataRange = useMemo(() => getDataDateRange(problems, revisions), [problems, revisions])
  const defaultFrom = dataRange?.from || getStartDate()
  const defaultTo = todayStr()

  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [activePreset, setActivePreset] = useState('All time')

  const applyPreset = preset => {
    setActivePreset(preset.label)
    setTo(defaultTo)
    setFrom(preset.days == null ? defaultFrom : shiftDays(defaultTo, -(preset.days - 1)))
  }

  const stats = useMemo(
    () => computeStats(problems, revisions, failures, from, to),
    [problems, revisions, failures, from, to]
  )

  const failureLogIncomplete = !stats.failureLogStart || stats.failureLogStart > from

  const rangeBar = (
    <div className="stat-range-bar">
      <div className="stat-presets">
        {PRESETS.map(p => (
          <button
            key={p.label}
            className={`stat-preset ${activePreset === p.label ? 'active' : ''}`}
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="stat-range-inputs">
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setActivePreset('') }} />
        <span className="stat-range-sep">→</span>
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setActivePreset('') }} />
      </div>
      <span className="stat-range-days">{stats.totalDays} days</span>
    </div>
  )

  const patternChartData = useMemo(
    () => stats.patterns.slice(0, 14).map(p => ({
      pattern: p.pattern,
      new: p.new,
      revisions: p.revisions,
    })),
    [stats.patterns]
  )

  if (stats.totalCount === 0) {
    return (
      <div className="stats-page">
        {rangeBar}
        <p className="empty-message">No activity in this date range.</p>
      </div>
    )
  }

  return (
    <div className="stats-page">
      {rangeBar}

      <div className="stat-cards">
        <StatCard label="Total solved" value={stats.totalCount} sub={`${fmt(stats.perActiveDay, 1)} per active day`} />
        <StatCard label="New problems" value={stats.newCount} tone="new" />
        <StatCard label="Revisions" value={stats.revisionCount} sub={`${stats.uniqueRevised} unique`} tone="rev" />
        <StatCard
          label="Accept rate"
          value={stats.acceptRate == null ? '—' : `${fmt(stats.acceptRate)}%`}
          sub={`${stats.failCount} failed submissions`}
          tone="fail"
        />
        <StatCard
          label="Avg LeetCode AC rate"
          value={stats.avgAcRate == null ? '—' : `${fmt(stats.avgAcRate)}%`}
          sub="lower = harder problems"
        />
        <StatCard
          label="Active days"
          value={`${stats.activeDays}/${stats.totalDays}`}
          sub={`longest streak ${stats.longestStreak}d`}
        />
      </div>

      {failureLogIncomplete && (
        <p className="stat-note">
          Failure data is only recorded from {stats.failureLogStart || 'the next sync'} onward, so accept rate
          for earlier dates in this range is understated.
        </p>
      )}

      <div className="stat-grid">
        <section className="stat-panel stat-panel-wide">
          <h3 className="stat-panel-title">Activity by month</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e2" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="new" name="New" stackId="a" fill={COLORS.new} radius={[0, 0, 0, 0]} />
              <Bar dataKey="revisions" name="Revisions" stackId="a" fill={COLORS.rev} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="stat-panel">
          <h3 className="stat-panel-title">Difficulty mix</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={stats.difficultyMix}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                label={({ name, value }) => `${name} ${value}`}
                labelLine={false}
              >
                {stats.difficultyMix.map(d => (
                  <Cell key={d.name} fill={COLORS[d.name]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </section>

        <section className="stat-panel stat-panel-wide">
          <h3 className="stat-panel-title">
            Are the problems getting harder?
            <span className="stat-panel-hint">Falling AC rate and rising Hard % both mean harder</span>
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={stats.monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e2" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis yAxisId="left" unit="%" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip formatter={v => (typeof v === 'number' ? `${v.toFixed(1)}%` : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="hardPct" name="Hard %" fill={COLORS.hard} radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Line yAxisId="right" type="monotone" dataKey="avgAcRate" name="Avg LC AC rate" stroke={COLORS.acRate} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="acceptRate" name="My accept rate" stroke={COLORS.new} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        <section className="stat-panel stat-panel-full">
          <h3 className="stat-panel-title">
            Problems per pattern
            <span className="stat-panel-hint">multi-pattern problems count in each</span>
          </h3>
          <ResponsiveContainer width="100%" height={Math.max(240, patternChartData.length * 30)}>
            <BarChart data={patternChartData} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e2" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis type="category" dataKey="pattern" width={130} tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="new" name="New" stackId="a" fill={COLORS.new} />
              <Bar dataKey="revisions" name="Revisions" stackId="a" fill={COLORS.rev} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="stat-panel stat-panel-full">
          <h3 className="stat-panel-title">Pattern detail</h3>
          <div className="stat-table-wrap">
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th>Total</th>
                  <th>New</th>
                  <th>Rev</th>
                  <th>E / M / H</th>
                  <th>Fails</th>
                  <th>My accept</th>
                  <th>Avg LC AC</th>
                </tr>
              </thead>
              <tbody>
                {stats.patterns.map(p => (
                  <tr key={p.pattern}>
                    <td className="stat-table-name">{p.pattern}</td>
                    <td><strong>{p.total}</strong></td>
                    <td className="new-color">{p.new}</td>
                    <td className="rev-color">{p.revisions}</td>
                    <td className="stat-table-mix">
                      <span className="mix-e">{p.easy}</span>
                      <span className="mix-m">{p.medium}</span>
                      <span className="mix-h">{p.hard}</span>
                    </td>
                    <td>{p.fails || '—'}</td>
                    <td>{p.acceptRate == null ? '—' : `${fmt(p.acceptRate)}%`}</td>
                    <td>{p.avgAcRate == null ? '—' : `${fmt(p.avgAcRate)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="stat-panel">
          <h3 className="stat-panel-title">
            Hardest solved
            <span className="stat-panel-hint">by LeetCode acceptance rate</span>
          </h3>
          <div className="stat-list">
            {stats.hardest.length === 0 && <p className="empty-message">No acceptance rate data.</p>}
            {stats.hardest.map(p => (
              <a key={p.slug} href={p.url} target="_blank" rel="noopener noreferrer" className="stat-list-row">
                <span className="stat-list-title">{p.title}</span>
                <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
                <span className="stat-list-metric">{fmt(p.acRate, 1)}%</span>
              </a>
            ))}
          </div>
        </section>

        <section className="stat-panel">
          <h3 className="stat-panel-title">
            Most attempts
            <span className="stat-panel-hint">failed submissions in range</span>
          </h3>
          <div className="stat-list">
            {stats.mostAttempts.length === 0 && <p className="empty-message">No failed submissions recorded.</p>}
            {stats.mostAttempts.map(({ problem, fails }) => (
              <a key={problem.slug} href={problem.url} target="_blank" rel="noopener noreferrer" className="stat-list-row">
                <span className="stat-list-title">{problem.title}</span>
                <span className={`difficulty-badge ${problem.difficulty.toLowerCase()}`}>{problem.difficulty}</span>
                <span className="stat-list-metric fail">✗{fails}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
