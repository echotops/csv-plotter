import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import { decimateIdx, describe as describeTable, normalize } from './data'
import { buildFigure, colorwayFor, pairCorr } from './plots'
import { CUSTOM, DEFAULT_OPTS, KINDS, NONE } from './types'

function hotfire(n = 6000) {
  const rows = ['time_s,chamber_psi,tank_psi,thrust_N,temp_C,phase,stamp']
  for (let i = 0; i < n; i++) {
    const t = i / 1000
    const ch = 400 * (1 - Math.exp(-t / 0.15)) * (t < 5.5 ? 1 : 0.04) + 15 + Math.sin(i * 12.9898) * 3
    const phase = t < 0.2 ? 'ignition' : t < 5.5 ? 'burn' : 'shutdown'
    const d = new Date(Date.UTC(2026, 9, 3, 14, 0, 0) + i * 1000).toISOString().replace('T', ' ').slice(0, 19)
    rows.push(
      [
        t.toFixed(3),
        ch.toFixed(3),
        (900 - 55 * t).toFixed(3),
        (ch * 8.7).toFixed(2),
        i >= 500 && i < 520 ? '' : (25 + 3 * t).toFixed(3),
        phase,
        d,
      ].join(','),
    )
  }
  return parseCsv(rows.join('\n'), 'hotfire.csv')
}

const table = hotfire()
const opts = (o) => ({ ...DEFAULT_OPTS, ...o })
const COLORWAY = colorwayFor(DEFAULT_OPTS.theme)
const tr = (col, side = 'L') => ({ col, side })

describe('buildFigure: every plot type', () => {
  const cases = {
    Line: { x: 'time_s', traces: [tr('chamber_psi')] },
    Scatter: { x: 'time_s', traces: [tr('thrust_N')], colorBy: 'tank_psi' },
    'Line + markers': { x: 'time_s', traces: [tr('temp_C')], maxPts: 300 },
    Step: { x: 'time_s', traces: [tr('tank_psi')] },
    Area: { x: 'time_s', traces: [tr('chamber_psi'), tr('thrust_N')] },
    Bar: { x: 'phase', traces: [tr('chamber_psi')] },
    Histogram: { traces: [tr('chamber_psi'), tr('thrust_N')], density: true },
    Box: { traces: [tr('chamber_psi'), tr('tank_psi'), tr('thrust_N')] },
    Violin: { traces: [tr('chamber_psi'), tr('temp_C')] },
    ECDF: { traces: [tr('chamber_psi'), tr('thrust_N')] },
    '2D histogram': { x: 'chamber_psi', traces: [tr('thrust_N')], bins: 25 },
    'Correlation heatmap': { traces: [tr(NONE)] },
    'Scatter matrix': { traces: [tr(NONE)] },
  }
  for (const kind of KINDS) {
    it(`${kind} produces data and no message`, () => {
      const fig = buildFigure(table, opts({ kind, ...cases[kind] }))
      expect(fig.message).toBeUndefined()
      expect(fig.data.length).toBeGreaterThan(0)
    })
  }
})

describe('buildFigure: traces and axes', () => {
  it('uses a right axis only when both sides are present', () => {
    const both = buildFigure(table, opts({ x: 'time_s', traces: [tr('chamber_psi'), tr('thrust_N', 'R')] }))
    expect(both.layout.yaxis2).toBeDefined()
    expect(both.data.map((d) => d.yaxis)).toEqual(['y', 'y2'])
    const onlyRight = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('chamber_psi', 'R'), tr('tank_psi', 'R')] }),
    )
    expect(onlyRight.layout.yaxis2).toBeUndefined()
    expect(onlyRight.data.every((d) => d.yaxis === 'y')).toBe(true)
  })
  it('keeps a trace color tied to its slot, even with a blank row before it', () => {
    const fig = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('chamber_psi'), tr(NONE), tr('tank_psi')] }),
    )
    const colors = fig.data.map((d) => d.line.color)
    expect(colors).toEqual([COLORWAY[0], COLORWAY[2]])
  })
  it('shows messages instead of throwing for empty/invalid setups', () => {
    expect(buildFigure(null, opts({})).message).toMatch(/Choose a CSV/)
    expect(buildFigure(table, opts({ traces: [tr(NONE), tr(NONE, 'R')] })).message).toMatch(/Add a trace/)
    expect(buildFigure(table, opts({ x: 'time_s', traces: [tr('phase')] })).message).toMatch(/Add a trace/)
    expect(
      buildFigure(table, opts({ kind: '2D histogram', x: 'phase', traces: [tr('chamber_psi')] })).message,
    ).toMatch(/numeric X/)
    expect(
      buildFigure(table, opts({ kind: 'Correlation heatmap', traces: [tr('chamber_psi')] })).message,
    ).toMatch(/at least two/)
  })
  it('notes skipped non-numeric traces but still plots the rest', () => {
    const fig = buildFigure(table, opts({ x: 'time_s', traces: [tr('phase'), tr('chamber_psi')] }))
    expect(fig.notes.join()).toMatch(/skipped non-numeric: phase/)
    expect(fig.data.length).toBe(1)
  })
  it('date x uses a date axis; text x uses a category axis', () => {
    expect(buildFigure(table, opts({ x: 'stamp', traces: [tr('chamber_psi')] })).layout.xaxis.type).toBe(
      'date',
    )
    expect(buildFigure(table, opts({ x: 'phase', traces: [tr('chamber_psi')] })).layout.xaxis.type).toBe(
      'category',
    )
  })
  it('sends dates as timezone-less strings so the axis matches the file in any timezone', () => {
    const fig = buildFigure(table, opts({ x: 'stamp', traces: [tr('chamber_psi')] }))
    const x = fig.data[0].x
    expect(x[0]).toBe('2026-10-03 14:00:00.000')
    expect(x[90]).toBe('2026-10-03 14:01:30.000')
  })
  it('applies log scales and axis limits (log limits become log10 ranges)', () => {
    const fig = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('chamber_psi')], logy: true, ylim: ['10', '1000'], xlim: ['1', '3'] }),
    )
    expect(fig.layout.yaxis.type).toBe('log')
    expect(fig.layout.yaxis.range).toEqual([1, 3])
    expect(fig.layout.xaxis.range).toEqual([1, 3])
  })
  it('ignores garbage limits', () => {
    const fig = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('chamber_psi')], xlim: ['abc', 'nan'], ylim: ['', '1e999'] }),
    )
    expect(fig.layout.xaxis.range).toBeUndefined()
    expect(fig.layout.yaxis.range).toBeUndefined()
  })
  it('the scatter-with-colorbar plot hides the legend', () => {
    const fig = buildFigure(
      table,
      opts({ kind: 'Scatter', x: 'time_s', traces: [tr('thrust_N')], colorBy: 'tank_psi' }),
    )
    expect(fig.layout.showlegend).toBe(false)
  })
})

describe('buildFigure: filters and decimation', () => {
  it('adds a faint raw trace under a filtered line, and can hide it', () => {
    const on = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('thrust_N')], filter: 'Median', fp1: 21, showRaw: true }),
    )
    expect(on.data.length).toBe(2)
    const off = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('thrust_N')], filter: 'Median', fp1: 21, showRaw: false }),
    )
    expect(off.data.length).toBe(1)
  })
  it('reports Butterworth sample rate and skips an impossible cutoff with a reason', () => {
    const ok = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('thrust_N')], filter: 'Low-pass (Butterworth)', fp1: 20, fp2: 4 }),
    )
    expect(ok.notes.join()).toMatch(/fs ~ 1000 Hz/)
    const bad = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('thrust_N')], filter: 'Low-pass (Butterworth)', fp1: 900, fp2: 4 }),
    )
    expect(bad.notes.join()).toMatch(/filter skipped \(cutoff must be between 0 and 500/)
    expect(bad.data.length).toBe(1)
  })
  it('does not filter plots that are not line-style', () => {
    const fig = buildFigure(
      table,
      opts({ kind: 'Scatter', x: 'time_s', traces: [tr('thrust_N')], filter: 'Median', fp1: 21 }),
    )
    expect(fig.data.length).toBe(1)
  })
  it('downsamples long series to maxPts', () => {
    const big = hotfire(50000)
    const fig = buildFigure(big, opts({ x: 'time_s', traces: [tr('thrust_N')], maxPts: 2000 }))
    expect(fig.data[0].x.length).toBeLessThanOrEqual(2000)
    expect(fig.notes.join()).toMatch(/downsampled 50,000 -> /)
  })
  it('min/max decimation keeps a lone spike', () => {
    const y = new Float64Array(100000).fill(1)
    y[54321] = 99
    const idx = decimateIdx(y.length, 1000, y)
    expect(idx.length).toBeLessThanOrEqual(1000)
    expect(Array.from(idx).some((i) => y[i] === 99)).toBe(true)
    expect(Array.from(idx)).toEqual(Array.from(idx).sort((a, b) => a - b))
  })
})

describe('numerics', () => {
  it('pairCorr matches known values and is symmetric', () => {
    const a = Float64Array.from([1, 2, 3, 4, 5])
    const b = Float64Array.from([2, 4, 6, 8, 10])
    const c = Float64Array.from([5, 4, 3, 2, 1])
    const flat = Float64Array.from([3, 3, 3, 3, 3])
    const m = pairCorr([a, b, c, flat])
    expect(m[0][1]).toBeCloseTo(1, 12)
    expect(m[0][2]).toBeCloseTo(-1, 12)
    expect(m[1][0]).toBeCloseTo(1, 12)
    expect(m[0][3]).toBeNull()
  })
  it('normalize modes', () => {
    const y = Float64Array.from([2, 4, 6])
    expect(Array.from(normalize(y, 'Min-max (0-1)'))).toEqual([0, 0.5, 1])
    expect(Array.from(normalize(y, 'Subtract first value'))).toEqual([0, 2, 4])
    expect(Array.from(normalize(y, 'Divide by first value'))).toEqual([1, 2, 3])
    const z = normalize(y, 'Z-score')
    expect(z[0]).toBeCloseTo(-1.2247, 3)
    expect(Array.from(normalize(Float64Array.from([5, 5]), 'Z-score'))).toEqual([0, 0])
  })
  it('describe() gives sensible column stats', () => {
    const rows = describeTable(table)
    const psi = rows.find((r) => r.column === 'temp_C')
    expect(psi.type).toBe('number')
    expect(psi.missing).toBe(20)
    expect(rows.find((r) => r.column === 'phase').unique).toBe('3')
    expect(rows.find((r) => r.column === 'stamp').type).toBe('datetime')
  })
})

describe('custom formulas', () => {
  const f = (expr, side = 'L', color = '') => ({ col: CUSTOM, side, expr, color })

  it('plots a formula of columns, named after its own text', () => {
    const fig = buildFigure(table, opts({ x: 'time_s', traces: [f('tank_psi - chamber_psi')] }))
    expect(fig.message).toBeUndefined()
    expect(fig.data[0].name).toBe('tank_psi - chamber_psi')
    expect(fig.layout.yaxis.title.text).toBe('tank_psi - chamber_psi')
    const y = fig.data[0].y
    const ch = table.cols.chamber_psi.values
    const tk = table.cols.tank_psi.values
    expect(y[100]).toBeCloseTo(tk[100] - ch[100], 9)
    expect(y[5999]).toBeCloseTo(tk[5999] - ch[5999], 9)
  })

  it('mixes ordinary and formula traces, keeping slot colors and axes', () => {
    const fig = buildFigure(
      table,
      opts({ x: 'time_s', traces: [tr('chamber_psi'), f('thrust_N / 1000', 'R')] }),
    )
    expect(fig.data.map((d) => d.yaxis)).toEqual(['y', 'y2'])
    expect(fig.data.map((d) => d.line.color)).toEqual([COLORWAY[0], COLORWAY[1]])
    expect(fig.layout.yaxis2.title.text).toBe('thrust_N / 1000')
  })

  it('uses a formula as the X axis (e.g. milliseconds -> seconds)', () => {
    const fig = buildFigure(
      table,
      opts({ x: CUSTOM, xExpr: 'time_s * 1000 * 1e-3 + 10', traces: [tr('chamber_psi')] }),
    )
    expect(fig.message).toBeUndefined()
    expect(fig.data[0].x[0]).toBeCloseTo(10, 12)
    expect(fig.data[0].x[1000]).toBeCloseTo(11, 9)
    expect(fig.layout.xaxis.title.text).toBe('time_s * 1000 * 1e-3 + 10')
  })

  it('formula X and formula Y together', () => {
    const fig = buildFigure(
      table,
      opts({ x: CUSTOM, xExpr: 'index / 1000', traces: [f('sin(2 * pi * index / 1000)')] }),
    )
    expect(fig.data[0].x[250]).toBeCloseTo(0.25, 12)
    expect(fig.data[0].y[250]).toBeCloseTo(1, 9)
  })

  it('a broken formula becomes a note and drops only that trace', () => {
    const fig = buildFigure(table, opts({ x: 'time_s', traces: [tr('chamber_psi'), f('nope + 1')] }))
    expect(fig.data.length).toBe(1)
    expect(fig.notes.join()).toMatch(/Trace formula: Unknown column 'nope'/)
  })

  it('says why when a formula was the only thing to plot', () => {
    const fig = buildFigure(table, opts({ x: 'time_s', traces: [f('nope + 1')] }))
    expect(fig.message).toMatch(/Trace formula: Unknown column 'nope'/)
  })

  it('a broken X formula falls back to the row index', () => {
    const fig = buildFigure(table, opts({ x: CUSTOM, xExpr: 'sin(', traces: [tr('chamber_psi')] }))
    expect(fig.data[0].x[3]).toBe(3)
    expect(fig.notes.join()).toMatch(/X formula/)
  })

  it('a blank formula is quietly ignored', () => {
    const fig = buildFigure(table, opts({ x: 'time_s', traces: [tr('chamber_psi'), f('   ')] }))
    expect(fig.data.length).toBe(1)
    expect(fig.notes.join()).not.toMatch(/formula/)
  })

  it('formulas flow through filters, other plot kinds and text-column errors', () => {
    const filtered = buildFigure(
      table,
      opts({ x: 'time_s', traces: [f('thrust_N * 2')], filter: 'Median', fp1: 21 }),
    )
    expect(filtered.data.length).toBe(2) // faint raw + filtered
    const hist = buildFigure(table, opts({ kind: 'Histogram', traces: [f('chamber_psi - 15')] }))
    expect(hist.data.length).toBe(1)
    const bad = buildFigure(table, opts({ x: 'time_s', traces: [f('phase * 2')] }))
    expect(bad.notes.join()).toMatch(/Column 'phase' is text/)
  })

  it('does not mutate the loaded table', () => {
    const names = [...table.names]
    buildFigure(table, opts({ x: CUSTOM, xExpr: 'index', traces: [f('chamber_psi * 3')] }))
    expect(table.names).toEqual(names)
  })
})

describe('trace colors', () => {
  const colored = (color) => ({ col: 'chamber_psi', side: 'L', expr: '', color })

  it('uses the user color for lines, scatter markers, bars, histograms, box and ECDF', () => {
    const base = { x: 'time_s', traces: [colored('#112233')] }
    expect(buildFigure(table, opts({ ...base })).data[0].line.color).toBe('#112233')
    expect(buildFigure(table, opts({ ...base, kind: 'Scatter' })).data[0].marker.color).toBe('#112233')
    expect(buildFigure(table, opts({ ...base, kind: 'Bar', x: 'phase' })).data[0].marker.color).toBe(
      '#112233',
    )
    expect(buildFigure(table, opts({ ...base, kind: 'Histogram' })).data[0].marker.color).toBe('#112233')
    expect(buildFigure(table, opts({ ...base, kind: 'Box' })).data[0].line.color).toBe('#112233')
    expect(buildFigure(table, opts({ ...base, kind: 'ECDF' })).data[0].line.color).toBe('#112233')
    expect(
      buildFigure(
        table,
        opts({ ...base, kind: 'Scatter matrix', traces: [colored('#112233'), tr('tank_psi')] }),
      ).data[0].marker.color,
    ).toBe('#112233')
  })

  it('applies to the faint raw trace and area fill too', () => {
    const fig = buildFigure(
      table,
      opts({ x: 'time_s', traces: [colored('#ff0000')], filter: 'Median', fp1: 9 }),
    )
    expect(fig.data.map((d) => d.line.color)).toEqual(['#ff0000', '#ff0000'])
    const area = buildFigure(table, opts({ kind: 'Area', x: 'time_s', traces: [colored('#ff0000')] }))
    expect(area.data[0].fillcolor).toMatch(/^rgba\(255, 0, 0,/)
  })

  it('falls back to the palette slot when the color is blank or invalid', () => {
    expect(buildFigure(table, opts({ x: 'time_s', traces: [colored('')] })).data[0].line.color).toBe(
      COLORWAY[0],
    )
    expect(
      buildFigure(table, opts({ x: 'time_s', traces: [colored('not a color')] })).data[0].line.color,
    ).toBe(COLORWAY[0])
  })

  it('each trace keeps its own color independently', () => {
    const fig = buildFigure(
      table,
      opts({
        x: 'time_s',
        traces: [
          colored('#112233'),
          { col: 'tank_psi', side: 'L', expr: '', color: '' },
          colored('rgb(200, 100, 50)'),
        ],
      }),
    )
    expect(fig.data.map((d) => d.line.color)).toEqual(['#112233', COLORWAY[1], '#c86432'])
  })

  it('changing a color does not reset the zoom, but changing a formula does', () => {
    const rev = (o) => buildFigure(table, opts({ x: 'time_s', ...o })).layout.uirevision
    const a = rev({ traces: [{ col: 'chamber_psi', side: 'L', expr: '', color: '' }] })
    const b = rev({ traces: [{ col: 'chamber_psi', side: 'L', expr: '', color: '#123456' }] })
    expect(b).toBe(a)
    const f1 = rev({ traces: [{ col: CUSTOM, side: 'L', expr: 'chamber_psi', color: '' }] })
    const f2 = rev({ traces: [{ col: CUSTOM, side: 'L', expr: 'chamber_psi * 2', color: '' }] })
    expect(f2).not.toBe(f1)
  })
})

describe('themes', () => {
  const line = (theme, color = '') =>
    buildFigure(
      table,
      opts({ theme, x: 'time_s', traces: [{ col: 'chamber_psi', side: 'L', expr: '', color }] }),
    )

  it('defaults to dark, matching the sites it is styled after', () => {
    expect(DEFAULT_OPTS.theme).toBe('Dark')
    expect(line('Dark').layout.paper_bgcolor).toBe('#17181e')
  })

  it('light mode swaps the plot chrome and the default trace palette', () => {
    const dark = line('Dark')
    const light = line('Light')
    expect(light.layout.paper_bgcolor).toBe('#ffffff')
    expect(light.layout.font.color).not.toBe(dark.layout.font.color)
    expect(light.data[0].line.color).toBe(colorwayFor('Light')[0])
    expect(dark.data[0].line.color).toBe(colorwayFor('Dark')[0])
    expect(light.data[0].line.color).not.toBe(dark.data[0].line.color)
  })

  it('a user-picked color is kept in both themes (the theme only supplies defaults)', () => {
    expect(line('Dark', '#123456').data[0].line.color).toBe('#123456')
    expect(line('Light', '#123456').data[0].line.color).toBe('#123456')
  })

  it('every palette color is a distinct, valid hex', () => {
    for (const theme of ['Dark', 'Light']) {
      const palette = colorwayFor(theme)
      expect(new Set(palette).size).toBe(palette.length)
      palette.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/))
    }
    expect(colorwayFor('nonsense')).toEqual(colorwayFor('Dark'))
  })

  it('hover labels and modebar follow the theme', () => {
    expect(line('Light').layout.hoverlabel.bgcolor).toBe('#ffffff')
    expect(line('Dark').layout.modebar.activecolor).toBe('#7c98ff')
  })
})

describe('many traces', () => {
  const f = (expr) => ({ col: CUSTOM, side: 'L', expr, color: '' })

  it('draws all ten traces with ten distinct palette colors', () => {
    const fig = buildFigure(
      table,
      opts({ x: 'time_s', traces: Array.from({ length: 10 }, (_, i) => f(`chamber_psi + ${i}`)) }),
    )
    expect(fig.data.length).toBe(10)
    expect(new Set(fig.data.map((d) => d.line.color)).size).toBe(10)
  })
})

describe('hidden traces', () => {
  const base = { x: 'time_s', traces: [tr('chamber_psi'), tr('tank_psi')] }

  it('are left out of the figure but keep the other traces on their own colors', () => {
    const fig = buildFigure(
      table,
      opts({ ...base, traces: [{ ...tr('chamber_psi'), hidden: true }, tr('tank_psi')] }),
    )
    expect(fig.data).toHaveLength(1)
    expect(fig.data[0].name).toBe('tank_psi')
    expect(fig.data[0].line.color).toBe(COLORWAY[1])
  })

  it('explain themselves when nothing is left to draw', () => {
    const fig = buildFigure(
      table,
      opts({ ...base, traces: base.traces.map((t) => ({ ...t, hidden: true })) }),
    )
    expect(fig.message).toMatch(/hidden/i)
  })

  it('do not change the zoom revision', () => {
    const a = buildFigure(table, opts(base)).layout.uirevision
    const b = buildFigure(
      table,
      opts({ ...base, traces: [{ ...tr('chamber_psi'), hidden: true }, tr('tank_psi')] }),
    ).layout.uirevision
    expect(b).toBe(a)
  })
})

describe('hidden formula traces', () => {
  it('are not evaluated, so a broken formula on a hidden trace stays quiet', () => {
    const fig = buildFigure(
      table,
      opts({
        x: 'time_s',
        traces: [{ col: CUSTOM, expr: 'nope + 1', side: 'L', hidden: true }, tr('tank_psi')],
      }),
    )
    expect(fig.notes.join()).not.toMatch(/formula/)
    expect(fig.data).toHaveLength(1)
  })
})

describe('custom trace names', () => {
  const named = (name) => ({ col: 'chamber_psi', side: 'L', name })

  it('uses the name in the legend instead of the column', () => {
    const fig = buildFigure(table, opts({ x: 'time_s', traces: [named('Chamber pressure'), tr('tank_psi')] }))
    expect(fig.data.map((d) => d.name)).toEqual(['Chamber pressure', 'tank_psi'])
  })

  it('falls back to the column for an empty or blank name', () => {
    for (const name of ['', '   ', undefined]) {
      const fig = buildFigure(table, opts({ x: 'time_s', traces: [named(name)] }))
      expect(fig.data[0].name).toBe('chamber_psi')
    }
  })

  it('keeps the (right) suffix and applies to every plot type that has a legend entry', () => {
    const right = buildFigure(
      table,
      opts({ x: 'time_s', traces: [named('P'), { col: 'tank_psi', side: 'R', name: 'Tank' }] }),
    )
    expect(right.data.map((d) => d.name)).toEqual(['P', 'Tank (right)'])
    for (const kind of ['Bar', 'Histogram', 'Box', 'Violin', 'ECDF']) {
      const fig = buildFigure(table, opts({ kind, x: 'time_s', traces: [named('Renamed')] }))
      expect(fig.data[0].name, kind).toBe('Renamed')
    }
  })

  it('names a formula trace too', () => {
    const fig = buildFigure(
      table,
      opts({ x: 'time_s', traces: [{ col: CUSTOM, side: 'L', expr: 'chamber_psi * 2', name: 'Doubled' }] }),
    )
    expect(fig.data[0].name).toBe('Doubled')
  })
})
