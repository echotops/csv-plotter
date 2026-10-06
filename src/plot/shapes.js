import { scaleTable } from './colormap'

// Box, violin and heatmap series. Each draws one series into the plot area (already clipped by the caller);
// `geo` is the geometry from computeGeometry(), `ys` the series' y scale.

const BOX_HALF = 0.25 // half the width of a box, in group spacings
const VIOLIN_HALF = 0.45 // half the widest part of a violin
const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** One box: the box from the first to third quartile, the median line, whiskers, and any outlier dots. */
export function drawBox(ctx, s, geo, ys) {
  const { xs } = geo
  const pos = s.x[0]
  const { q1, q3, median, lo, hi, outliers, showPoints } = s.stats
  const left = xs.px(pos - BOX_HALF)
  const right = xs.px(pos + BOX_HALF)
  const mid = xs.px(pos)
  const [yq1, yq3, ymed, ylo, yhi] = [q1, q3, median, lo, hi].map((v) => ys.px(v))
  ctx.fillStyle = alpha(s.color, 0.3)
  ctx.fillRect(left, yq3, right - left, yq1 - yq3)
  ctx.strokeStyle = s.color
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.strokeRect(left, yq3, right - left, yq1 - yq3)
  ctx.beginPath()
  ctx.moveTo(left, ymed)
  ctx.lineTo(right, ymed)
  ctx.moveTo(mid, yq3)
  ctx.lineTo(mid, yhi)
  ctx.moveTo(mid, yq1)
  ctx.lineTo(mid, ylo)
  ctx.stroke()
  if (showPoints && outliers.length) {
    ctx.fillStyle = s.color
    ctx.beginPath()
    for (const v of outliers) {
      const y = ys.px(v)
      ctx.moveTo(mid + 2, y)
      ctx.arc(mid, y, 2, 0, 2 * Math.PI)
    }
    ctx.fill()
  }
}

/** One violin: the mirrored density curve, filled, with a line across it at the mean. */
export function drawViolin(ctx, s, geo, ys) {
  const { xs } = geo
  const pos = s.x[0]
  const { ys: grid, dens } = s.profile
  const n = grid.length
  const width = (k) => dens[k] * VIOLIN_HALF
  ctx.beginPath()
  for (let k = 0; k < n; k++) {
    const x = xs.px(pos - width(k))
    if (k) ctx.lineTo(x, ys.px(grid[k]))
    else ctx.moveTo(x, ys.px(grid[k]))
  }
  for (let k = n - 1; k >= 0; k--) ctx.lineTo(xs.px(pos + width(k)), ys.px(grid[k]))
  ctx.closePath()
  ctx.fillStyle = s.fill ?? alpha(s.color, 0.4)
  ctx.fill()
  ctx.strokeStyle = s.color
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  // the mean line spans the violin at the height of the mean
  const mean = s.stats.mean
  let k = 1
  while (k < n - 1 && grid[k] < mean) k++
  const f = grid[k] > grid[k - 1] ? Math.min(1, Math.max(0, (mean - grid[k - 1]) / (grid[k] - grid[k - 1]))) : 0
  const w = (dens[k - 1] + (dens[k] - dens[k - 1]) * f) * VIOLIN_HALF
  const y = ys.px(mean)
  ctx.beginPath()
  ctx.moveTo(xs.px(pos - w), y)
  ctx.lineTo(xs.px(pos + w), y)
  ctx.stroke()
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** A grid of cells colored by value (empty cells are left blank), optionally with the value written in each. */
export function drawHeatmap(ctx, s, geo, ys, env) {
  const { xs } = geo
  const g = s.grid
  const lut = scaleTable(g.scale, 128)
  const span = g.cmax - g.cmin || 1
  const gap = g.gap / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `400 11px ${env.font}`
  for (let r = 0; r < g.ny; r++) {
    const ya = ys.px(g.ys[r] - g.dy / 2)
    const yb = ys.px(g.ys[r] + g.dy / 2)
    for (let c = 0; c < g.nx; c++) {
      const v = g.z[r * g.nx + c]
      if (!Number.isFinite(v)) continue
      const xa = xs.px(g.xs[c] - g.dx / 2)
      const xb = xs.px(g.xs[c] + g.dx / 2)
      const color = lut[Math.min(127, Math.max(0, Math.round(((v - g.cmin) / span) * 127)))]
      ctx.fillStyle = color
      const x0 = Math.min(xa, xb) + gap
      const y0 = Math.min(ya, yb) + gap
      const w = Math.abs(xb - xa) - 2 * gap
      const h = Math.abs(yb - ya) - 2 * gap
      // a hair of overlap hides the seams anti-aliasing leaves between neighbouring cells
      ctx.fillRect(x0 - (gap ? 0 : 0.25), y0 - (gap ? 0 : 0.25), w + (gap ? 0 : 0.5), h + (gap ? 0 : 0.5))
      if (g.showText && w > 26 && h > 14) {
        ctx.fillStyle = luminance(color) > 0.55 ? '#1b1d24' : '#ffffff'
        ctx.fillText(v.toFixed(2), x0 + w / 2, y0 + h / 2)
      }
    }
  }
}

/** The cell of a heatmap at data position (x, y), or null when there is none (or it is empty). */
export function heatmapCellAt(s, x, y) {
  const g = s.grid
  const c = Math.round((x - g.xs[0]) / g.dx)
  const r = Math.round((y - g.ys[0]) / g.dy)
  if (c < 0 || r < 0 || c >= g.nx || r >= g.ny) return null
  const v = g.z[r * g.nx + c]
  return Number.isFinite(v) ? { c, r, v } : null
}
