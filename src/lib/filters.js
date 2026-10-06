export class FilterError extends Error {}

const WINDOW_MAX = 1_000_000
export const FILTERS = {
  None: { desc: 'No filtering.' },
  'Moving average': {
    desc: 'Mean over a centered window of N samples. Simple; blurs sharp edges.',
    p1: { label: 'Window (samples)', def: 11, min: 1, max: WINDOW_MAX, step: 2 },
  },
  Median: {
    desc: 'Median over N samples. Removes spikes while keeping edges sharp.',
    p1: { label: 'Window (samples, odd)', def: 11, min: 1, max: WINDOW_MAX, step: 2 },
  },
  Gaussian: {
    desc: 'Gaussian-weighted average; smoother than a moving average.',
    p1: { label: 'Sigma (samples)', def: 5, min: 0.5, max: 100000, step: 0.5 },
  },
  'Exponential (EMA)': {
    desc: 'Running average weighting recent samples more. Causal, so it lags the signal.',
    p1: { label: 'Span (samples)', def: 10, min: 1, max: WINDOW_MAX, step: 1 },
  },
  'Savitzky-Golay': {
    desc: 'Local polynomial fit; smooths while preserving peak heights. Can ring near sharp steps.',
    p1: { label: 'Window (samples, odd)', def: 21, min: 3, max: WINDOW_MAX, step: 2 },
    p2: { label: 'Polynomial order', def: 3, min: 1, max: 10, step: 1 },
  },
  'Low-pass (Butterworth)': {
    desc:
      'Zero-phase low-pass (can ring near sharp steps). Cutoff is in Hz; the sample rate is estimated from the X ' +
      'column (1 per row if X is the row index).',
    p1: { label: 'Cutoff (Hz)', def: 10, min: 0.0001, max: 1e9, step: 1 },
    p2: { label: 'Order', def: 4, min: 1, max: 10, step: 1 },
  },
  'High-pass (Butterworth)': {
    desc: 'Zero-phase high-pass; removes slow drift and offsets. Cutoff in Hz as for low-pass.',
    p1: { label: 'Cutoff (Hz)', def: 1, min: 0.0001, max: 1e9, step: 0.1 },
    p2: { label: 'Order', def: 2, min: 1, max: 10, step: 1 },
  },
  'Despike (Hampel)': {
    desc: 'Replaces points deviating from the local median by more than N robust sigmas.',
    p1: { label: 'Window (samples, odd)', def: 11, min: 3, max: WINDOW_MAX, step: 2 },
    p2: { label: 'Threshold (sigma)', def: 3, min: 1, max: 20, step: 0.5 },
  },
}

export const FILTER_NAMES = Object.keys(FILTERS)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** Samples per x-unit (Hz when x is seconds), from the median sample spacing. x values must be numeric/epoch-ms. */
export function estimateFs(x, kind) {
  if (kind === 'cat' || x.length < 2) return 1
  const d = []
  for (let i = 1; i < x.length; i++) {
    const v = x[i] - x[i - 1]
    if (Number.isFinite(v) && v > 0) d.push(v)
  }
  if (!d.length) return 1
  d.sort((a, b) => a - b)
  const mid = d.length >> 1
  const med = d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2
  return kind === 'time' ? 1000 / med : 1 / med
}

export function oddWindow(p, n) {
  let w = Math.max(Math.round(p), 1)
  w += 1 - (w % 2)
  if (w > n) w = n % 2 ? n : n - 1
  return Math.max(w, 1)
}

/** Centered moving average; the window shrinks at the edges. O(n). */
export function rollingMean(y, wIn) {
  const n = y.length
  if (wIn <= 1 || n < 2) return y
  const w = Math.min(wIn, n)
  const c = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + y[i]
  const out = new Float64Array(n)
  const half = Math.floor(w / 2)
  for (let i = 0; i < n; i++) {
    const start = i - half
    const lo = clamp(start, 0, n)
    const hi = clamp(start + w, 0, n)
    out[i] = (c[hi] - c[lo]) / (hi - lo)
  }
  return out
}

function lowerBound(a, v, len) {
  let lo = 0
  let hi = len
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Sliding median, odd window, edges replicate the end samples (scipy mode='nearest'). */
export function medianFilter(y, w) {
  const n = y.length
  const h = (w - 1) >> 1
  const out = new Float64Array(n)
  const win = new Float64Array(w)
  for (let j = -h; j <= h; j++) win[j + h] = y[clamp(j, 0, n - 1)]
  win.sort()
  for (let i = 0; i < n; i++) {
    out[i] = win[h]
    if (i === n - 1) break
    const oldV = y[clamp(i - h, 0, n - 1)]
    const newV = y[clamp(i + h + 1, 0, n - 1)]
    if (oldV === newV) continue
    const rem = lowerBound(win, oldV, w)
    win.copyWithin(rem, rem + 1)
    const pos = lowerBound(win, newV, w - 1)
    win.copyWithin(pos + 1, pos, w - 1)
    win[pos] = newV
  }
  return out
}

export function gaussianFilter(y, sigma) {
  const n = y.length
  const r = Math.trunc(4 * sigma + 0.5)
  if (r < 1) return y
  const k = new Float64Array(2 * r + 1)
  let sum = 0
  for (let j = -r; j <= r; j++) {
    k[j + r] = Math.exp((-0.5 * j * j) / (sigma * sigma))
    sum += k[j + r]
  }
  for (let j = 0; j < k.length; j++) k[j] /= sum
  const pad = new Float64Array(n + 2 * r)
  pad.set(y, r)
  for (let j = 0; j < r; j++) {
    pad[j] = y[0]
    pad[n + r + j] = y[n - 1]
  }
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let j = 0; j < k.length; j++) acc += k[j] * pad[i + j]
    out[i] = acc
  }
  return out
}

export function emaFilter(y, span) {
  const a = 2 / (Math.max(span, 1) + 1)
  const out = new Float64Array(y.length)
  out[0] = y[0]
  for (let i = 1; i < y.length; i++) out[i] = a * y[i] + (1 - a) * out[i - 1]
  return out
}

/** Solve A x = b (A is m x m, row-major arrays) by Gaussian elimination with partial pivoting. */
function solveLinear(A, b) {
  const m = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < m; c++) {
    let p = c
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < m; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(m).fill(0)
  for (let r = m - 1; r >= 0; r--) {
    let s = M[r][m]
    for (let k = r + 1; k < m; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

function vandermonde(w, order) {
  const h = (w - 1) / 2
  const s = Math.max(h, 1)
  return Array.from({ length: w }, (_, j) =>
    Array.from({ length: order + 1 }, (_, k) => Math.pow((j - h) / s, k)),
  )
}

function normalMatrix(V, order) {
  return Array.from({ length: order + 1 }, (_, a) =>
    Array.from({ length: order + 1 }, (_, b) => V.reduce((acc, row) => acc + row[a] * row[b], 0)),
  )
}

/** Least-squares polynomial through w samples; returns fitted values at the requested sample positions. */
function polyFitEval(seg, order, positions) {
  const w = seg.length
  const V = vandermonde(w, order)
  const rhs = Array.from({ length: order + 1 }, (_, a) => V.reduce((acc, row, j) => acc + row[a] * seg[j], 0))
  const coef = solveLinear(normalMatrix(V, order), rhs)
  return positions.map((j) => V[j].reduce((acc, v, k) => acc + v * coef[k], 0))
}

/** Savitzky-Golay with scipy's mode='interp' edge handling (polynomial fit over the first/last window). */
export function savgolFilter(y, w, order) {
  const n = y.length
  const h = (w - 1) >> 1
  const V = vandermonde(w, order)
  const u = solveLinear(normalMatrix(V, order), [1, ...new Array(order).fill(0)])
  const coef = V.map((row) => row.reduce((acc, v, k) => acc + v * u[k], 0))
  const out = new Float64Array(n)
  for (let i = h; i < n - h; i++) {
    let acc = 0
    for (let j = 0; j < w; j++) acc += coef[j] * y[i - h + j]
    out[i] = acc
  }
  const head = polyFitEval(
    y.subarray(0, w),
    order,
    Array.from({ length: h }, (_, j) => j),
  )
  const tail = polyFitEval(
    y.subarray(n - w),
    order,
    Array.from({ length: h }, (_, j) => w - h + j),
  )
  for (let j = 0; j < h; j++) {
    out[j] = head[j]
    out[n - h + j] = tail[j]
  }
  return out
}

export function butterSos(order, cutoff, fs, type) {
  const wd = (2 * Math.PI * cutoff) / fs
  const warped = 2 * fs * Math.tan(wd / 2) // analog cutoff, rad/s (bilinear prewarp)
  const fs2 = 2 * fs
  // digital poles from analog prototype poles: p = -exp(i*pi*m/(2N)), m = -N+1, -N+3, ..., N-1
  const poles = []
  for (let m = -order + 1; m < order; m += 2) {
    const ang = (Math.PI * m) / (2 * order)
    let pr = -Math.cos(ang)
    let pi = -Math.sin(ang)
    if (type === 'low') {
      pr *= warped
      pi *= warped
    } else {
      // lp2hp: p -> wo / p
      const d = pr * pr + pi * pi
      pr = (warped * pr) / d
      pi = (-warped * pi) / d
    }
    // bilinear: (fs2 + p) / (fs2 - p)
    const nr = fs2 + pr
    const ni = pi
    const dr = fs2 - pr
    const di = -pi
    const dd = dr * dr + di * di
    poles.push([(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd])
  }
  // overall gain so that the passband is unity: evaluate at DC (low) or Nyquist (high)
  const zeroVal = type === 'low' ? -1 : 1
  const sections = []
  const used = new Array(poles.length).fill(false)
  for (let i = 0; i < poles.length; i++) {
    if (used[i]) continue
    used[i] = true
    const [pr, pi] = poles[i]
    if (Math.abs(pi) < 1e-12) {
      sections.push([1, -zeroVal, 0, 1, -pr, 0])
    } else {
      let j = -1
      for (let k = i + 1; k < poles.length; k++) {
        if (!used[k] && Math.abs(poles[k][0] - pr) < 1e-9 && Math.abs(poles[k][1] + pi) < 1e-9) {
          j = k
          break
        }
      }
      used[j] = true
      sections.push([1, -2 * zeroVal, 1, 1, -2 * pr, pr * pr + pi * pi])
    }
  }
  // normalise gain: |H(passband)| = 1 for the cascade
  const zRe = type === 'low' ? 1 : -1 // evaluation point z = 1 (DC) or z = -1 (Nyquist)
  let gain = 1
  for (const [b0, b1, b2, , a1, a2] of sections) {
    const num = b0 + b1 * zRe + b2
    const den = 1 + a1 * zRe + a2
    gain *= den / num
  }
  sections[0] = [sections[0][0] * gain, sections[0][1] * gain, sections[0][2] * gain, ...sections[0].slice(3)]
  return sections
}

function sosFilt(sos, x, zi) {
  let cur = x
  for (let s = 0; s < sos.length; s++) {
    const [b0, b1, b2, , a1, a2] = sos[s]
    let z0 = zi[s][0]
    let z1 = zi[s][1]
    const out = new Float64Array(cur.length)
    for (let i = 0; i < cur.length; i++) {
      const xi = cur[i]
      const yi = b0 * xi + z0
      z0 = b1 * xi - a1 * yi + z1
      z1 = b2 * xi - a2 * yi
      out[i] = yi
    }
    cur = out
  }
  return cur
}

/** Steady-state initial conditions for a unit step through the cascade (scipy.signal.sosfilt_zi). */
function sosfiltZi(sos) {
  const zi = []
  let scale = 1
  for (const [b0, b1, b2, , a1, a2] of sos) {
    // solve (I - A^T) z = B - a[1:] * b0 for the 2-state transposed direct form II
    const B0 = b1 - a1 * b0
    const B1 = b2 - a2 * b0
    // I - companion(a).T = [[1 + a1, -1], [a2, 1]]
    const det = (1 + a1) * 1 + a2
    const z0 = (B0 * 1 + B1) / det
    const z1 = ((1 + a1) * B1 - a2 * B0) / det
    zi.push([z0 * scale, z1 * scale])
    scale *= (b0 + b1 + b2) / (1 + a1 + a2)
  }
  return zi
}

export function sosFiltFilt(sos, x) {
  const firstOrder = sos.filter((s) => s[2] === 0 && s[5] === 0).length
  const edge = 3 * (2 * sos.length + 1 - firstOrder)
  const n = x.length
  if (n <= edge) throw new FilterError(`need more than ${edge} samples for this filter`)
  const ext = new Float64Array(n + 2 * edge)
  for (let i = 0; i < edge; i++) {
    ext[i] = 2 * x[0] - x[edge - i]
    ext[n + edge + i] = 2 * x[n - 1] - x[n - 2 - i]
  }
  ext.set(x, edge)
  const zi = sosfiltZi(sos)
  const forward = sosFilt(
    sos,
    ext,
    zi.map((z) => z.map((v) => v * ext[0])),
  )
  forward.reverse()
  const backward = sosFilt(
    sos,
    forward,
    zi.map((z) => z.map((v) => v * forward[0])),
  )
  backward.reverse()
  return backward.slice(edge, edge + n)
}

export function applyFilter(y, name, p1, p2, fs) {
  const n = y.length
  if (name === 'None' || n < 3) return { y, info: '' }
  switch (name) {
    case 'Moving average':
      return { y: rollingMean(y, Math.max(Math.round(p1), 1)), info: '' }
    case 'Median':
      return { y: medianFilter(y, oddWindow(p1, n)), info: '' }
    case 'Gaussian':
      return { y: gaussianFilter(y, Math.max(p1, 0.1)), info: '' }
    case 'Exponential (EMA)':
      return { y: emaFilter(y, p1), info: '' }
    case 'Savitzky-Golay': {
      const w = oddWindow(p1, n)
      const order = Math.round(p2)
      if (order >= w) throw new FilterError(`polynomial order (${order}) must be below the window (${w})`)
      return { y: savgolFilter(y, w, order), info: '' }
    }
    case 'Low-pass (Butterworth)':
    case 'High-pass (Butterworth)': {
      const nyq = fs / 2
      if (!(p1 > 0 && p1 < nyq))
        throw new FilterError(`cutoff must be between 0 and ${fmt(nyq)} Hz (fs is about ${fmt(fs)} Hz)`)
      const sos = butterSos(Math.max(Math.round(p2), 1), p1, fs, name.startsWith('Low') ? 'low' : 'high')
      return { y: sosFiltFilt(sos, y), info: `fs ~ ${fmt(fs)} Hz` }
    }
    case 'Despike (Hampel)': {
      const w = oddWindow(p1, n)
      const med = medianFilter(y, w)
      const dev = new Float64Array(n)
      for (let i = 0; i < n; i++) dev[i] = Math.abs(y[i] - med[i])
      const mad = medianFilter(dev, w)
      const out = new Float64Array(y)
      let replaced = 0
      for (let i = 0; i < n; i++) {
        const m = 1.4826 * mad[i]
        if (m > 0 && dev[i] > p2 * m) {
          out[i] = med[i]
          replaced++
        }
      }
      return { y: out, info: `${replaced} spikes replaced` }
    }
    default:
      throw new FilterError(`unknown filter ${name}`)
  }
}

const fmt = (v) => Number(v.toPrecision(4)).toString()
