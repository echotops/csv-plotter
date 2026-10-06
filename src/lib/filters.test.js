import { describe, expect, it } from 'vitest'
import fixtures from './__fixtures__/filters.json'
import { applyFilter, estimateFs, FilterError, oddWindow } from './filters'

const signal = Float64Array.from(fixtures.signal)

describe('filters match the scipy reference implementation', () => {
  for (const c of fixtures.cases) {
    it(`${c.name} (p1=${c.p1}, p2=${c.p2})`, () => {
      const { y, info } = applyFilter(signal, c.name, c.p1, c.p2, c.fs)
      expect(y.length).toBe(signal.length)
      let worst = 0
      for (let i = 0; i < y.length; i++) worst = Math.max(worst, Math.abs(y[i] - c.expected[i]))
      expect(worst).toBeLessThan(1e-7)
      expect(info).toBe(c.info.replace('~', '~'))
    })
  }
})

describe('filter edge cases', () => {
  const y = Float64Array.from({ length: 50 }, (_, i) => Math.sin(i / 5))
  it('rejects a cutoff above Nyquist with a clear message', () => {
    expect(() => applyFilter(y, 'Low-pass (Butterworth)', 600, 4, 1000)).toThrow(
      /cutoff must be between 0 and 500/,
    )
  })
  it('rejects polynomial order >= window', () => {
    expect(() => applyFilter(y, 'Savitzky-Golay', 3, 5, 1)).toThrow(FilterError)
  })
  it('handles windows longer than the data', () => {
    for (const name of ['Moving average', 'Median', 'Despike (Hampel)']) {
      expect(applyFilter(y, name, 500, 3, 1).y.length).toBe(50)
    }
    expect(applyFilter(y, 'Savitzky-Golay', 501, 3, 1).y.length).toBe(50)
  })
  it('passes very short series through untouched', () => {
    const tiny = Float64Array.from([1, 2])
    expect(applyFilter(tiny, 'Median', 5, 0, 1).y).toBe(tiny)
  })
  it('errors (not crashes) when a Butterworth needs more samples', () => {
    expect(() =>
      applyFilter(Float64Array.from([1, 2, 3, 4, 5]), 'Low-pass (Butterworth)', 10, 4, 1000),
    ).toThrow(FilterError)
  })
  it('keeps constant signals constant', () => {
    const flat = new Float64Array(200).fill(3.5)
    for (const name of [
      'Moving average',
      'Median',
      'Gaussian',
      'Exponential (EMA)',
      'Low-pass (Butterworth)',
    ]) {
      const out = applyFilter(flat, name, name.startsWith('Low') ? 40 : 9, 3, 1000).y
      expect(Math.max(...Array.from(out).map((v) => Math.abs(v - 3.5)))).toBeLessThan(1e-9)
    }
    const hp = applyFilter(flat, 'High-pass (Butterworth)', 5, 2, 1000).y
    expect(Math.max(...Array.from(hp).map(Math.abs))).toBeLessThan(1e-9)
  })
  it('oddWindow forces odd and caps at n', () => {
    expect(oddWindow(10, 100)).toBe(11)
    expect(oddWindow(11, 100)).toBe(11)
    expect(oddWindow(500, 50)).toBe(49)
    expect(oddWindow(500, 51)).toBe(51)
  })
})

describe('sample-rate estimate', () => {
  it('numeric x in seconds -> Hz', () => {
    expect(
      estimateFs(
        Float64Array.from({ length: 100 }, (_, i) => i * 0.001),
        'num',
      ),
    ).toBeCloseTo(1000, 6)
  })
  it('epoch milliseconds -> Hz', () => {
    expect(
      estimateFs(
        Float64Array.from({ length: 20 }, (_, i) => i * 30000),
        'time',
      ),
    ).toBeCloseTo(1 / 30, 9)
  })
  it('categorical / index fall back to 1', () => {
    expect(estimateFs(Float64Array.from([0, 1, 2]), 'cat')).toBe(1)
    expect(estimateFs(Float64Array.from([0, 1, 2, 3]), 'num')).toBe(1)
  })
})
