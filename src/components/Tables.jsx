import { useMemo } from 'react'
import { describe, fmtCell } from '../lib/data'

const ROW_LIMIT = 2000

export function DataTable({ table }) {
  const rows = Math.min(table.n, ROW_LIMIT)
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="rownum">#</th>
            {table.names.map((n) => (
              <th key={n}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td className="rownum">{i}</td>
              {table.names.map((n) => (
                <td key={n}>{fmtCell(table.cols[n], i)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.n > ROW_LIMIT && (
        <p className="muted pad">
          Showing the first {ROW_LIMIT.toLocaleString()} of {table.n.toLocaleString()} rows.
        </p>
      )}
    </div>
  )
}

const HEADERS = [
  ['column', 'Column'],
  ['type', 'Type'],
  ['count', 'Count'],
  ['missing', 'Missing'],
  ['mean', 'Mean'],
  ['std', 'Std'],
  ['min', 'Min'],
  ['q25', '25%'],
  ['q50', '50%'],
  ['q75', '75%'],
  ['max', 'Max'],
  ['unique', 'Unique'],
]

export function StatsTable({ table }) {
  const rows = useMemo(() => describe(table), [table])
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {HEADERS.map(([, h]) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.column}>
              {HEADERS.map(([k]) => (
                <td key={k} className={k === 'column' ? 'strong' : ''}>
                  {r[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
