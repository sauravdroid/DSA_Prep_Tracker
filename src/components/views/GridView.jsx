import { useMemo } from 'react'

// Numeric tables read far better with a value ramp — the DP frontier becomes
// visible at a glance instead of having to read every cell.
function buildScale(rows) {
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    for (const cell of row) {
      const n = Number(cell)
      if (!Number.isFinite(n)) continue
      if (n < min) min = n
      if (n > max) max = n
    }
  }
  if (!Number.isFinite(min) || min === max) return null
  return { min, max }
}

function cellStyle(cell, scale) {
  if (!scale) return undefined
  const n = Number(cell)
  if (!Number.isFinite(n)) return undefined
  const t = (n - scale.min) / (scale.max - scale.min)
  return { background: `rgba(0, 119, 182, ${0.06 + t * 0.34})` }
}

export default function GridView({ name, value, previous, cursor }) {
  const scale = useMemo(() => buildScale(value.rows), [value.rows])
  const rowCursor = cursor.row?.value
  const colCursor = cursor.col?.value

  return (
    <div className="rec-grid">
      <div className="rec-array-head">
        <span className="rec-array-name">{name}</span>
        <span className="rec-array-len">{value.rowCount}×{value.colCount}</span>
        {cursor.row && <span className="rec-grid-cursor">{cursor.row.name}={rowCursor}</span>}
        {cursor.col && <span className="rec-grid-cursor">{cursor.col.name}={colCursor}</span>}
      </div>

      <div className="rec-grid-scroll">
        <table className="rec-grid-table">
          <thead>
            <tr>
              <th />
              {value.rows[0]?.map((_, j) => (
                <th key={j} className={j === colCursor ? 'axis' : ''}>{j}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.rows.map((row, i) => (
              <tr key={i}>
                <th className={i === rowCursor ? 'axis' : ''}>{i}</th>
                {row.map((cell, j) => {
                  const changed = previous?.rows?.[i]?.[j] !== cell
                  const isCursor = i === rowCursor && j === colCursor
                  const onAxis = i === rowCursor || j === colCursor
                  return (
                    <td
                      key={j}
                      className={`${changed ? 'changed' : ''} ${isCursor ? 'cursor' : onAxis ? 'axis' : ''}`}
                      style={changed || isCursor ? undefined : cellStyle(cell, scale)}
                    >
                      {cell}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(value.rowCount > value.rows.length || value.colCount > value.rows[0].length) && (
        <p className="rec-grid-trunc">
          showing {value.rows.length}×{value.rows[0].length} of {value.rowCount}×{value.colCount}
        </p>
      )}
    </div>
  )
}
