import { describe, expect, it } from 'vitest'
import { parseCsv } from '../lib/csv'
import { buildFigure } from '../lib/plots'
import { DEFAULT_OPTS, NONE } from '../lib/types'
import { autoRange, makeScale, panRange, subRange, zoomRange } from './axis'
import { chartFromFigure } from './chart'
import { sampleScale, scaleTable } from './colormap'
import { cssEase } from './ease'
import { sameView, ViewHistory } from './history'
import { findHover, isAscending, lowerBound, nearestIndex } from './hover'
import { splitRuns } from './math'
import { boxStats, density } from './stats'
import { formatLinear, linearTicks, logTicks, niceStep, timeTicks } from './ticks'

describe('linear ticks', () => {
  it('uses 1-2-5 steps', () => {
    expect(niceStep(100, 5)).toBe(20)
    expect(niceStep(1, 5)).toBe(0.2)
    expect(niceStep(7, 5)).toBe(1)
    expect(niceStep(300, 6)).toBe(50)
  })
  it('lists ticks inside the range without float noise', () => {
    const { vals, step } = linearTicks(0.05, 0.95, 5)
    expect(step).toBe(0.2)
    expect(vals).toEqual([0.2, 0.4, 0.6, 0.8])
    expect(linearTicks(5, 5).vals).toEqual([])
  })
  it('labels with the right number of decimals, k/M suffixes and no negative zero', () => {
    expect(formatLinear([0, 0.5, 1], 0.5)).toEqual(['0.0', '0.5', '1.0'])
    expect(formatLinear([-2, 0, 2], 2)).toEqual(['-2', '0', '2'])
    expect(formatLinear([0, 20000, 40000], 20000)).toEqual(['0', '20k', '40k'])
    expect(formatLinear([1e6, 2.5e6], 5e5)).toEqual(['1M', '2.5M'])
    expect(formatLinear([1e-5, 2e-5], 1e-5)).toEqual(['1e-5', '2e-5'])
    expect(formatLinear([-1e-12, 1], 1)[0]).toBe('0')
  })
})

describe('log ticks', () => {
  it('uses decades over a wide range and 1/2/5 over a narrow one', () => {
    expect(logTicks(1, 1e5).vals).toEqual([1, 10, 100, 1000, 10000, 100000])
    expect(logTicks(1, 30).vals).toEqual([1, 2, 5, 10, 20])
    expect(logTicks(1.5, 4).vals).toEqual([2, 3, 4])
  })
  it('labels large and small values with exponents', () => {
    expect(logTicks(1, 1e6).labels.slice(-2)).toEqual(['1e5', '1e6'])
    expect(logTicks(1, 1e7).vals).toEqual([1, 100, 1e4, 1e6]) // every other decade once there are too many
    expect(logTicks(1e-6, 1).labels[0]).toBe('1e-6')
  })
  it('refuses non-positive ranges', () => {
    expect(logTicks(0, 10).vals).toEqual([])
  })
})

describe('time ticks', () => {
  const t0 = Date.UTC(2026, 9, 3, 14, 0, 0)
  it('labels seconds with the clock and the date on the first tick', () => {
    const { vals, labels } = timeTicks(t0, t0 + 60000, 6)
    expect(vals[0]).toBe(t0)
    expect(labels[0]).toBe('14:00:00\n2026-10-03')
    expect(labels[1]).toBe('14:00:10')
    expect(labels.every((l, i) => i === 0 || !l.includes('\n'))).toBe(true)
  })
  it('does not jump to a step that leaves almost no ticks', () => {
    // 6.7 minutes with room for about 4 ticks: 2-minute steps (3-4 ticks), not 5-minute ones (1)
    const span = 400 * 1000
    const { vals } = timeTicks(Date.UTC(2026, 9, 3, 23, 58), Date.UTC(2026, 9, 3, 23, 58) + span, 4)
    expect(vals.length).toBeGreaterThanOrEqual(3)
  })
  it('shows the date again when the day rolls over', () => {
    const { labels } = timeTicks(Date.UTC(2026, 9, 3, 18), Date.UTC(2026, 9, 4, 6), 6)
    expect(labels.filter((l) => l.includes('\n')).map((l) => l.split('\n')[1])).toEqual([
      '2026-10-03',
      '2026-10-04',
    ])
  })
  it('uses milliseconds for tiny spans and dates, months and years for large ones', () => {
    expect(timeTicks(t0, t0 + 20, 6).labels[1]).toMatch(/^14:00:00\.\d{3}/)
    expect(timeTicks(t0, t0 + 20 * 86400000, 6).labels[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(timeTicks(t0, t0 + 200 * 86400000, 6).labels[0]).toMatch(/^\d{4}-\d{2}$/)
    expect(timeTicks(t0, t0 + 5 * 365 * 86400000, 6).labels).toEqual(['2027', '2028', '2029', '2030', '2031'])
  })
})

describe('axis math', () => {
  it('maps values to pixels and back, linear and log', () => {
    const lin = makeScale('linear', 0, 10, 100, 200)
    expect(lin.px(5)).toBe(150)
    expect(lin.val(150)).toBe(5)
    const log = makeScale('log', 1, 1000, 0, 300)
    expect(log.px(10)).toBeCloseTo(100, 9)
    expect(log.val(200)).toBeCloseTo(100, 9)
    const flipped = makeScale('linear', 0, 1, 400, 0) // y axes run bottom to top
    expect(flipped.px(1)).toBe(0)
  })
  it('zooms about a point and keeps that point fixed', () => {
    const r = zoomRange('linear', [0, 100], 0.5, 0.25)
    expect(r).toEqual([12.5, 62.5])
    const [lo, hi] = zoomRange('log', [1, 1e4], 0.5, 0.5)
    expect(lo).toBeCloseTo(10, 9)
    expect(hi).toBeCloseTo(1000, 6)
  })
  it('refuses to zoom into floating-point noise', () => {
    expect(zoomRange('linear', [1, 1 + 1e-14], 0.5, 0.5)).toEqual([1, 1 + 1e-14])
  })
  it('pans and picks sub-ranges', () => {
    expect(panRange('linear', [0, 10], 0.5)).toEqual([5, 15])
    expect(subRange('linear', [0, 10], 0.8, 0.2)).toEqual([2, 8])
  })
  it('fits data with padding and survives flat or missing data', () => {
    expect(autoRange('linear', 0, 10, 0.05)).toEqual([-0.5, 10.5])
    expect(autoRange('linear', 3, 3)).toEqual([1.5, 4.5])
    expect(autoRange('linear', 0, 0)).toEqual([-0.5, 0.5])
    expect(autoRange('linear', NaN, NaN)).toEqual([0, 1])
    expect(autoRange('log', 10, 10)[0]).toBeLessThan(10)
  })
})

describe('colormap', () => {
  it('interpolates stops and clamps', () => {
    expect(sampleScale('Viridis', 0)).toBe('rgb(68, 1, 84)')
    expect(sampleScale('Viridis', 1)).toBe('rgb(253, 231, 37)')
    expect(sampleScale('Viridis', -5)).toBe(sampleScale('Viridis', 0))
    expect(sampleScale([[0, '#000000'], [1, '#ffffff']], 0.5)).toBe('rgb(128, 128, 128)')
    expect(sampleScale('nonsense', 0)).toBe(sampleScale('Viridis', 0))
    expect(scaleTable('Jet', 16)).toHaveLength(16)
  })
})

describe('hover search', () => {
  const xs = Float64Array.from([0, 1, 2, 4, 8])
  it('finds the nearest index, sorted or not', () => {
    expect(lowerBound(xs, 3)).toBe(3)
    expect(nearestIndex(xs, 3.1, true)).toBe(3)
    expect(nearestIndex(xs, 2.9, true)).toBe(2)
    expect(nearestIndex(xs, 3.1, true)).toBe(3)
    expect(nearestIndex(xs, -10, true)).toBe(0)
    expect(nearestIndex(xs, 100, true)).toBe(4)
    expect(nearestIndex(Float64Array.from([5, 1, 9]), 8, false)).toBe(2)
    expect(nearestIndex([], 1, true)).toBe(-1)
    expect(isAscending(xs)).toBe(true)
    expect(isAscending(Float64Array.from([1, 0]))).toBe(false)
  })
  it('gives each visible series its point nearest the closest x', () => {
    const a = { inLegend: true, x: Float64Array.from([0, 1, 2]), y: Float64Array.from([5, 6, 7]), sorted: true }
    const b = { inLegend: true, x: Float64Array.from([0.9, 2.1]), y: Float64Array.from([1, 2]), sorted: true }
    const ghost = { inLegend: false, x: Float64Array.from([1.5]), y: Float64Array.from([0]), sorted: true }
    const scale = makeScale('linear', 0, 2, 0, 200)
    const h = findHover([a, b, ghost], scale, 92)
    expect(h.x).toBe(0.9)
    expect(h.rows.map((r) => r.i)).toEqual([1, 0])
    expect(findHover([], scale, 10)).toBeNull()
  })
})

describe('chartFromFigure', () => {
  const rows = ['t,a,b,label']
  for (let i = 0; i < 200; i++) rows.push(`${i / 10},${Math.sin(i / 10)},${i * 2},${i % 2 ? 'odd' : 'even'}`)
  const table = parseCsv(rows.join('\n'), 'demo.csv')
  const tr = (col, side = 'L') => ({ col, side })
  const make = (o) => chartFromFigure(buildFigure(table, { ...DEFAULT_OPTS, ...o }))

  it('turns a line plot into series with typed arrays, colors and axis titles', () => {
    const c = make({ x: 't', traces: [tr('a'), tr('b', 'R')] })
    expect(c.series).toHaveLength(2)
    expect(c.series[0].x).toBeInstanceOf(Float64Array)
    expect(c.series.map((s) => s.axis)).toEqual(['y', 'y2'])
    expect(c.series[0].color).toMatch(/^#/)
    expect(c.y.title).toBe('a')
    expect(c.y2.title).toBe('b')
    expect(c.x.title).toBe('t')
    expect(c.series[0].sorted).toBe(true)
  })
  it('puts everything on the left axis when no trace is on the right', () => {
    const c = make({ x: 't', traces: [tr('a', 'R')] })
    expect(c.y2).toBeNull()
    expect(c.series[0].axis).toBe('y')
  })
  it('marks the faint raw trace of a filtered line as a ghost outside the legend', () => {
    const c = make({ x: 't', traces: [tr('b')], filter: 'Median', fp1: 5, showRaw: true })
    expect(c.series.map((s) => s.ghost)).toEqual([true, false])
    expect(c.series.map((s) => s.inLegend)).toEqual([false, true])
  })
  it('reads style: markers, steps, area fill', () => {
    expect(make({ x: 't', kind: 'Scatter', traces: [tr('a')] }).series[0].mode).toBe('markers')
    expect(make({ x: 't', kind: 'Line + markers', traces: [tr('a')] }).series[0].mode).toBe('lines+markers')
    expect(make({ x: 't', kind: 'Step', traces: [tr('a')] }).series[0].step).toBe(true)
    expect(make({ x: 't', kind: 'Area', traces: [tr('a')] }).series[0].fill).toMatch(/^rgba/)
  })
  it('keeps the color-by values and a color bar for a colored scatter', () => {
    const c = make({ x: 't', kind: 'Scatter', traces: [tr('a')], colorBy: 'b' })
    expect(c.series[0].colors.values).toBeInstanceOf(Float64Array)
    expect(c.colorbar.title).toBe('b')
    expect(c.legend).toBe(false)
  })
  it('converts log limits back to data units', () => {
    const c = make({ x: 't', traces: [tr('b')], logy: true, ylim: ['10', '1000'] })
    expect(c.y.type).toBe('log')
    expect(c.y.range[0]).toBeCloseTo(10, 9)
    expect(c.y.range[1]).toBeCloseTo(1000, 6)
    expect(make({ x: 't', traces: [tr('a')] }).y.range).toBeNull()
  })
  it('maps a text X column to category positions with labelled ticks', () => {
    const c = make({ x: 'label', traces: [tr('a')] })
    expect(c.x.type).toBe('category')
    expect(Array.from(new Set(c.series[0].x)).sort()).toEqual([0, 1])
    expect(c.x.ticks.labels).toEqual(['even', 'odd'])
    expect(c.x.pad).toBe(0.5)
  })
  it('numbers the bar series so they can sit side by side', () => {
    const c = make({ kind: 'Bar', x: 'label', traces: [tr('a'), tr('b')] })
    expect(c.series.map((s) => [s.mode, s.slot, s.slots])).toEqual([
      ['bars', 0, 2],
      ['bars', 1, 2],
    ])
  })
  it('time axes stay in milliseconds', () => {
    const t = parseCsv('when,v\n2026-10-03 14:00:00,1\n2026-10-03 14:00:01,2', 'time.csv')
    const c = chartFromFigure(buildFigure(t, { ...DEFAULT_OPTS, x: 'when', traces: [tr('v')] }))
    expect(c.x.type).toBe('time')
    expect(c.series[0].x[1] - c.series[0].x[0]).toBe(1000)
    expect(NONE).toBeTruthy()
  })
  it('carries the zoom revision and theme', () => {
    const a = make({ x: 't', traces: [tr('a')] })
    expect(a.revision).toBe(make({ x: 't', traces: [tr('a')], lw: 3 }).revision)
    expect(a.revision).not.toBe(make({ x: 't', traces: [tr('b')] }).revision)
    expect(make({ x: 't', traces: [tr('a')], theme: 'Light' }).colors.paper).toBe('#ffffff')
  })
})

describe('label runs', () => {
  it('typesets only the $...$ parts', () => {
    expect(splitRuns('abcde $3 + 2$')).toEqual([{ text: 'abcde ' }, { tex: '3 + 2' }])
    expect(splitRuns('Velocity ($\\frac{m}{s}$) now')).toEqual([
      { text: 'Velocity (' },
      { tex: '\\frac{m}{s}' },
      { text: ') now' },
    ])
    expect(splitRuns('$a$$b$')).toEqual([{ tex: 'a' }, { tex: 'b' }])
  })
  it('leaves ordinary labels, lone dollar signs and empty text alone', () => {
    expect(splitRuns('thrust (N)')).toEqual([{ text: 'thrust (N)' }])
    expect(splitRuns('Cost: 5$')).toEqual([{ text: 'Cost: 5$' }])
    expect(splitRuns('')).toEqual([])
  })
  it('keeps words in the normal font unless they are inside the math', () => {
    expect(splitRuns('$\\text{texthere}$')).toEqual([{ tex: '\\text{texthere}' }])
  })
})

describe('css ease', () => {
  it('matches the browser curve: front-loaded, 0 to 1', () => {
    expect(cssEase(0)).toBe(0)
    expect(cssEase(1)).toBe(1)
    expect(cssEase(0.5)).toBeCloseTo(0.8024, 3)
    expect(cssEase(0.1)).toBeGreaterThan(0.09)
  })
})

describe('view history', () => {
  const original = {}
  const panLeft = { x: [-1, 9] }
  const zoomIn = { x: [2, 6], y: [0, 10] }
  const panUp = { x: [2, 6], y: [5, 15] }

  it('steps back and forward through views', () => {
    const h = new ViewHistory(original)
    h.record(panLeft)
    expect(h.back()).toBe(original)
    expect(h.forward()).toBe(panLeft)
    expect(h.back()).toBe(original)
    expect(h.back()).toBeNull()
    expect(h.canBack).toBe(false)
  })

  it('overwrites what was ahead when a new view is recorded after stepping back', () => {
    const h = new ViewHistory(original)
    h.record(panLeft)
    h.record(zoomIn)
    h.record(panUp)
    expect(h.back()).toBe(zoomIn)
    expect(h.back()).toBe(panLeft)
    const other = { y: [1, 2] }
    h.record(other) // replaces "zoom in" and "pan up"
    expect(h.canForward).toBe(false)
    expect(h.back()).toBe(panLeft)
    expect(h.back()).toBe(original)
    expect(h.forward()).toBe(panLeft)
    expect(h.forward()).toBe(other)
    expect(h.forward()).toBeNull()
  })

  it('ignores a view identical to the current one', () => {
    const h = new ViewHistory(original)
    expect(h.record({})).toBe(false)
    h.record(panLeft)
    expect(h.record({ x: [-1, 9] })).toBe(false)
    expect(h.back()).toBe(original)
    expect(h.back()).toBeNull()
  })

  it('merges the steps of one scroll gesture into a single entry', () => {
    const h = new ViewHistory(original)
    h.record({ x: [0, 9] }, { merge: true })
    h.record({ x: [0, 8] }, { merge: true })
    h.record({ x: [0, 7] }, { merge: true })
    expect(h.current).toEqual({ x: [0, 7] })
    expect(h.back()).toBe(original) // one step undoes the whole gesture
    h.forward()
    h.record(zoomIn) // something else ends the gesture
    h.record({ x: [3, 5], y: [0, 10] }, { merge: true })
    expect(h.back()).toBe(zoomIn)
  })

  it('compares views by value, and starts over on reset', () => {
    expect(sameView({}, {})).toBe(true)
    expect(sameView({ x: [1, 2] }, { x: [1, 2] })).toBe(true)
    expect(sameView({ x: [1, 2] }, { x: [1, 3] })).toBe(false)
    expect(sameView({ x: [1, 2] }, {})).toBe(false)
    const h = new ViewHistory(original)
    h.record(panLeft)
    h.reset()
    expect(h.canBack || h.canForward).toBe(false)
    expect(h.current).toEqual({})
  })
})

describe('box and density statistics', () => {
  it('computes quartiles, whiskers and outliers by the 1.5 x IQR rule', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
    const b = boxStats(values)
    expect(b.q1).toBeCloseTo(3.25, 9)
    expect(b.median).toBe(5.5)
    expect(b.q3).toBeCloseTo(7.75, 9)
    expect(b.hi).toBe(9) // 100 is past q3 + 1.5 * IQR = 14.5
    expect(b.lo).toBe(1)
    expect(Array.from(b.outliers)).toEqual([100])
    expect(b.mean).toBeCloseTo(14.5, 9)
    expect([b.n, b.min, b.max]).toEqual([10, 1, 100])
  })
  it('has no outliers for tidy data and handles one value', () => {
    expect(boxStats([1, 2, 3, 4, 5]).outliers).toHaveLength(0)
    const one = boxStats([7])
    expect([one.q1, one.median, one.q3, one.lo, one.hi]).toEqual([7, 7, 7, 7, 7])
  })
  it('makes a density that peaks at 1 near the middle of the data and covers its range', () => {
    const values = Array.from({ length: 500 }, (_, i) => Math.sin(i * 12.9898) * 2 + 10)
    const d = density(values)
    expect(d.ys).toHaveLength(100)
    expect(Math.max(...d.dens)).toBe(1)
    const peak = d.ys[d.dens.indexOf(1)]
    expect(Math.abs(peak - 10)).toBeLessThan(2)
    expect(d.ys[0]).toBeLessThan(Math.min(...values))
    expect(d.ys[99]).toBeGreaterThan(Math.max(...values))
  })
  it('copes with identical values', () => {
    const d = density([5, 5, 5, 5])
    expect(Number.isFinite(d.bw)).toBe(true)
    expect(Math.max(...d.dens)).toBe(1)
  })
})

describe('chartFromFigure: distributions, heatmaps and the matrix', () => {
  const rows = ['a,b,c,d,label']
  for (let i = 0; i < 300; i++)
    rows.push(`${Math.sin(i * 1.7) * 3 + 10},${Math.cos(i * 0.9) * 5},${i % 50},${(i * 7) % 13},${i % 2 ? 'odd' : 'even'}`)
  const table = parseCsv(rows.join('\n'), 'dist.csv')
  const tr = (col) => ({ col, side: 'L' })
  const make = (o) => chartFromFigure(buildFigure(table, { ...DEFAULT_OPTS, ...o }))

  it('histogram bars carry their own width and are not grouped', () => {
    const c = make({ kind: 'Histogram', traces: [tr('a'), tr('b')], bins: 10 })
    expect(c.series).toHaveLength(2)
    expect(c.series.every((s) => s.mode === 'bars' && s.barWidth > 0 && s.slots === 1)).toBe(true)
    expect(c.series[0].x).toHaveLength(10)
    expect(c.y.title).toBe('count')
  })
  it('ECDF is a stepped line', () => {
    const c = make({ kind: 'ECDF', traces: [tr('a')] })
    expect(c.series[0].step).toBe(true)
    expect(c.series[0].sorted).toBe(true)
    expect(c.y.title).toBe('cumulative fraction')
  })
  it('box and violin make one labelled group per trace, with their statistics', () => {
    for (const kind of ['Box', 'Violin']) {
      const c = make({ kind, traces: [tr('a'), tr('b')] })
      expect(c.legend).toBe(false)
      expect(c.x.type).toBe('category')
      expect(c.x.ticks.labels).toEqual(['a', 'b'])
      expect(c.series.map((s) => s.mode)).toEqual([kind.toLowerCase(), kind.toLowerCase()])
      expect(c.series[1].stats.median).toBeCloseTo(c.series[1].readout.find(([n]) => n === 'median')[1], 12)
      expect(Array.from(c.series[1].x).every((v) => v === 1)).toBe(true)
    }
    expect(make({ kind: 'Violin', traces: [tr('a')] }).series[0].profile.ys).toHaveLength(100)
  })
  it('the 2D histogram is a numeric grid with a count color bar', () => {
    const c = make({ kind: '2D histogram', x: 'a', traces: [tr('b')], bins: 8 })
    const g = c.series[0].grid
    expect([g.nx, g.ny]).toEqual([8, 8])
    expect(c.hover).toBe('cell')
    expect(c.colorbar.title).toBe('count')
    expect(Array.from(g.z).reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0)).toBe(300)
    expect(Array.from(g.z).some(Number.isNaN)).toBe(true) // empty bins are left blank
  })
  it('the correlation heatmap is a labelled square with the first row on top', () => {
    const c = make({ kind: 'Correlation heatmap', traces: [tr('a'), tr('b'), tr('c')] })
    const g = c.series[0].grid
    expect(g.xLabels).toEqual(['a', 'b', 'c'])
    expect(c.y.reversed).toBe(true)
    expect([c.colorbar.cmin, c.colorbar.cmax]).toEqual([-1, 1])
    expect(g.z[0]).toBeCloseTo(1, 9)
    expect(g.z[1]).toBeCloseTo(g.z[3], 12) // symmetric
    expect(g.showText).toBe(true)
  })
  it('the scatter matrix keeps one array per column', () => {
    const c = make({ kind: 'Scatter matrix', traces: [tr('a'), tr('b'), tr('c')] })
    expect(c.kind).toBe('matrix')
    expect(c.labels).toEqual(['a', 'b', 'c'])
    expect(c.columns).toHaveLength(3)
    expect(c.columns[0]).toBeInstanceOf(Float64Array)
  })
})
