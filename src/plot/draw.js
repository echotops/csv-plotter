import { fmtNum, fmtTime } from '../lib/data'
import { autoRange, makeScale } from './axis'
import { scaleTable } from './colormap'
import { findHover, lowerBound } from './hover'
import { drawMatrixBase, drawMatrixHover } from './matrix'
import { drawCard, label, measure, TICK } from './text'
import { drawBox, drawHeatmap, drawViolin, heatmapCellAt } from './shapes'
import { formatLinear, linearTicks, logTicks, timeTicks } from './ticks'

const AXIS_TITLE = 12
const TITLE = 15

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// --- ranges ---------------------------------------------------------------------------------------------

const scaleType = (axis) => (axis.type === 'log' ? 'log' : 'linear')
const fits = new WeakMap()

/** The range that shows all of a chart's data on each axis (cached per chart). */
function fit(chart) {
  const hit = fits.get(chart)
  if (hit) return hit
  const ext = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], y2: [Infinity, -Infinity] }
  const xLog = chart.x.type === 'log'
  for (const s of chart.series) {
    const ye = ext[s.axis]
    const yLog = (s.axis === 'y2' ? chart.y2 : chart.y).type === 'log'
    for (let i = 0; i < s.x.length; i++) {
      const x = s.x[i]
      const y = s.y[i]
      if (!Number.isFinite(x) || !Number.isFinite(y) || (xLog && x <= 0) || (yLog && y <= 0)) continue
      const half = s.barWidth / 2 // a histogram bar reaches half its width past its center
      if (x - half < ext.x[0]) ext.x[0] = x - half
      if (x + half > ext.x[1]) ext.x[1] = x + half
      if (y < ye[0]) ye[0] = y
      if (y > ye[1]) ye[1] = y
    }
    // bars and filled areas stand on zero
    if ((s.mode === 'bars' || s.fill) && !yLog && Number.isFinite(ye[0])) {
      ye[0] = Math.min(ye[0], 0)
      ye[1] = Math.max(ye[1], 0)
    }
  }
  const pad = chart.x.pad
  const result = {
    x: autoRange(scaleType(chart.x), ext.x[0] - pad, ext.x[1] + pad, 0),
    y: autoRange(scaleType(chart.y), ext.y[0], ext.y[1], chart.y.margin ?? 0.05),
    y2: chart.y2 ? autoRange(scaleType(chart.y2), ext.y2[0], ext.y2[1], 0.05) : null,
  }
  fits.set(chart, result)
  return result
}

/** What each axis currently shows: the user's zoom, else the chart's own limits, else everything. */
export function currentRanges(chart, view) {
  const auto = fit(chart)
  const pick = (key) => {
    for (const r of [view[key], chart[key]?.range]) if (r && r[1] > r[0]) return r
    return auto[key]
  }
  return { x: pick('x'), y: pick('y'), y2: chart.y2 ? pick('y2') : null }
}

// --- ticks ----------------------------------------------------------------------------------------------

function axisTicks(axis, [lo, hi], target) {
  if (axis.ticks) {
    const inside = axis.ticks.vals
      .map((v, i) => ({ v, label: axis.ticks.labels[i] }))
      .filter((t) => t.v >= lo - 1e-9 && t.v <= hi + 1e-9)
    const stride = Math.max(1, Math.ceil(inside.length / Math.max(1, target)))
    const kept = inside.filter((_, i) => i % stride === 0)
    return { vals: kept.map((t) => t.v), labels: kept.map((t) => t.label) }
  }
  if (axis.type === 'log') return logTicks(lo, hi, target)
  if (axis.type === 'time') return timeTicks(lo, hi, target)
  const t = linearTicks(lo, hi, target)
  return { vals: t.vals, labels: formatLinear(t.vals, t.step) }
}

// --- layout ---------------------------------------------------------------------------------------------

const COLORBAR_W = 14

function computeGeometry(ctx, env, chart, w, h, ranges) {
  const top = chart.title ? 44 : 14
  const widest = (labels, size = TICK) => {
    let max = 0
    for (const l of labels) for (const line of String(l).split('\n')) max = Math.max(max, measure(ctx, env, line, size, '#000').w)
    return max
  }
  const yTarget = (height) => Math.max(2, Math.floor(height / 46))
  const xTarget = (width) => Math.max(2, Math.floor(width / (chart.x.type === 'time' ? 100 : 80)))

  const cb = chart.colorbar
  const cbTicks = cb && Number.isFinite(cb.cmin) && cb.cmax > cb.cmin ? linearTicks(cb.cmin, cb.cmax, 5) : null
  const cbLabels = cbTicks ? formatLinear(cbTicks.vals, cbTicks.step) : []
  const cbMargin = cb ? 16 + COLORBAR_W + 8 + widest(cbLabels) + (cb.title ? 26 : 8) : 0

  let plotH = h - top - 56
  let yt = axisTicks(chart.y, ranges.y, yTarget(plotH))
  let y2t = chart.y2 ? axisTicks(chart.y2, ranges.y2, yTarget(plotH)) : null
  const left = widest(yt.labels) + 12 + (chart.y.title ? 20 : 0) + 8
  // the right axis (labels, then its title) comes first, with the color bar after it
  const y2LabelW = y2t ? widest(y2t.labels) : 0
  const y2Block = y2t ? 8 + y2LabelW + (chart.y2.title ? 26 : 6) + 8 : 0
  const right = y2Block + (cb ? cbMargin : 16)
  const plotW = w - left - right
  const xt = axisTicks(chart.x, ranges.x, xTarget(plotW))
  const angle = ((chart.x.angle || 0) * Math.PI) / 180
  const lines = Math.max(1, ...xt.labels.map((l) => String(l).split('\n').length))
  const labelsH = angle ? widest(xt.labels) * Math.abs(Math.sin(angle)) + 12 : lines * 15 + 6
  const bottom = labelsH + 8 + (chart.x.title ? 22 : 0) + 6
  plotH = h - top - bottom
  if (plotW < 30 || plotH < 30) return null
  yt = axisTicks(chart.y, ranges.y, yTarget(plotH))
  y2t = chart.y2 ? axisTicks(chart.y2, ranges.y2, yTarget(plotH)) : null

  const plot = { x: left, y: top, w: plotW, h: plotH }
  const flipY = Boolean(chart.y.reversed) // heatmaps list their first row at the top
  return {
    plot,
    flipY,
    xs: makeScale(scaleType(chart.x), ranges.x[0], ranges.x[1], plot.x, plot.x + plot.w),
    ys: makeScale(scaleType(chart.y), ranges.y[0], ranges.y[1], flipY ? plot.y : plot.y + plot.h, flipY ? plot.y + plot.h : plot.y),
    y2s: chart.y2 ? makeScale(scaleType(chart.y2), ranges.y2[0], ranges.y2[1], plot.y + plot.h, plot.y) : null,
    ticks: { x: xt, y: yt, y2: y2t },
    cb: cb && cbTicks ? { x: plot.x + plot.w + y2Block + 16, y: plot.y, w: COLORBAR_W, h: Math.min(plot.h, 280), ticks: cbTicks, labels: cbLabels } : null,
    y2LabelW,
    angle,
    width: w,
    height: h,
  }
}

// --- series ---------------------------------------------------------------------------------------------

function visibleSpan(s, geo, slack) {
  const n = s.x.length
  if (!s.sorted || n < 3) return [0, n - 1]
  const lo = geo.xs.val(geo.plot.x - slack)
  const hi = geo.xs.val(geo.plot.x + geo.plot.w + slack)
  return [Math.max(0, lowerBound(s.x, lo) - 1), Math.min(n - 1, lowerBound(s.x, hi) + 1)]
}

// Walks a series left to right as pixel positions, calling emit(px, py) for each vertex of its line (and
// emit(null) where the line breaks). When there are many more points than pixel columns, each column keeps only
// its first, lowest, highest and last point, in order: it looks the same but costs a few vertices per pixel
// instead of one per point, which is what keeps a noisy 100,000-point trace fast to zoom and pan.
function walk(s, xs, ys, i0, i1, columns, emit) {
  const reduce = s.sorted && i1 - i0 + 1 > columns * 3
  if (!reduce) {
    for (let i = i0; i <= i1; i++) {
      const px = xs.px(s.x[i])
      const py = ys.px(s.y[i])
      if (Number.isFinite(px) && Number.isFinite(py)) emit(px, py)
      else emit(null)
    }
    return
  }
  let col = NaN
  let first = 0
  let last = 0
  let lo = 0 // index of the point nearest the top of the plot in this column, and of the lowest one
  let hi = 0
  let loY = 0
  let hiY = 0
  const out = [0, 0, 0, 0]
  const flush = () => {
    if (Number.isNaN(col)) return
    out[0] = first
    out[1] = lo
    out[2] = hi
    out[3] = last
    out.sort((a, b) => a - b)
    for (let k = 0; k < 4; k++) {
      if (k && out[k] === out[k - 1]) continue
      emit(xs.px(s.x[out[k]]), ys.px(s.y[out[k]]))
    }
  }
  for (let i = i0; i <= i1; i++) {
    const px = xs.px(s.x[i])
    const py = ys.px(s.y[i])
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      flush()
      emit(null)
      col = NaN
      continue
    }
    const c = Math.floor(px)
    if (c !== col) {
      flush()
      col = c
      first = lo = hi = i
      loY = hiY = py
    } else if (py < loY) {
      lo = i
      loY = py
    } else if (py > hiY) {
      hi = i
      hiY = py
    }
    last = i
  }
  flush()
}

// Liang-Barsky: the part of the segment inside the rectangle, as [t0, t1] along it, or null if none of it is.
function clipSegment(x0, y0, x1, y1, r, out) {
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1
  const edges = [-dx, dx, -dy, dy]
  const dist = [x0 - r.x0, r.x1 - x0, y0 - r.y0, r.y1 - y0]
  for (let k = 0; k < 4; k++) {
    const p = edges[k]
    const q = dist[k]
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) {
        if (t > t1) return false
        if (t > t0) t0 = t
      } else {
        if (t < t0) return false
        if (t < t1) t1 = t
      }
    }
  }
  out[0] = t0
  out[1] = t1
  return true
}

// Adds the series' line to the current path, cut off at the plot's edge: a point far outside the plot (a
// spike when zoomed in on a narrow band) would otherwise make the canvas rasterize enormous, mostly invisible
// strokes on every frame.
function traceLine(ctx, s, geo, ys, i0, i1) {
  const { plot, xs } = geo
  const pad = 4
  const r = { x0: plot.x - pad, x1: plot.x + plot.w + pad, y0: plot.y - pad, y1: plot.y + plot.h + pad }
  const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
  const t = [0, 0]
  let has = false
  let pen = false
  let px = 0
  let py = 0
  const add = (x, y) => {
    if (!has) {
      has = true
      pen = inside(x, y)
      if (pen) ctx.moveTo(x, y)
    } else if (pen && inside(x, y)) {
      ctx.lineTo(x, y)
    } else if (clipSegment(px, py, x, y, r, t)) {
      if (t[0] > 0 || !pen) ctx.moveTo(px + (x - px) * t[0], py + (y - py) * t[0])
      ctx.lineTo(px + (x - px) * t[1], py + (y - py) * t[1])
      pen = t[1] === 1
    } else {
      pen = false
    }
    px = x
    py = y
  }
  ctx.beginPath()
  walk(s, xs, ys, i0, i1, plot.w, (x, y) => {
    if (x === null) {
      has = false
      return
    }
    if (s.step && has) add(x, py)
    add(x, y)
  })
}

// The closed outline of an area: the line down to the baseline and back. Heights are kept within a few plot
// heights of the plot so the polygon stays a sane size (what lies that far out is clipped away anyway).
function traceArea(ctx, s, geo, ys, i0, i1) {
  const { plot, xs } = geo
  const base = ys.type === 'log' ? plot.y + plot.h : ys.px(0)
  const lim = plot.h * 4
  const clamp = (y) => Math.min(plot.y + plot.h + lim, Math.max(plot.y - lim, y))
  let first = null
  let last = null
  let prevY = 0
  ctx.beginPath()
  walk(s, xs, ys, i0, i1, plot.w, (x, y) => {
    if (x === null) return
    if (first === null) {
      first = x
      ctx.moveTo(x, clamp(y))
    } else {
      if (s.step) ctx.lineTo(x, clamp(prevY))
      ctx.lineTo(x, clamp(y))
    }
    prevY = y
    last = x
  })
  if (first === null) return
  const b = clamp(base)
  ctx.lineTo(last, b)
  ctx.lineTo(first, b)
  ctx.closePath()
}

// Markers are drawn one by one (so overlapping points build up opacity and show density) up to a point count,
// and beyond that batched into a few paths per color, which is much faster but flattens overlaps.
const MARKERS_ONE_BY_ONE = 20000

function drawMarkers(ctx, s, geo, ys, i0, i1) {
  const { xs, plot } = geo
  const r = Math.max(0.5, s.size / 2)
  const off = (px, py) => px < plot.x - r || px > plot.x + plot.w + r || py < plot.y - r || py > plot.y + plot.h + r
  const lut = s.colors ? scaleTable(s.colors.scale, 64) : null
  const cmin = s.colors?.cmin ?? 0
  const span = (s.colors?.cmax ?? 1) - cmin || 1
  const bucket = (i) =>
    lut ? Math.min(63, Math.max(0, Math.round(((s.colors.values[i] - cmin) / span) * 63))) : 0
  if (i1 - i0 < MARKERS_ONE_BY_ONE) {
    let current = -1
    for (let i = i0; i <= i1; i++) {
      const px = xs.px(s.x[i])
      const py = ys.px(s.y[i])
      if (!Number.isFinite(px) || !Number.isFinite(py) || off(px, py)) continue
      const key = bucket(i)
      if (key !== current) {
        ctx.fillStyle = lut ? lut[key] : s.color
        current = key
      }
      ctx.beginPath()
      ctx.arc(px, py, r, 0, 2 * Math.PI)
      ctx.fill()
    }
    return
  }
  const buckets = new Map()
  for (let i = i0; i <= i1; i++) {
    const px = xs.px(s.x[i])
    const py = ys.px(s.y[i])
    if (!Number.isFinite(px) || !Number.isFinite(py) || off(px, py)) continue
    const key = bucket(i)
    let path = buckets.get(key)
    if (!path) buckets.set(key, (path = new Path2D()))
    path.rect(px - r, py - r, r * 2, r * 2)
  }
  for (const [key, path] of buckets) {
    ctx.fillStyle = lut ? lut[key] : s.color
    ctx.fill(path)
  }
}

function drawBars(ctx, s, geo, ys) {
  const { plot, xs } = geo
  const [i0, i1] = visibleSpan(s, geo, 40)
  const base = ys.type === 'log' ? plot.y + plot.h : ys.px(0)
  // a histogram's bars have a width of their own and sit on top of each other; plain bars share each slot
  const group = s.barWidth || 0.8 / s.slots
  const off = s.barWidth ? 0 : (s.slot - (s.slots - 1) / 2) * group
  ctx.fillStyle = s.color
  for (let i = i0; i <= i1; i++) {
    const y = s.y[i]
    const py = ys.px(y)
    if (!Number.isFinite(py) || !Number.isFinite(s.x[i])) continue
    const a = xs.px(s.x[i] + off - group / 2)
    const b = xs.px(s.x[i] + off + group / 2)
    const gap = Math.abs(b - a) > 5 ? 1 : 0
    ctx.fillRect(Math.min(a, b) + gap / 2, Math.min(py, base), Math.max(1, Math.abs(b - a) - gap), Math.abs(py - base))
  }
}

function drawSeries(ctx, chart, s, geo, env) {
  const ys = s.axis === 'y2' ? geo.y2s : geo.ys
  ctx.globalAlpha = s.alpha
  if (s.mode === 'box' || s.mode === 'violin' || s.mode === 'heatmap') {
    if (s.mode === 'box') drawBox(ctx, s, geo, ys)
    else if (s.mode === 'violin') drawViolin(ctx, s, geo, ys)
    else drawHeatmap(ctx, s, geo, ys, env)
    ctx.globalAlpha = 1
    return
  }
  if (s.mode === 'bars') {
    drawBars(ctx, s, geo, ys)
    ctx.globalAlpha = 1
    return
  }
  const [i0, i1] = visibleSpan(s, geo, 8)
  if (s.fill) {
    traceArea(ctx, s, geo, ys, i0, i1)
    ctx.fillStyle = s.fill
    ctx.fill()
  }
  if (s.mode.includes('lines')) {
    traceLine(ctx, s, geo, ys, i0, i1)
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  if (s.mode.includes('markers')) drawMarkers(ctx, s, geo, ys, i0, i1)
  ctx.globalAlpha = 1
}

// --- chrome ---------------------------------------------------------------------------------------------

function drawAxes(ctx, env, chart, geo) {
  const { plot, ticks } = geo
  const c = chart.colors
  ctx.lineWidth = 1
  if (chart.grid) {
    ctx.strokeStyle = c.grid
    ctx.beginPath()
    for (const v of ticks.x.vals) {
      const x = Math.round(geo.xs.px(v)) + 0.5
      ctx.moveTo(x, plot.y)
      ctx.lineTo(x, plot.y + plot.h)
    }
    for (const v of ticks.y.vals) {
      const y = Math.round(geo.ys.px(v)) + 0.5
      ctx.moveTo(plot.x, y)
      ctx.lineTo(plot.x + plot.w, y)
    }
    ctx.stroke()
  }
  for (const [i, v] of ticks.y.vals.entries())
    label(ctx, env, ticks.y.labels[i], plot.x - 8, geo.ys.px(v), { color: c.font, align: 'right' })
  if (geo.y2s)
    for (const [i, v] of ticks.y2.vals.entries())
      label(ctx, env, ticks.y2.labels[i], plot.x + plot.w + 8, geo.y2s.px(v), { color: c.font })
  for (const [i, v] of ticks.x.vals.entries()) {
    const x = geo.xs.px(v)
    const lines = String(ticks.x.labels[i]).split('\n')
    if (geo.angle) {
      label(ctx, env, lines[0], x, plot.y + plot.h + 10, { color: c.font, align: 'right', rotate: geo.angle })
      continue
    }
    lines.forEach((line, k) =>
      label(ctx, env, line, x, plot.y + plot.h + 14 + k * 14, {
        color: k ? c.muted : c.font,
        align: 'center',
        size: k ? TICK - 1 : TICK,
      }),
    )
  }
  // titles
  if (chart.title) label(ctx, env, chart.title, 12, 22, { size: TITLE, color: c.font, weight: 500 })
  if (chart.x.title)
    label(ctx, env, chart.x.title, plot.x + plot.w / 2, geo.height - 14, { size: AXIS_TITLE, color: c.font, align: 'center' })
  if (chart.y.title)
    label(ctx, env, chart.y.title, 14, plot.y + plot.h / 2, { size: AXIS_TITLE, color: c.font, align: 'center', rotate: -Math.PI / 2 })
  if (chart.y2?.title)
    label(ctx, env, chart.y2.title, plot.x + plot.w + 8 + geo.y2LabelW + 14, plot.y + plot.h / 2, {
      size: AXIS_TITLE,
      color: c.font,
      align: 'center',
      rotate: Math.PI / 2,
    })
}

function drawColorbar(ctx, env, chart, geo) {
  const cb = geo.cb
  if (!cb) return
  const { colorbar, colors: c } = chart
  const lut = scaleTable(colorbar.scale, 128)
  for (let r = 0; r < cb.h; r++) {
    ctx.fillStyle = lut[Math.round((1 - r / (cb.h - 1)) * 127)]
    ctx.fillRect(cb.x, cb.y + r, cb.w, 1)
  }
  const span = colorbar.cmax - colorbar.cmin
  cb.ticks.vals.forEach((v, i) =>
    label(ctx, env, cb.labels[i], cb.x + cb.w + 8, cb.y + (1 - (v - colorbar.cmin) / span) * cb.h, { color: c.font }),
  )
  if (colorbar.title) {
    const labelW = Math.max(0, ...cb.labels.map((l) => measure(ctx, env, l, TICK, c.font).w))
    label(ctx, env, colorbar.title, cb.x + cb.w + 8 + labelW + 14, cb.y + cb.h / 2, {
      size: AXIS_TITLE,
      color: c.font,
      align: 'center',
      rotate: Math.PI / 2,
    })
  }
}

function drawLegend(ctx, env, chart, geo) {
  const items = chart.series.filter((s) => s.inLegend)
  if (!chart.legend || !items.length) return
  const c = chart.colors
  const nameW = Math.max(...items.map((s) => measure(ctx, env, s.name, TICK, c.font).w))
  const w = nameW + 46
  const h = items.length * 18 + 8
  const x = geo.plot.x + geo.plot.w - w - 8
  const y = geo.plot.y + 8
  ctx.fillStyle = rgba(c.paper, 0.75)
  ctx.strokeStyle = c.grid
  ctx.beginPath()
  ctx.roundRect(x + 0.5, y + 0.5, w, h, 4)
  ctx.fill()
  ctx.stroke()
  items.forEach((s, i) => {
    const cy = y + 4 + i * 18 + 9
    ctx.globalAlpha = Math.max(0.5, s.alpha)
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    if (s.mode === 'bars' || s.fill) ctx.fillRect(x + 8, cy - 5, 22, 10)
    else if (s.mode === 'markers') {
      ctx.beginPath()
      ctx.arc(x + 19, cy, 4, 0, 2 * Math.PI)
      ctx.fill()
    } else {
      ctx.lineWidth = Math.max(1.5, s.width)
      ctx.beginPath()
      ctx.moveTo(x + 8, cy)
      ctx.lineTo(x + 30, cy)
      ctx.stroke()
      if (s.mode.includes('markers')) {
        ctx.beginPath()
        ctx.arc(x + 19, cy, 3, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    label(ctx, env, s.name, x + 38, cy, { color: c.font })
  })
  ctx.lineWidth = 1
}

const xText = (chart, v) =>
  chart.x.type === 'time'
    ? fmtTime(v)
    : chart.x.type === 'category'
      ? (chart.x.labels?.[Math.round(v)] ?? '')
      : fmtNum(v)

const rangeText = (center, step) => `${fmtNum(center - step / 2)} to ${fmtNum(center + step / 2)}`

// Hovering a heatmap: outline the cell under the cursor and say what it holds.
function drawCellHover(ctx, env, chart, geo, hover) {
  const s = chart.series[0]
  const { xs, ys } = geo
  const cell = heatmapCellAt(s, xs.val(hover.x), ys.val(hover.y))
  if (!cell) return
  const g = s.grid
  const xa = xs.px(g.xs[cell.c] - g.dx / 2)
  const xb = xs.px(g.xs[cell.c] + g.dx / 2)
  const ya = ys.px(g.ys[cell.r] - g.dy / 2)
  const yb = ys.px(g.ys[cell.r] + g.dy / 2)
  ctx.save()
  ctx.strokeStyle = chart.theme === 'Dark' ? '#ffffff' : chart.colors.font
  ctx.lineWidth = 1.5
  ctx.strokeRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya))
  ctx.restore()
  const value = { text: `${g.zName || 'value'}: ${fmtNum(cell.v)}` }
  const rows = g.xLabels
    ? [value]
    : [
        { text: `${chart.x.title || 'x'}: ${rangeText(g.xs[cell.c], g.dx)}` },
        { text: `${chart.y.title || 'y'}: ${rangeText(g.ys[cell.r], g.dy)}` },
        value,
      ]
  const head = g.xLabels ? `${g.yLabels?.[cell.r] ?? ''} \u00d7 ${g.xLabels[cell.c]}` : ''
  drawCard(ctx, env, chart.colors, geo.plot, hover.x, hover.y, head, rows)
}

function drawHover(ctx, env, chart, geo, hover) {
  const { plot, xs } = geo
  if (!hover || hover.x < plot.x || hover.x > plot.x + plot.w || hover.y < plot.y || hover.y > plot.y + plot.h) return
  if (chart.hover === 'cell') return drawCellHover(ctx, env, chart, geo, hover)
  const found = findHover(chart.series, xs, hover.x)
  if (!found) return
  const c = chart.colors
  const hx = xs.px(found.x)
  // dotted crosshair at the point being read
  ctx.save()
  ctx.setLineDash([2, 3])
  ctx.strokeStyle = c.muted
  ctx.beginPath()
  ctx.moveTo(Math.round(hx) + 0.5, plot.y)
  ctx.lineTo(Math.round(hx) + 0.5, plot.y + plot.h)
  ctx.stroke()
  ctx.restore()
  const rows = []
  for (const { series: s, i } of found.rows) {
    if (s.readout) {
      // a box or violin lists its statistics under its name
      rows.push({ color: s.color, text: s.name })
      for (const [name, value] of s.readout) rows.push({ text: `${name}: ${fmtNum(value)}`, muted: false })
      continue
    }
    const ys = s.axis === 'y2' ? geo.y2s : geo.ys
    ctx.fillStyle = s.color
    ctx.strokeStyle = c.paper
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(xs.px(s.x[i]), ys.px(s.y[i]), 4, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
    rows.push({ color: s.color, text: `${s.name}: ${fmtNum(s.y[i])}` })
  }
  // groups of boxes or violins have no single x value to show above the rows
  drawCard(ctx, env, chart.colors, geo.plot, hx, hover.y, chart.series.some((s) => s.readout) ? '' : xText(chart, found.x), rows)
}

/**
 * Everything but the hover readout and zoom box: axes, data, color bar, legend. Slow with a lot of data, so
 * callers can keep the result as a picture and draw only drawOverlay on top while the mouse moves.
 *
 * @param {CanvasRenderingContext2D} ctx already scaled so one unit is one CSS pixel
 * @param {object} chart a chart spec from chartFromFigure()
 * @param {number} w canvas width in CSS pixels
 * @param {number} h canvas height in CSS pixels
 * @param {{x?: number[], y?: number[], y2?: number[]}} view the user's zoom; missing axes show everything
 * @param {{font: string, math: {get: Function}}} env
 * @returns the plot rectangle and axis scales (for hit-testing), or null when the canvas is too small
 */
export function drawBase(ctx, chart, w, h, view, env) {
  if (chart.kind === 'matrix') return drawMatrixBase(ctx, chart, w, h, env)
  const c = chart.colors
  ctx.fillStyle = c.paper
  ctx.fillRect(0, 0, w, h)
  const ranges = currentRanges(chart, view)
  const geo = computeGeometry(ctx, env, chart, w, h, ranges)
  if (!geo) return null
  drawAxes(ctx, env, chart, geo)
  ctx.save()
  ctx.beginPath()
  ctx.rect(geo.plot.x, geo.plot.y, geo.plot.w, geo.plot.h)
  ctx.clip()
  for (const s of chart.series) drawSeries(ctx, chart, s, geo, env)
  ctx.restore()
  drawColorbar(ctx, env, chart, geo)
  drawLegend(ctx, env, chart, geo)
  return { ...geo, hasY2: Boolean(geo.y2s), ranges }
}

// A small arrow whose point is at (x, y); `dir` is the way it points.
function arrow(ctx, x, y, dir) {
  const [dx, dy] = dir
  const px = -dy // across the shaft
  const py = dx
  const back = (n) => [x - dx * n, y - dy * n]
  ctx.beginPath()
  const [sx, sy] = back(18)
  ctx.moveTo(sx, sy)
  ctx.lineTo(x, y)
  const [hx, hy] = back(6)
  ctx.moveTo(hx + px * 4.5, hy + py * 4.5)
  ctx.lineTo(x, y)
  ctx.lineTo(hx - px * 4.5, hy - py * 4.5)
  ctx.stroke()
}

/**
 * The box while a zoom is being dragged: a dashed outline, and accent-colored arrows pointing in at the edges
 * that will become the new limits (-> <- for x, and the same top and bottom for y). A drag that zooms only one
 * way is drawn as just its two lines (vertical for x, horizontal for y), not a box; one too small to zoom is
 * only outlined. The outline is white on the dark plot and the text color on the light
 * one, so it always stands out from the page.
 */
function drawZoomBox(ctx, chart, geo, box) {
  const { plot } = geo
  const c = chart.colors
  const x0 = Math.min(box.x0, box.x1)
  const x1 = Math.max(box.x0, box.x1)
  const y0 = Math.min(box.y0, box.y1)
  const y1 = Math.max(box.y0, box.y1)
  const live = box.useX || box.useY
  const outline = chart.theme === 'Dark' ? '#ffffff' : c.font
  ctx.save()
  ctx.beginPath()
  ctx.rect(plot.x, plot.y, plot.w, plot.h)
  ctx.clip()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = outline
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  if (box.useX !== box.useY) {
    // zooming one way only: just the two lines that will become the new limits, across the whole plot
    if (box.useX) {
      ctx.moveTo(x0, plot.y)
      ctx.lineTo(x0, plot.y + plot.h)
      ctx.moveTo(x1, plot.y)
      ctx.lineTo(x1, plot.y + plot.h)
    } else {
      ctx.moveTo(plot.x, y0)
      ctx.lineTo(plot.x + plot.w, y0)
      ctx.moveTo(plot.x, y1)
      ctx.lineTo(plot.x + plot.w, y1)
    }
  } else ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 3)
  ctx.stroke()
  if (live) {
    ctx.setLineDash([])
    ctx.strokeStyle = c.accent
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const cx = box.useX ? (x0 + x1) / 2 : plot.x + plot.w / 2
    const cy = box.useY ? (y0 + y1) / 2 : plot.y + plot.h / 2
    if (box.useX) {
      arrow(ctx, x0 - 4, cy, [1, 0])
      arrow(ctx, x1 + 4, cy, [-1, 0])
    }
    if (box.useY) {
      arrow(ctx, cx, y0 - 4, [0, 1])
      arrow(ctx, cx, y1 + 4, [0, -1])
    }
  }
  ctx.restore()
}

/**
 * What changes as the mouse moves: the zoom box being dragged, or else the hover crosshair and readout.
 *
 * @param {{hover?: {x:number,y:number}|null, box?: {x0:number,y0:number,x1:number,y1:number,useX:boolean,useY:boolean}|null}} ui
 */
export function drawOverlay(ctx, chart, geo, ui, env) {
  if (!geo) return
  if (geo.matrix) return drawMatrixHover(ctx, env, chart, geo, ui.hover)
  if (ui.box) drawZoomBox(ctx, chart, geo, ui.box)
  else drawHover(ctx, env, chart, geo, ui.hover)
}

/** The whole picture in one go (for export and the theme fade); see drawBase and drawOverlay. */
export function drawChart(ctx, chart, w, h, view, ui, env) {
  const geo = drawBase(ctx, chart, w, h, view, env)
  drawOverlay(ctx, chart, geo, ui, env)
  return geo
}
