import { fmtNum } from '../lib/data'
import { autoRange } from './axis'
import { drawCard, label, TICK } from './text'
import { formatLinear, linearTicks } from './ticks'

// The scatter matrix: every column plotted against every other in a grid. Column c runs along the x axis of
// grid column c and the y axis of grid row c; the diagonal (a column against itself) is left shaded and empty.

const GAP = 6
const TITLE = 15
const AXIS_TITLE = 12

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const fitted = new WeakMap()
function columnRanges(chart) {
  const hit = fitted.get(chart)
  if (hit) return hit
  const result = chart.columns.map((values) => {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < values.length; i++) {
      if (values[i] < lo) lo = values[i]
      if (values[i] > hi) hi = values[i]
    }
    return autoRange('linear', lo, hi, 0.05)
  })
  fitted.set(chart, result)
  return result
}

/** Everything but the hover: the cells, their points and the outer ticks and labels. */
export function drawMatrixBase(ctx, chart, w, h, env) {
  const c = chart.colors
  ctx.fillStyle = c.paper
  ctx.fillRect(0, 0, w, h)
  const n = chart.labels.length
  const top = chart.title ? 44 : 14
  const plot = { x: 76, y: top, w: w - 76 - 16, h: h - top - 62 }
  if (plot.w < 60 * n * 0.5 || plot.h < 40 * n * 0.5) return null
  const cw = (plot.w - GAP * (n - 1)) / n
  const ch = (plot.h - GAP * (n - 1)) / n
  const geo = { matrix: true, plot, n, cw, ch, ranges: columnRanges(chart), flipY: false, hasY2: false }
  if (chart.title) label(ctx, env, chart.title, 12, 22, { size: TITLE, color: c.font, weight: 500 })

  const cellX = (col) => plot.x + col * (cw + GAP)
  const cellY = (row) => plot.y + row * (ch + GAP)
  const radius = Math.max(1, chart.size / 2)
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const x0 = cellX(col)
      const y0 = cellY(r)
      const [xlo, xhi] = geo.ranges[col]
      const [ylo, yhi] = geo.ranges[r]
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, y0, cw, ch)
      ctx.clip()
      if (r === col) {
        ctx.fillStyle = rgba(c.grid, 0.45)
        ctx.fillRect(x0, y0, cw, ch)
      } else {
        if (chart.grid) {
          ctx.strokeStyle = c.grid
          ctx.lineWidth = 1
          ctx.beginPath()
          for (const v of linearTicks(xlo, xhi, Math.max(2, Math.floor(cw / 70))).vals) {
            const x = Math.round(x0 + ((v - xlo) / (xhi - xlo)) * cw) + 0.5
            ctx.moveTo(x, y0)
            ctx.lineTo(x, y0 + ch)
          }
          for (const v of linearTicks(ylo, yhi, Math.max(2, Math.floor(ch / 45))).vals) {
            const y = Math.round(y0 + ch - ((v - ylo) / (yhi - ylo)) * ch) + 0.5
            ctx.moveTo(x0, y)
            ctx.lineTo(x0 + cw, y)
          }
          ctx.stroke()
        }
        const xs = chart.columns[col]
        const ys = chart.columns[r]
        const path = new Path2D()
        for (let i = 0; i < xs.length; i++) {
          const px = x0 + ((xs[i] - xlo) / (xhi - xlo)) * cw
          const py = y0 + ch - ((ys[i] - ylo) / (yhi - ylo)) * ch
          path.moveTo(px + radius, py)
          path.arc(px, py, radius, 0, 2 * Math.PI)
        }
        ctx.globalAlpha = chart.alpha
        ctx.fillStyle = chart.color
        ctx.fill(path)
        ctx.globalAlpha = 1
      }
      ctx.restore()
      ctx.strokeStyle = c.grid
      ctx.lineWidth = 1
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1)
    }
  }
  // ticks on the outside: x along the bottom row, y down the left column
  for (let col = 0; col < n; col++) {
    const [lo, hi] = geo.ranges[col]
    const t = linearTicks(lo, hi, Math.max(2, Math.floor(cw / 70)))
    const labels = formatLinear(t.vals, t.step)
    t.vals.forEach((v, i) =>
      label(ctx, env, labels[i], cellX(col) + ((v - lo) / (hi - lo)) * cw, plot.y + plot.h + 12, {
        color: c.font,
        align: 'center',
        size: TICK - 1,
      }),
    )
    label(ctx, env, chart.labels[col], cellX(col) + cw / 2, plot.y + plot.h + 36, {
      color: c.font,
      align: 'center',
      size: AXIS_TITLE,
    })
  }
  for (let r = 0; r < n; r++) {
    const [lo, hi] = geo.ranges[r]
    const t = linearTicks(lo, hi, Math.max(2, Math.floor(ch / 45)))
    const labels = formatLinear(t.vals, t.step)
    t.vals.forEach((v, i) =>
      label(ctx, env, labels[i], plot.x - 6, cellY(r) + ch - ((v - lo) / (hi - lo)) * ch, {
        color: c.font,
        align: 'right',
        size: TICK - 1,
      }),
    )
    label(ctx, env, chart.labels[r], 14, cellY(r) + ch / 2, {
      color: c.font,
      align: 'center',
      size: AXIS_TITLE,
      rotate: -Math.PI / 2,
    })
  }
  return geo
}

/** Hovering a cell: ring the nearest point there, and the same row of the data in every other cell. */
export function drawMatrixHover(ctx, env, chart, geo, hover) {
  if (!hover) return
  const { plot, n, cw, ch, ranges } = geo
  const col = Math.floor((hover.x - plot.x) / (cw + GAP))
  const r = Math.floor((hover.y - plot.y) / (ch + GAP))
  if (col < 0 || r < 0 || col >= n || r >= n || col === r) return
  const x0 = plot.x + col * (cw + GAP)
  const y0 = plot.y + r * (ch + GAP)
  if (hover.x > x0 + cw || hover.y > y0 + ch) return
  const [xlo, xhi] = ranges[col]
  const [ylo, yhi] = ranges[r]
  const xs = chart.columns[col]
  const ys = chart.columns[r]
  let best = -1
  let bestD = 18 * 18
  for (let i = 0; i < xs.length; i++) {
    const dx = x0 + ((xs[i] - xlo) / (xhi - xlo)) * cw - hover.x
    const dy = y0 + ch - ((ys[i] - ylo) / (yhi - ylo)) * ch - hover.y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  if (best < 0) return
  const c = chart.colors
  ctx.lineWidth = 1.5
  ctx.strokeStyle = chart.theme === 'Dark' ? '#ffffff' : c.font
  for (let rr = 0; rr < n; rr++) {
    for (let cc = 0; cc < n; cc++) {
      if (rr === cc) continue
      const [a, b] = ranges[cc]
      const [d, e] = ranges[rr]
      const px = plot.x + cc * (cw + GAP) + ((chart.columns[cc][best] - a) / (b - a)) * cw
      const py = plot.y + rr * (ch + GAP) + ch - ((chart.columns[rr][best] - d) / (e - d)) * ch
      ctx.beginPath()
      ctx.arc(px, py, cc === col && rr === r ? 5 : 3.5, 0, 2 * Math.PI)
      ctx.stroke()
    }
  }
  const rows = chart.labels.map((name, k) => ({
    color: k === col || k === r ? chart.color : null,
    text: `${name}: ${fmtNum(chart.columns[k][best])}`,
  }))
  drawCard(ctx, env, c, plot, hover.x, hover.y, `row ${best + 1}`, rows)
}
