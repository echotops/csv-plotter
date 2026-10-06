// Axis tick positions and labels: "nice" 1-2-5 steps for linear axes, decades for log axes, and calendar-aware
// steps for time axes (timestamps are milliseconds since 1970, shown as UTC so they match the file's text).

/** A 1, 2 or 5 times a power of ten that splits `span` into roughly `target` pieces. */
export function niceStep(span, target) {
  const raw = span / Math.max(target, 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const r = raw / mag
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag
}

export function linearTicks(lo, hi, target = 6) {
  if (!(hi > lo) || !Number.isFinite(lo + hi)) return { vals: [], step: 0 }
  const step = niceStep(hi - lo, target)
  const first = Math.ceil(lo / step - 1e-9)
  const last = Math.floor(hi / step + 1e-9)
  const vals = []
  for (let k = first; k <= last; k++) vals.push(Number((k * step).toPrecision(12)))
  return { vals, step }
}

const decimals = (step) => Math.min(10, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)))
const trimZeros = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)

/** Labels for evenly stepped linear ticks: plain numbers, k / M / B for big steps, exponents for tiny ones. */
export function formatLinear(vals, step) {
  if (!vals.length) return []
  const maxAbs = Math.max(...vals.map(Math.abs))
  const clean = (v) => (Math.abs(v) < step * 1e-9 ? 0 : v)
  if (step >= 1000) {
    const [div, suffix] = maxAbs >= 1e9 ? [1e9, 'B'] : maxAbs >= 1e6 ? [1e6, 'M'] : [1e3, 'k']
    const d = decimals(step / div)
    return vals.map((v) => (clean(v) === 0 ? '0' : trimZeros((v / div).toFixed(d)) + suffix))
  }
  if (step < 1e-3 || maxAbs >= 1e15)
    return vals.map((v) => (clean(v) === 0 ? '0' : Number(v.toPrecision(3)).toExponential().replace('e+', 'e')))
  const d = decimals(step)
  return vals.map((v) => clean(v).toFixed(d))
}

const logLabel = (v) => {
  const s = Number(v.toPrecision(6))
  return s >= 1e-3 && s < 1e5 ? String(s) : s.toExponential().replace('e+', 'e')
}

/** Ticks at decades (plus 2 and 5, or every digit, when the axis spans only a few decades). */
export function logTicks(lo, hi, target = 6) {
  if (!(lo > 0 && hi > lo)) return { vals: [], labels: [] }
  const a = Math.log10(lo)
  const b = Math.log10(hi)
  const decades = b - a
  const stride = Math.max(1, Math.ceil(decades / target))
  const mantissas = decades >= 3 ? [1] : decades >= 1.2 ? [1, 2, 5] : [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const vals = []
  for (let k = Math.floor(a); k <= Math.ceil(b); k += stride) {
    for (const m of mantissas) {
      const v = Number((m * 10 ** k).toPrecision(12))
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) vals.push(v)
    }
  }
  if (vals.length < 2) {
    const lin = linearTicks(lo, hi, target)
    return { vals: lin.vals, labels: formatLinear(lin.vals, lin.step) }
  }
  return { vals, labels: vals.map(logLabel) }
}

const S = 1000
const MIN = 60 * S
const H = 60 * MIN
const D = 24 * H
const STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, S, 2 * S, 5 * S, 10 * S, 15 * S, 30 * S, MIN, 2 * MIN, 5 * MIN, 10 * MIN,
  15 * MIN, 30 * MIN, H, 2 * H, 3 * H, 6 * H, 12 * H, D, 2 * D, 7 * D,
]
const pad = (n, w = 2) => String(n).padStart(w, '0')
const dayOf = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function clockLabel(ms, step) {
  const d = new Date(ms)
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  if (step < S) return `${hm}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
  if (step < MIN) return `${hm}:${pad(d.getUTCSeconds())}`
  return hm
}

/**
 * Time ticks. Short steps are labelled with the time of day (and the date underneath the first tick and
 * wherever the day changes, as a second line after "\n"); steps of a day or more show dates, months or years.
 */
export function timeTicks(lo, hi, target = 6) {
  const span = hi - lo
  if (!(span > 0) || !Number.isFinite(span)) return { vals: [], labels: [] }
  // the ladder of steps is coarse, so allow a few more ticks than the target rather than jump to far too few
  const step = STEPS.find((s) => span / s <= target * 1.5)
  if (step !== undefined) {
    const vals = []
    for (let k = Math.ceil(lo / step); k <= Math.floor(hi / step); k++) vals.push(k * step)
    const labels = vals.map((v, i) => {
      if (step >= D) return dayOf(v)
      const newDay = i === 0 || dayOf(v) !== dayOf(vals[i - 1])
      return clockLabel(v, step) + (newDay ? `\n${dayOf(v)}` : '')
    })
    return { vals, labels }
  }
  const months = span / (30.44 * D)
  const monthStep = [1, 3, 6].find((m) => months / m <= target)
  const vals = []
  if (monthStep) {
    const start = new Date(lo)
    let y = start.getUTCFullYear()
    let m = Math.floor(start.getUTCMonth() / monthStep) * monthStep
    for (let guard = 0; guard < 1000; guard++) {
      const v = Date.UTC(y, m, 1)
      if (v > hi) break
      if (v >= lo) vals.push(v)
      m += monthStep
      if (m >= 12) {
        y += Math.floor(m / 12)
        m %= 12
      }
    }
    return { vals, labels: vals.map((v) => dayOf(v).slice(0, 7)) }
  }
  const years = span / (365.25 * D)
  const yearStep = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => years / s <= target) ?? 1000
  for (let y = Math.ceil(new Date(lo).getUTCFullYear() / yearStep) * yearStep; ; y += yearStep) {
    const v = Date.UTC(y, 0, 1)
    if (v > hi || vals.length > 200) break
    if (v >= lo) vals.push(v)
  }
  return { vals, labels: vals.map((v) => String(new Date(v).getUTCFullYear())) }
}
