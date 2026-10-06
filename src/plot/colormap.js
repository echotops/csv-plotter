// Color scales for the "color by" scatter and its color bar. Each is a list of [position 0-1, color] stops.
const even = (colors) => colors.map((c, i) => [i / (colors.length - 1), c])

export const SCALE_STOPS = {
  Viridis: even([
    '#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725',
  ]),
  Cividis: even([
    '#00204d', '#00336f', '#39486b', '#575c6e', '#707173', '#8a8779', '#a69d75', '#c4b56c', '#e4cf5b', '#ffea46',
  ]),
  RdBu: [
    [0, '#050aac'], [0.35, '#6a89f7'], [0.5, '#bebebe'], [0.6, '#dcaa84'], [0.7, '#e6915a'], [1, '#b20a1c'],
  ],
  Jet: [
    [0, '#000083'], [0.125, '#003caa'], [0.375, '#05ffff'], [0.625, '#ffff00'], [0.875, '#fa0000'], [1, '#800000'],
  ],
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

/** `spec` is a scale name or a ready list of stops; anything unknown falls back to Viridis. */
export function scaleStops(spec) {
  return Array.isArray(spec) ? spec : (SCALE_STOPS[spec] ?? SCALE_STOPS.Viridis)
}

/** The color at position t (0-1) of a scale, as an "rgb(r, g, b)" string. */
export function sampleScale(spec, t) {
  const stops = scaleStops(spec)
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  let k = 1
  while (k < stops.length - 1 && stops[k][0] < x) k++
  const [p0, c0] = stops[k - 1]
  const [p1, c1] = stops[k]
  const f = p1 > p0 ? Math.min(1, Math.max(0, (x - p0) / (p1 - p0))) : 0
  const a = rgb(c0)
  const b = rgb(c1)
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(', ')})`
}

/** `n` evenly spaced colors, for painting many points quickly from a lookup table. */
export const scaleTable = (spec, n = 64) => Array.from({ length: n }, (_, i) => sampleScale(spec, i / (n - 1)))
