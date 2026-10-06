import { decimateIdx, finiteOnly, fmtCell, normalize, take } from './data'
import { applyFilter, estimateFs, FilterError } from './filters'
import { normalizeColor } from './color'
import { evaluateColumn } from './expression'
import { AXIS2_KINDS, CUSTOM, FILTER_KINDS, INDEX, NONE } from './types'

// Trace palettes. Dark: the accent blue plus the Tokyo-Night-style hues echotops already defines
// (--tn_orange, --tn_green, --tn_purple, --tn_cyan, ...). Light: the same hues pushed darker so every
// line keeps contrast against a white plot.
const COLORWAYS = {
  Dark: [
    '#7c98ff',
    '#f2a36f',
    '#a8cd76',
    '#b69bf1',
    '#55b6d4',
    '#ff8fab',
    '#e6c76b',
    '#9dd8fb',
    '#6fdcc0',
    '#c0c4d0',
  ],
  Light: [
    '#3f58c9',
    '#d9742c',
    '#5f9a2a',
    '#8a5fd0',
    '#1f8fb0',
    '#c24b72',
    '#a8902a',
    '#4f95c4',
    '#27a283',
    '#6b7186',
  ],
}

export const colorwayFor = (theme) => COLORWAYS[theme] ?? COLORWAYS.Dark

const stops = (colors) => colors.map((c, i) => [i / (colors.length - 1), c])
const SCALES = {
  Viridis: 'Viridis',
  Cividis: 'Cividis',
  RdBu: 'RdBu',
  Jet: 'Jet',
  Plasma: stops([
    '#0d0887',
    '#46039f',
    '#7201a8',
    '#9c179e',
    '#bd3786',
    '#d8576b',
    '#ed7953',
    '#fb9f3a',
    '#fdca26',
    '#f0f921',
  ]),
  Inferno: stops([
    '#000004',
    '#1b0c41',
    '#4a0c6b',
    '#781c6d',
    '#a52c60',
    '#cf4446',
    '#ed6925',
    '#fb9b06',
    '#f7d13d',
    '#fcffa4',
  ]),
  Magma: stops([
    '#000004',
    '#180f3d',
    '#440f76',
    '#721f81',
    '#9e2f7f',
    '#cd4071',
    '#f1605d',
    '#fd9567',
    '#fec98d',
    '#fcfdbf',
  ]),
  Turbo: stops([
    '#30123b',
    '#4662d7',
    '#36aaf9',
    '#1ae4b6',
    '#72fe5e',
    '#c7ef34',
    '#faba39',
    '#f66b19',
    '#ca2a04',
    '#7a0403',
  ]),
  Spectral: stops([
    '#9e0142',
    '#d53e4f',
    '#f46d43',
    '#fdae61',
    '#fee08b',
    '#e6f598',
    '#abdda4',
    '#66c2a5',
    '#3288bd',
    '#5e4fa2',
  ]),
}

const colorscale = (name) => SCALES[name] ?? 'Viridis'
// Plot chrome matches the page: the paper is the card color (--surface) so the plot sits flush in its card.
export const THEME_COLORS = {
  Dark: { paper: '#17181e', font: '#e6e7ec', muted: '#989aa5', grid: '#2a2c35', accent: '#7c98ff' },
  Light: { paper: '#ffffff', font: '#1b1d24', muted: '#5d6070', grid: '#e3e6ee', accent: '#3f58c9' },
}

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Timestamps stay as milliseconds since 1970; the canvas plot shows them as UTC, i.e. exactly what the file says.
const xOut = (xi, px) => (xi.kind === 'cat' ? Array.from(px, (v) => xi.labels[v]) : px)

// A trace's color is whatever the user picked for it, falling back to the palette slot it sits in.
export const colorOf = (o, slot) =>
  normalizeColor(o.traces[slot]?.color ?? '') ?? colorwayFor(o.theme)[slot % colorwayFor(o.theme).length]

const num = (s) => {
  const v = Number(s)
  return s.trim() !== '' && Number.isFinite(v) ? v : null
}

function xValues(table, name) {
  const col = table.cols[name]
  if (name === INDEX || !col)
    return { vals: Float64Array.from({ length: table.n }, (_, i) => i), kind: 'num' }
  if (col.kind === 'str') {
    const seen = new Map()
    const codes = new Float64Array(table.n)
    col.values.forEach((s, i) => {
      if (!seen.has(s)) seen.set(s, seen.size)
      codes[i] = seen.get(s)
    })
    return { vals: codes, kind: 'cat', labels: [...seen.keys()] }
  }
  return { vals: col.values, kind: col.kind }
}

// Whether any trace is switched off with its swatch (so "nothing to plot" can say why).
const anyHidden = (o) => o.traces.some((t) => t.hidden && t.col && t.col !== NONE)

const NOTHING = (o) =>
  anyHidden(o) && !o.traces.some((t) => !t.hidden && t.col && t.col !== NONE)
    ? 'All traces are hidden — click a color swatch in the sidebar to show one'
    : 'Add a trace and choose a numeric Y column'

function activeTraces(table, o, notes) {
  const good = []
  const bad = []
  o.traces.forEach((t, slot) => {
    if (t.hidden) return
    if (!t.col || t.col === NONE || !table.cols[t.col]) return
    if (table.cols[t.col].kind === 'num') good.push({ slot, col: t.col, side: t.side, name: t.name?.trim() || t.col })
    else bad.push(t.col)
  })
  if (bad.length) notes.push('skipped non-numeric: ' + [...new Set(bad)].join(', '))
  return good
}

const numCol = (table, name) => table.cols[name].values

function makeRange(lim, lo, hi, log) {
  const a = num(lim[0])
  const b = num(lim[1])
  if (a === null && b === null) return undefined
  const L = a ?? lo
  const H = b ?? hi
  if (log) return L > 0 && H > 0 ? [Math.log10(L), Math.log10(H)] : undefined
  return [L, H]
}

/** Zoom/pan survives filter, theme and style tweaks, but resets when the plot's structure changes. */
function revisionKey(o, tableName) {
  return [
    tableName,
    o.kind,
    o.x === CUSTOM ? `ƒ${o.xExpr}` : o.x,
    o.logx,
    o.logy,
    o.norm,
    o.xlim.join(),
    o.ylim.join(),
    o.traces.map((t) => `${t.col === CUSTOM ? 'ƒ' + t.expr : t.col}@${t.side}`).join(),
  ].join('|')
}

function baseLayout(o, tableName) {
  const t = THEME_COLORS[o.theme]
  const axis = { showgrid: o.grid, gridcolor: t.grid, zeroline: false, linecolor: t.grid, automargin: true }
  // A dotted vertical crosshair that follows the cursor across the plot, next to the unified hover readout.
  const spikes = {
    showspikes: true,
    spikemode: 'across',
    spikethickness: 1,
    spikedash: 'dot',
    spikecolor: t.muted,
  }
  return {
    title: {
      text: o.title || tableName,
      x: 0.01,
      xanchor: 'left',
      y: 0.98,
      yanchor: 'top',
      font: { size: 15 },
    },
    paper_bgcolor: t.paper,
    plot_bgcolor: t.paper,
    hoverlabel: { bgcolor: t.paper, bordercolor: t.grid, font: { color: t.font } },
    modebar: { bgcolor: 'rgba(0,0,0,0)', color: t.muted, activecolor: t.accent },
    font: { color: t.font, size: 12 },
    colorway: colorwayFor(o.theme),
    margin: { l: 60, r: 30, t: 48, b: 56 },
    // Inside the plot, top right, on a translucent card: a long list of traces never pushes the title or
    // squeezes the plot, and it still appears in exported PNGs.
    legend: {
      orientation: 'v',
      x: 0.99,
      y: 0.99,
      xanchor: 'right',
      yanchor: 'top',
      bgcolor: rgba(t.paper, 0.75),
      bordercolor: t.grid,
      borderwidth: 1,
    },
    showlegend: o.legend,
    xaxis: { ...axis, ...spikes },
    yaxis: { ...axis },
    hovermode: 'x unified',
    uirevision: revisionKey(o, tableName),
  }
}

function applyAxes(layout, o, x, xlabel, ylabel, ext) {
  const xa = layout.xaxis
  const ya = layout.yaxis
  xa.title = { text: o.xlabel || xlabel }
  ya.title = { text: o.ylabel || ylabel }
  if (x?.kind === 'time') xa.type = 'date'
  else if (x?.kind === 'cat') {
    xa.type = 'category'
    xa.categoryorder = 'array'
    xa.categoryarray = x.labels
    xa.tickangle = -45
  } else if (o.logx) xa.type = 'log'
  if (o.logy) ya.type = 'log'
  if (!x || x.kind === 'num') {
    const r = makeRange(o.xlim, ext.xmin, ext.xmax, o.logx)
    if (r) xa.range = r
  }
  const r = makeRange(o.ylim, ext.ymin, ext.ymax, o.logy)
  if (r) ya.range = r
}

const newExtent = () => ({ xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity })

function grow(ext, x, y) {
  for (let i = 0; i < x.length; i++) {
    if (x[i] < ext.xmin) ext.xmin = x[i]
    if (x[i] > ext.xmax) ext.xmax = x[i]
  }
  for (let i = 0; i < y.length; i++) {
    if (y[i] < ext.ymin) ext.ymin = y[i]
    if (y[i] > ext.ymax) ext.ymax = y[i]
  }
}

const empty = (message) => ({ data: [], layout: {}, notes: [], message })

function buildXY(table, o, notes) {
  const series = activeTraces(table, o, notes)
  if (!series.length) return empty(NOTHING(o))
  const xi = xValues(table, o.x)
  const useRight = AXIS2_KINDS.includes(o.kind) && new Set(series.map((s) => s.side)).size === 2
  const filtering = o.filter !== 'None' && FILTER_KINDS.includes(o.kind)
  const colorCol =
    o.kind === 'Scatter' && table.cols[o.colorBy]?.kind === 'num' ? numCol(table, o.colorBy) : null
  let cmin = Infinity
  let cmax = -Infinity
  if (colorCol) {
    for (const v of colorCol) {
      if (!Number.isFinite(v)) continue
      cmin = Math.min(cmin, v)
      cmax = Math.max(cmax, v)
    }
  }
  const data = []
  const leftCols = []
  const rightCols = []
  const ext = newExtent()
  for (const { slot, col, side, name } of series) {
    const right = useRight && side === 'R'
    ;(right ? rightCols : leftCols).push(col)
    const color = colorOf(o, slot)
    const y = numCol(table, col)
    const keep = []
    for (let i = 0; i < table.n; i++) {
      if (Number.isFinite(xi.vals[i]) && Number.isFinite(y[i]) && (!colorCol || Number.isFinite(colorCol[i])))
        keep.push(i)
    }
    if (!keep.length) {
      notes.push(`${col}: no valid points`)
      continue
    }
    const x = Float64Array.from(keep, (i) => xi.vals[i])
    const yy = normalize(
      Float64Array.from(keep, (i) => y[i]),
      o.norm,
    )
    const label = name + (right ? ' (right)' : '')
    let ys = yy
    if (filtering) {
      try {
        const res = applyFilter(yy, o.filter, o.fp1, o.fp2, estimateFs(x, xi.kind))
        ys = res.y
        if (res.info) notes.push(`${col}: ${res.info}`)
      } catch (e) {
        if (!(e instanceof FilterError)) throw e
        notes.push(`${col}: filter skipped (${e.message})`)
      }
    }
    const pts = decimateIdx(x.length, o.maxPts, o.kind === 'Scatter' ? undefined : ys)
    if (pts)
      notes.push(`${col}: downsampled ${x.length.toLocaleString()} -> ${pts.length.toLocaleString()} points`)
    const px = take(x, pts)
    const py = take(ys, pts)
    grow(ext, x, ys)
    const xs = xOut(xi, px)
    const gl = px.length > 2500 ? 'scattergl' : 'scatter'
    const axis = right ? 'y2' : 'y'
    if (o.kind === 'Scatter') {
      data.push({
        type: 'scattergl',
        mode: 'markers',
        x: xs,
        y: py,
        name: label,
        yaxis: axis,
        marker: {
          size: o.ms * 1.6,
          opacity: o.alpha,
          ...(colorCol
            ? {
                color: take(
                  Float64Array.from(keep, (i) => colorCol[i]),
                  pts,
                ),
                colorscale: colorscale(o.cmap),
                cmin,
                cmax,
                showscale: data.length === 0,
                colorbar: { title: { text: o.colorBy } },
              }
            : { color }),
        },
      })
      continue
    }
    if (filtering && o.showRaw && ys !== yy) {
      const rp = decimateIdx(x.length, o.maxPts, yy)
      const rx = take(x, rp)
      data.push({
        type: gl,
        mode: 'lines',
        x: xOut(xi, rx),
        y: take(yy, rp),
        yaxis: axis,
        showlegend: false,
        hoverinfo: 'skip',
        opacity: 0.25,
        line: { color, width: o.lw * 0.8 },
      })
    }
    data.push({
      type: gl,
      x: xs,
      y: py,
      name: label,
      yaxis: axis,
      opacity: o.alpha,
      mode: o.kind === 'Line + markers' ? 'lines+markers' : 'lines',
      line: { color, width: o.lw, shape: o.kind === 'Step' ? 'hv' : 'linear' },
      marker: { size: o.ms * 1.4, color },
      ...(o.kind === 'Area' ? { fill: 'tozeroy', fillcolor: rgba(color, o.alpha * 0.35) } : {}),
    })
  }
  if (!data.length) return { ...empty('No valid points to plot'), notes }
  const suffix = o.norm === 'None' ? '' : ` [${o.norm}]`
  const layout = baseLayout(o, table.name)
  applyAxes(
    layout,
    o,
    xi,
    o.x !== INDEX ? o.x : 'row index',
    leftCols.length ? (leftCols.length === 1 ? leftCols[0] : 'value') + suffix : '',
    ext,
  )
  if (useRight) {
    layout.yaxis2 = {
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      zeroline: false,
      automargin: true,
      title: { text: rightCols.join(', ') + suffix },
      type: o.logy ? 'log' : 'linear',
    }
  }
  if (colorCol) layout.showlegend = false
  return { data, layout, notes }
}

function buildBar(table, o, notes) {
  const series = activeTraces(table, o, notes)
  if (!series.length) return empty(NOTHING(o))
  const xi = xValues(table, o.x)
  let labels
  let heights
  if (xi.kind === 'cat') {
    notes.push('bar: mean of each Y per category')
    const k = xi.labels.length
    labels = xi.labels
    heights = series.map(({ col }) => {
      const y = numCol(table, col)
      const sum = new Float64Array(k)
      const cnt = new Float64Array(k)
      for (let i = 0; i < table.n; i++) {
        if (!Number.isFinite(y[i])) continue
        sum[xi.vals[i]] += y[i]
        cnt[xi.vals[i]]++
      }
      return sum.map((s, j) => (cnt[j] ? s / cnt[j] : 0))
    })
  } else {
    const n = Math.min(table.n, 300)
    if (table.n > 300) notes.push('bar chart limited to first 300 rows')
    const col = table.cols[o.x]
    labels = Array.from({ length: n }, (_, i) => (o.x === INDEX || !col ? String(i) : fmtCell(col, i)))
    heights = series.map(({ col }) =>
      numCol(table, col)
        .slice(0, n)
        .map((v) => (Number.isFinite(v) ? v : 0)),
    )
  }
  const pos = labels.map((_, i) => i)
  const step = Math.max(1, Math.ceil(labels.length / 30))
  const data = series.map(({ slot, name }, j) => ({
    type: 'bar',
    x: pos,
    y: normalize(heights[j], o.norm),
    name,
    opacity: o.alpha,
    marker: { color: colorOf(o, slot) },
  }))
  const layout = baseLayout(o, table.name)
  applyAxes(
    layout,
    o,
    null,
    o.x !== INDEX ? o.x : 'row index',
    series.length === 1 ? series[0].col : 'value',
    newExtent(),
  )
  Object.assign(layout.xaxis, {
    tickmode: 'array',
    tickvals: pos.filter((i) => i % step === 0),
    ticktext: labels.filter((_, i) => i % step === 0),
    tickangle: -45,
  })
  layout.barmode = 'group'
  return { data, layout, notes }
}

const thin = (a, max, notes, what) => {
  const idx = decimateIdx(a.length, max)
  if (idx) notes.push(`${what}: subsampled to ${max.toLocaleString()} points`)
  return take(a, idx)
}

function buildDist(table, o, notes) {
  const series = activeTraces(table, o, notes)
  if (!series.length) return empty(NOTHING(o))
  const prepared = series
    .map((s) => ({ ...s, vals: normalize(finiteOnly(numCol(table, s.col)), o.norm) }))
    .filter((s) => s.vals.length)
  if (!prepared.length) return empty('Selected columns have no valid values')
  const layout = baseLayout(o, table.name)
  const data = []
  let xlabel = 'value'
  let ylabel = ''
  const ext = newExtent()
  if (o.kind === 'Histogram') {
    let lo = Infinity
    let hi = -Infinity
    for (const s of prepared) {
      for (let i = 0; i < s.vals.length; i++) {
        lo = Math.min(lo, s.vals[i])
        hi = Math.max(hi, s.vals[i])
      }
    }
    const bins = Math.max(2, Math.round(o.bins))
    const size = hi > lo ? (hi - lo) / bins : 1
    for (const s of prepared) {
      const counts = new Float64Array(bins)
      for (let i = 0; i < s.vals.length; i++)
        counts[Math.min(bins - 1, Math.floor((s.vals[i] - lo) / size))]++
      const y = o.density ? counts.map((c) => c / (s.vals.length * size)) : counts
      data.push({
        type: 'bar',
        name: s.name,
        x: Array.from(y, (_, b) => lo + (b + 0.5) * size),
        y,
        width: size,
        opacity: prepared.length === 1 ? o.alpha : Math.min(o.alpha, 0.55),
        marker: { color: colorOf(o, s.slot) },
      })
    }
    layout.barmode = 'overlay'
    ylabel = o.density ? 'density' : 'count'
    ext.xmin = lo
    ext.xmax = hi
  } else if (o.kind === 'Box' || o.kind === 'Violin') {
    const cap = o.kind === 'Box' ? 50000 : 20000
    for (const s of prepared) {
      const v = thin(s.vals, cap, notes, `${s.col}`)
      const color = colorOf(o, s.slot)
      data.push(
        o.kind === 'Box'
          ? {
              type: 'box',
              y: v,
              name: s.name,
              boxpoints: v.length <= 20000 ? 'outliers' : false,
              marker: { color, size: 3 },
              line: { color },
            }
          : {
              type: 'violin',
              y: v,
              name: s.name,
              points: false,
              meanline: { visible: true },
              line: { color },
              fillcolor: rgba(color, 0.4),
            },
      )
    }
    xlabel = ''
    layout.hovermode = 'closest'
  } else {
    for (const s of prepared) {
      const sorted = Float64Array.from(s.vals).sort()
      const idx = decimateIdx(sorted.length, o.maxPts)
      const ys = Float64Array.from({ length: sorted.length }, (_, i) => (i + 1) / sorted.length)
      data.push({
        type: 'scattergl',
        mode: 'lines',
        x: take(sorted, idx),
        y: take(ys, idx),
        name: s.name,
        line: { shape: 'hv', color: colorOf(o, s.slot), width: o.lw },
      })
    }
    ylabel = 'cumulative fraction'
  }
  applyAxes(layout, o, null, xlabel, ylabel, ext)
  if (o.kind === 'Box' || o.kind === 'Violin') {
    const horiz = layout
    horiz.yaxis = {
      ...layout.yaxis,
      title: { text: o.ylabel || (prepared.length === 1 ? prepared[0].col : 'value') },
    }
    horiz.showlegend = false
  }
  return { data, layout, notes }
}

function histogram2d(table, o, notes) {
  const series = activeTraces(table, o, notes)
  if (!series.length) return empty(NOTHING(o))
  const xi = xValues(table, o.x)
  if (xi.kind !== 'num') return empty('2D histogram needs a numeric X column')
  const y = numCol(table, series[0].col)
  const px = []
  const py = []
  let xlo = Infinity,
    xhi = -Infinity,
    ylo = Infinity,
    yhi = -Infinity
  for (let i = 0; i < table.n; i++) {
    if (!Number.isFinite(xi.vals[i]) || !Number.isFinite(y[i])) continue
    px.push(xi.vals[i])
    py.push(y[i])
    xlo = Math.min(xlo, xi.vals[i])
    xhi = Math.max(xhi, xi.vals[i])
    ylo = Math.min(ylo, y[i])
    yhi = Math.max(yhi, y[i])
  }
  if (!px.length) return empty('No valid points')
  const b = Math.max(2, Math.round(o.bins))
  const xs = xhi > xlo ? (xhi - xlo) / b : 1
  const ys = yhi > ylo ? (yhi - ylo) / b : 1
  const z = Array.from({ length: b }, () => new Array(b).fill(null))
  for (let i = 0; i < px.length; i++) {
    const cx = Math.min(b - 1, Math.floor((px[i] - xlo) / xs))
    const cy = Math.min(b - 1, Math.floor((py[i] - ylo) / ys))
    z[cy][cx] = (z[cy][cx] ?? 0) + 1
  }
  const layout = baseLayout(o, table.name)
  applyAxes(layout, o, xi, o.x !== INDEX ? o.x : 'row index', series[0].col, newExtent())
  layout.showlegend = false
  layout.hovermode = 'closest'
  return {
    data: [
      {
        type: 'heatmap',
        z,
        x: Array.from({ length: b }, (_, i) => xlo + (i + 0.5) * xs),
        y: Array.from({ length: b }, (_, i) => ylo + (i + 0.5) * ys),
        colorscale: colorscale(o.cmap),
        colorbar: { title: { text: 'count' } },
        hoverongaps: false,
      },
    ],
    layout,
    notes,
  }
}

function matrixColumns(table, o, notes, fallback) {
  const cols = [...new Set(activeTraces(table, o, notes).map((s) => s.col))]
  return cols.length ? cols : table.names.filter((c) => table.cols[c].kind === 'num').slice(0, fallback)
}

export function pairCorr(arrs) {
  return arrs
    .map((a, i) =>
      arrs.map((b, j) => {
        if (j < i) return null
        let n = 0,
          sa = 0,
          sb = 0
        for (let k = 0; k < a.length; k++) {
          if (!Number.isFinite(a[k]) || !Number.isFinite(b[k])) continue
          n++
          sa += a[k]
          sb += b[k]
        }
        if (n < 3) return null
        const ma = sa / n,
          mb = sb / n
        let cov = 0,
          va = 0,
          vb = 0
        for (let k = 0; k < a.length; k++) {
          if (!Number.isFinite(a[k]) || !Number.isFinite(b[k])) continue
          cov += (a[k] - ma) * (b[k] - mb)
          va += (a[k] - ma) ** 2
          vb += (b[k] - mb) ** 2
        }
        return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null
      }),
    )
    .map((row, i, m) => row.map((v, j) => (j < i ? m[j][i] : v)))
}

function buildCorr(table, o, notes) {
  let cols = matrixColumns(table, o, notes, 40)
  if (cols.length < 2) return empty('Need at least two numeric columns')
  if (cols.length > 40) cols = cols.slice(0, 40)
  const z = pairCorr(cols.map((c) => numCol(table, c)))
  const layout = baseLayout(o, table.name)
  applyAxes(layout, o, null, '', '', newExtent())
  Object.assign(layout.yaxis, { autorange: 'reversed', title: { text: '' } })
  Object.assign(layout.xaxis, { tickangle: -45, title: { text: '' } })
  layout.showlegend = false
  layout.hovermode = 'closest'
  return {
    data: [
      {
        type: 'heatmap',
        z,
        x: cols,
        y: cols,
        zmin: -1,
        zmax: 1,
        colorscale: 'RdBu',
        colorbar: { title: { text: 'correlation' } },
        xgap: 1,
        ygap: 1,
        ...(cols.length <= 12 ? { texttemplate: '%{z:.2f}', textfont: { size: 11 } } : {}),
      },
    ],
    layout,
    notes,
  }
}

function buildMatrix(table, o, notes) {
  let cols = matrixColumns(table, o, notes, 4)
  if (cols.length < 2) return empty('Need at least two numeric columns')
  if (cols.length > 6) {
    notes.push('showing first 6 columns')
    cols = cols.slice(0, 6)
  }
  const arrs = cols.map((c) => numCol(table, c))
  const rows = []
  for (let i = 0; i < table.n; i++) if (arrs.every((a) => Number.isFinite(a[i]))) rows.push(i)
  const idx = decimateIdx(rows.length, 4000)
  const pick = Int32Array.from(idx ? Array.from(idx, (k) => rows[k]) : rows)
  const layout = baseLayout(o, table.name)
  layout.showlegend = false
  layout.hovermode = 'closest'
  layout.dragmode = 'select'
  return {
    data: [
      {
        type: 'splom',
        diagonal: { visible: false },
        dimensions: cols.map((c, k) => ({ label: c, values: take(arrs[k], pick) })),
        marker: {
          size: Math.max(o.ms, 2),
          opacity: o.alpha * 0.6,
          color: colorOf(
            o,
            Math.max(
              0,
              o.traces.findIndex((t) => t.col && t.col !== NONE),
            ),
          ),
        },
      },
    ],
    layout,
    notes,
  }
}

/**
 * Turn the formula X axis / formula traces into ordinary derived columns. Each formula's column is named
 * after its own text, so legends and axis titles read "chamber_psi - tank_psi" with no extra plumbing, and
 * every plot type downstream just sees another numeric column. A formula that fails (typo, unknown column)
 * becomes a note and its trace is dropped; a failed X formula falls back to the row index.
 *
 * @returns {{ table: object, opts: object }} The table with derived columns added, and opts pointing at them
 */
function resolveFormulas(table, o, notes) {
  const usesFormula = o.x === CUSTOM || o.traces.some((t) => t.col === CUSTOM)
  if (!usesFormula) return { table, opts: o }

  const derived = { ...table, names: [...table.names], cols: { ...table.cols } }

  const resolve = (expr, what) => {
    const text = expr.trim()
    if (!text) return null
    try {
      const values = evaluateColumn(table, text)
      if (!derived.cols[text]) {
        derived.names.push(text)
        derived.cols[text] = { kind: 'num', values }
      }
      return text
    } catch (error) {
      notes.push(`${what} formula: ${error.message}`)
      return null
    }
  }

  const x = o.x === CUSTOM ? (resolve(o.xExpr, 'X') ?? INDEX) : o.x
  const traces = o.traces.map((t) =>
    t.col === CUSTOM && !t.hidden ? { ...t, col: resolve(t.expr, 'Trace') ?? NONE } : t,
  )

  return { table: derived, opts: { ...o, x, traces } }
}

export function buildFigure(rawTable, rawOpts) {
  if (!rawTable) return empty('Choose a CSV file from the drop-down above')
  const notes = []
  const { table, opts: o } = resolveFormulas(rawTable, rawOpts, notes)
  let fig
  if (o.kind === 'Bar') fig = buildBar(table, o, notes)
  else if (['Line', 'Scatter', 'Line + markers', 'Step', 'Area'].includes(o.kind))
    fig = buildXY(table, o, notes)
  else if (['Histogram', 'Box', 'Violin', 'ECDF'].includes(o.kind)) fig = buildDist(table, o, notes)
  else if (o.kind === '2D histogram') fig = histogram2d(table, o, notes)
  else if (o.kind === 'Correlation heatmap') fig = buildCorr(table, o, notes)
  else fig = buildMatrix(table, o, notes)
  // A trace that only failed because of its formula should say so, not just "add a trace".
  const formulaError = notes.find((n) => /^Trace formula:/.test(n)) ?? notes.find((n) => /formula:/.test(n))
  if (fig.message && formulaError) fig.message = formulaError

  return { ...fig, notes, kind: o.kind, theme: o.theme }
}
