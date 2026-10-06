import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import { checkExpression, compileExpression, evaluateColumn } from './expression'

const table = parseCsv(
  [
    'TIME_MS,chamber_psi,tank_psi,sensor A,pressure (psi),phase,stamp',
    '0,10,100,1,5,a,2026-01-01 00:00:00',
    '500,20,90,2,6,b,2026-01-01 00:00:01',
    '1000,30,80,4,7,a,2026-01-01 00:00:02',
    '1500,40,70,8,,b,2026-01-01 00:00:03',
  ].join('\n'),
  't.csv',
)

const run = (expr) => Array.from(evaluateColumn(table, expr))
const close = (a, b) => a.every((v, i) => (Number.isNaN(b[i]) ? Number.isNaN(v) : Math.abs(v - b[i]) < 1e-9))

describe('arithmetic', () => {
  it('works elementwise across columns', () => {
    expect(run('chamber_psi - tank_psi')).toEqual([-90, -70, -50, -30])
    expect(run('TIME_MS * 1e-3')).toEqual([0, 0.5, 1, 1.5])
    expect(run('chamber_psi / 10 + 1')).toEqual([2, 3, 4, 5])
  })

  it('respects precedence, parentheses and unary minus', () => {
    expect(run('1 + 2 * 3')).toEqual([7, 7, 7, 7])
    expect(run('(1 + 2) * 3')).toEqual([9, 9, 9, 9])
    expect(run('-chamber_psi + 15')).toEqual([5, -5, -15, -25])
    expect(run('2 ^ 3 ^ 2')[0]).toBe(512) // right-associative
    expect(run('-2 ^ 2')[0]).toBe(-4) // power binds tighter than unary minus
    expect(run('2 ** 3')[0]).toBe(8)
    expect(run('7 % 4')[0]).toBe(3)
  })

  it('reads scientific notation and rejects malformed numbers', () => {
    expect(run('1.5e3')[0]).toBe(1500)
    expect(run('2e-2')[0]).toBe(0.02)
    expect(checkExpression(table, '1.5.2 + 1')).toMatch(/Malformed number/)
  })

  it('division by zero gives Infinity/NaN rather than throwing', () => {
    expect(run('1 / (chamber_psi - 10)')[0]).toBe(Infinity)
    expect(Number.isNaN(run('0 / 0')[0])).toBe(true)
  })
})

describe('functions and constants', () => {
  it('evaluates math functions and constants', () => {
    expect(
      close(
        run('sin(TIME_MS / 1000 * pi)'),
        [0, 1, 0, -1].map((v, i) => Math.sin(i * 0.5 * Math.PI)),
      ),
    ).toBe(true)
    expect(run('sqrt(chamber_psi * 10)')[2]).toBeCloseTo(Math.sqrt(300), 12)
    expect(run('abs(tank_psi - 85)')).toEqual([15, 5, 5, 15])
    expect(run('pow(2, 10)')[0]).toBe(1024)
    expect(run('max(chamber_psi, 25)')).toEqual([25, 25, 30, 40])
    expect(run('min(1, 2, 3)')[0]).toBe(1)
    expect(run('atan2(1, 1)')[0]).toBeCloseTo(Math.PI / 4, 12)
    expect(run('log10(1000)')[0]).toBeCloseTo(3, 12)
    expect(run('e')[0]).toBeCloseTo(Math.E, 12)
    expect(run('SIN(0) + PI')[0]).toBeCloseTo(Math.PI, 12)
  })

  it('exposes the row number as index / row', () => {
    expect(run('index')).toEqual([0, 1, 2, 3])
    expect(run('row * 10')).toEqual([0, 10, 20, 30])
  })

  it('reports arity mistakes and unknown names clearly', () => {
    expect(checkExpression(table, 'sin(1, 2)')).toMatch(/'sin' expects 1 argument/)
    expect(checkExpression(table, 'pow(2)')).toMatch(/'pow' expects 2 argument/)
    expect(checkExpression(table, 'frobnicate(1)')).toMatch(/Unknown function 'frobnicate'/)
    expect(checkExpression(table, 'nope + 1')).toMatch(/Unknown column 'nope'/)
  })
})

describe('column lookup', () => {
  it('is case-insensitive but prefers exact matches', () => {
    expect(run('time_ms')).toEqual([0, 500, 1000, 1500])
    expect(run('CHAMBER_PSI')).toEqual([10, 20, 30, 40])
  })

  it('supports names with spaces/punctuation via brackets and quotes', () => {
    expect(run('[sensor A] * 2')).toEqual([2, 4, 8, 16])
    expect(run('"sensor A" + 1')).toEqual([2, 3, 5, 9])
    expect(run("'sensor A' - 1")).toEqual([0, 1, 3, 7])
    expect(run('`pressure (psi)` * 2').slice(0, 3)).toEqual([10, 12, 14])
    expect(Number.isNaN(run('[pressure (psi)]')[3])).toBe(true) // blank cell stays missing
    expect(checkExpression(table, '[sensor A')).toMatch(/Missing closing/)
    expect(checkExpression(table, '[]')).toMatch(/Empty column name/)
  })

  it('a column named like a constant shadows the constant', () => {
    const t = parseCsv('e,x\n5,1\n6,2\n', 'x')
    expect(Array.from(evaluateColumn(t, 'e'))).toEqual([5, 6]) // a column named e shadows the constant
  })

  it('uses time columns as epoch milliseconds and rejects text columns', () => {
    const v = run('(stamp - 1767225600000) / 1000') // 2026-01-01T00:00:00Z
    expect(v).toEqual([0, 1, 2, 3])
    expect(checkExpression(table, 'phase * 2')).toMatch(/Column 'phase' is text/)
  })

  it('ambiguous case-insensitive names fall through to an unknown-column error', () => {
    const t = parseCsv('Ab,aB\n1,2\n3,4\n', 'x')
    expect(checkExpression(t, 'ab')).toMatch(/Unknown column/)
    expect(Array.from(evaluateColumn(t, 'Ab'))).toEqual([1, 3])
  })
})

describe('syntax errors', () => {
  it('flags every common mistake with a message instead of throwing a crash', () => {
    for (const bad of ['1 +', '(1 + 2', '1 2', '1 + * 2', ')', '1 $ 2', 'sin(', 'sin()', '@']) {
      expect(checkExpression(table, bad), bad).not.toBe('')
    }
  })
  it('empty formulas are neither valid nor an error to show', () => {
    expect(checkExpression(table, '   ')).toBe('')
    expect(() => compileExpression('  ', table)).toThrow(/Enter a formula/)
  })
  it('without a table there is nothing to check against', () => {
    expect(checkExpression(null, '1 + 1')).toMatch(/Load a file/)
  })
})

describe('evaluateColumn caching', () => {
  it('returns the same array for repeated identical formulas (whitespace-insensitive at the edges)', () => {
    const a = evaluateColumn(table, 'chamber_psi * 2')
    expect(evaluateColumn(table, '  chamber_psi * 2 ')).toBe(a)
  })
  it('caches failures too, and rethrows them', () => {
    expect(() => evaluateColumn(table, 'nope')).toThrow(/Unknown column/)
    expect(() => evaluateColumn(table, 'nope')).toThrow(/Unknown column/)
  })
  it('is per table', () => {
    const other = parseCsv('chamber_psi\n1\n2\n', 'o')
    expect(Array.from(evaluateColumn(other, 'chamber_psi * 2'))).toEqual([2, 4])
    expect(Array.from(evaluateColumn(table, 'chamber_psi * 2'))).toEqual([20, 40, 60, 80])
  })
  it('handles a million rows fast', () => {
    const n = 1_000_000
    const big = {
      name: 'big',
      n,
      names: ['a', 'b'],
      cols: {
        a: { kind: 'num', values: Float64Array.from({ length: n }, (_, i) => i) },
        b: { kind: 'num', values: new Float64Array(n).fill(2) },
      },
    }
    const t0 = performance.now()
    const out = evaluateColumn(big, 'sin(a * 1e-3) * b + sqrt(abs(a - b))')
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(out[10]).toBeCloseTo(Math.sin(0.01) * 2 + Math.sqrt(8), 12)
  })
})
