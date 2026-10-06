// Finding the data under the cursor.

/** Index of the first element >= v in an ascending array. */
export function lowerBound(xs, v) {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (xs[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function isAscending(xs) {
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1]) return false
  return true
}

/** Index of the value in xs closest to v; xs may be unsorted (then it is a linear scan). */
export function nearestIndex(xs, v, sorted) {
  const n = xs.length
  if (!n) return -1
  if (sorted) {
    const i = lowerBound(xs, v)
    if (i === 0) return 0
    if (i === n) return n - 1
    return v - xs[i - 1] <= xs[i] - v ? i - 1 : i
  }
  let best = 0
  for (let i = 1; i < n; i++) if (Math.abs(xs[i] - v) < Math.abs(xs[best] - v)) best = i
  return best
}

/**
 * The unified hover readout for a cursor at pixel `px`: the point (over all visible series) closest in x,
 * and then every series' own nearest point to that x.
 *
 * @returns {{ x: number, rows: { series: object, i: number }[] } | null}
 */
export function findHover(series, xScale, px) {
  const shown = series.filter((s) => s.inLegend && s.x.length)
  if (!shown.length) return null
  const target = xScale.val(px)
  let best = null
  for (const s of shown) {
    const i = nearestIndex(s.x, target, s.sorted)
    const d = Math.abs(xScale.px(s.x[i]) - px)
    if (Number.isFinite(d) && (!best || d < best.d)) best = { d, x: s.x[i] }
  }
  if (!best) return null
  const rows = shown
    .map((s) => ({ series: s, i: nearestIndex(s.x, best.x, s.sorted) }))
    .filter((r) => r.i >= 0 && Number.isFinite(r.series.y[r.i]))
  return rows.length ? { x: best.x, rows } : null
}
