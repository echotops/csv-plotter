export function normalize(y, mode) {
  const n = y.length
  if (!n || mode === 'None') return y
  if (mode === 'Min-max (0-1)') {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < n; i++) {
      if (y[i] < lo) lo = y[i]
      if (y[i] > hi) hi = y[i]
    }
    return hi > lo ? y.map((v) => (v - lo) / (hi - lo)) : new Float64Array(n)
  }
  if (mode === 'Z-score') {
    const m = mean(y)
    const s = Math.sqrt(y.reduce((a, v) => a + (v - m) ** 2, 0) / n)
    return s > 0 ? y.map((v) => (v - m) / s) : new Float64Array(n)
  }
  if (mode === 'Subtract first value') return y.map((v) => v - y[0])
  return y[0] !== 0 ? y.map((v) => v / y[0]) : y
}

export const mean = (y) => {
  let s = 0
  for (let i = 0; i < y.length; i++) s += y[i]
  return s / y.length
}

/** Indices to draw. With y given, keeps each bucket's min and max so spikes survive. */
export function decimateIdx(n, maxPts, y) {
  if (n <= maxPts) return null // null = keep everything
  if (!y) {
    const idx = new Int32Array(maxPts)
    for (let i = 0; i < maxPts; i++) idx[i] = Math.round((i * (n - 1)) / (maxPts - 1))
    return idx
  }
  const buckets = Math.max(Math.floor(maxPts / 2), 1)
  const out = []
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor((b * n) / buckets)
    const hi = Math.floor(((b + 1) * n) / buckets)
    if (hi <= lo) continue
    let imin = lo
    let imax = lo
    for (let i = lo + 1; i < hi; i++) {
      if (y[i] < y[imin]) imin = i
      if (y[i] > y[imax]) imax = i
    }
    if (imin === imax) out.push(imin)
    else if (imin < imax) out.push(imin, imax)
    else out.push(imax, imin)
  }
  return Int32Array.from(out)
}

export function take(a, idx) {
  if (!idx) return a
  const out = new Float64Array(idx.length)
  for (let i = 0; i < idx.length; i++) out[i] = a[idx[i]]
  return out
}

export function takeStr(a, idx) {
  return idx ? Array.from(idx, (i) => a[i]) : a
}

export const finiteOnly = (a) => {
  let k = 0
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) k++
  if (k === a.length) return a
  const out = new Float64Array(k)
  k = 0
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) out[k++] = a[i]
  return out
}

export function percentile(sorted, q) {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export const fmtNum = (v) => (Number.isFinite(v) ? Number(v.toPrecision(6)).toString() : '')

export function fmtTime(ms) {
  return Number.isFinite(ms)
    ? new Date(ms)
        .toISOString()
        .replace('T', ' ')
        .replace(/\.000Z$/, '')
        .replace('Z', '')
    : ''
}

export function fmtCell(col, i) {
  if (col.kind === 'str') return col.values[i]
  return col.kind === 'time' ? fmtTime(col.values[i]) : fmtNum(col.values[i])
}

export function describe(table) {
  return table.names.map((name) => {
    const col = table.cols[name]
    const blank = { mean: '', std: '', min: '', q25: '', q50: '', q75: '', max: '', unique: '' }
    if (col.kind === 'str') {
      const blanks = col.values.filter((s) => s === '').length
      return {
        column: name,
        type: 'text',
        count: table.n - blanks,
        missing: blanks,
        ...blank,
        unique: String(new Set(col.values).size),
      }
    }
    const f = finiteOnly(col.values)
    const sorted = Float64Array.from(f).sort()
    const base = { column: name, count: f.length, missing: table.n - f.length }
    if (col.kind === 'time') {
      return {
        ...base,
        type: 'datetime',
        ...blank,
        min: f.length ? fmtTime(sorted[0]) : '',
        max: f.length ? fmtTime(sorted[sorted.length - 1]) : '',
      }
    }
    const m = f.length ? mean(f) : NaN
    const sd = f.length > 1 ? Math.sqrt(f.reduce((a, v) => a + (v - m) ** 2, 0) / (f.length - 1)) : NaN
    return {
      ...base,
      type: 'number',
      mean: fmtNum(m),
      std: fmtNum(sd),
      min: fmtNum(sorted[0]),
      q25: fmtNum(percentile(sorted, 0.25)),
      q50: fmtNum(percentile(sorted, 0.5)),
      q75: fmtNum(percentile(sorted, 0.75)),
      max: fmtNum(sorted[sorted.length - 1]),
      unique: '',
    }
  })
}
