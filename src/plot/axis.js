// Axis math: mapping data values to pixels (linear or log) and the zoom / pan / box-zoom arithmetic on ranges.

const fwd = (type) => (type === 'log' ? Math.log10 : (v) => v)
const inv = (type) => (type === 'log' ? (v) => 10 ** v : (v) => v)

/** A scale from a data range [lo, hi] onto pixels p0 (at lo) to p1 (at hi). */
export function makeScale(type, lo, hi, p0, p1) {
  const f = fwd(type)
  const g = inv(type)
  const a = f(lo)
  const k = (p1 - p0) / (f(hi) - a)
  return { type, lo, hi, p0, p1, px: (v) => p0 + (f(v) - a) * k, val: (p) => g(a + (p - p0) / k) }
}

/** Zoom about the point `frac` (0 at lo, 1 at hi) of the range; factor < 1 zooms in. */
export function zoomRange(type, [lo, hi], factor, frac) {
  const f = fwd(type)
  const g = inv(type)
  const a = f(lo)
  const b = f(hi)
  const at = a + (b - a) * frac
  const na = at - (at - a) * factor
  const nb = at + (b - at) * factor
  // stop before the range collapses into floating-point noise
  if (!(nb - na > 1e-12 * Math.max(Math.abs(na), Math.abs(nb), 1e-300))) return [lo, hi]
  return [g(na), g(nb)]
}

/** Slide the range by `frac` of its width (positive moves towards larger values). */
export function panRange(type, [lo, hi], frac) {
  const f = fwd(type)
  const g = inv(type)
  const a = f(lo)
  const b = f(hi)
  const d = (b - a) * frac
  return [g(a + d), g(b + d)]
}

/** The part of the range between fractions f0 and f1 (0 at lo, 1 at hi). */
export function subRange(type, [lo, hi], f0, f1) {
  const f = fwd(type)
  const g = inv(type)
  const a = f(lo)
  const b = f(hi)
  const [u, v] = f0 <= f1 ? [f0, f1] : [f1, f0]
  return [g(a + (b - a) * u), g(a + (b - a) * v)]
}

/** A range covering [min, max] with a little breathing room; degenerate or missing extents get a default. */
export function autoRange(type, min, max, pad = 0) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return type === 'log' ? [1, 10] : [0, 1]
  const f = fwd(type)
  const g = inv(type)
  let a = f(min)
  let b = f(max)
  if (b <= a) {
    a -= type === 'log' ? 0.5 : 0.5 * (Math.abs(a) || 1)
    b += type === 'log' ? 0.5 : 0.5 * (Math.abs(b) || 1)
  }
  return [g(a - (b - a) * pad), g(b + (b - a) * pad)]
}
