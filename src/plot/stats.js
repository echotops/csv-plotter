import { percentile } from '../lib/data'

/**
 * Box-plot numbers for a set of values: the quartiles, whiskers reaching the furthest values within 1.5 times
 * the inter-quartile range of the box, and the values beyond them as outliers (Tukey's rule, which Plotly used).
 *
 * @param {ArrayLike<number>} values finite numbers
 */
export function boxStats(values) {
  const sorted = Float64Array.from(values).sort()
  const n = sorted.length
  const q1 = percentile(sorted, 0.25)
  const median = percentile(sorted, 0.5)
  const q3 = percentile(sorted, 0.75)
  const fence = 1.5 * (q3 - q1)
  let lo = q1
  let hi = q3
  for (let i = 0; i < n; i++) {
    if (sorted[i] >= q1 - fence) {
      lo = sorted[i]
      break
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    if (sorted[i] <= q3 + fence) {
      hi = sorted[i]
      break
    }
  }
  const outliers = sorted.filter((v) => v < lo || v > hi)
  let sum = 0
  for (let i = 0; i < n; i++) sum += sorted[i]
  return { n, min: sorted[0], max: sorted[n - 1], q1, median, q3, lo, hi, outliers, mean: sum / n }
}

/**
 * A smooth density curve of the values (Gaussian kernel, Silverman's bandwidth), for violin plots.
 *
 * @returns {{ ys: Float64Array, dens: Float64Array, bw: number }} `dens` is scaled so its peak is 1
 */
export function density(values, points = 100) {
  const n = values.length
  const stats = boxStats(values)
  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += (values[i] - stats.mean) ** 2
  const sd = n > 1 ? Math.sqrt(sumSq / (n - 1)) : 0
  const iqr = stats.q3 - stats.q1
  let bw = 0.9 * Math.min(sd || Infinity, iqr / 1.34 || Infinity) * n ** -0.2
  if (!Number.isFinite(bw) || bw <= 0) bw = (stats.max - stats.min) / 10 || 1
  const lo = stats.min - 3 * bw
  const hi = stats.max + 3 * bw
  const ys = new Float64Array(points)
  const dens = new Float64Array(points)
  let peak = 0
  for (let k = 0; k < points; k++) {
    const y = lo + ((hi - lo) * k) / (points - 1)
    let d = 0
    for (let i = 0; i < n; i++) d += Math.exp(-0.5 * ((y - values[i]) / bw) ** 2)
    ys[k] = y
    dens[k] = d
    if (d > peak) peak = d
  }
  for (let k = 0; k < points; k++) dens[k] /= peak || 1
  return { ys, dens, bw }
}
