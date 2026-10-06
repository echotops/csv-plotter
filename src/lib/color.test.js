import { describe, expect, it } from 'vitest'
import { normalizeColor, toRgbText } from './color'

describe('normalizeColor', () => {
  it('accepts hex in all its usual spellings', () => {
    expect(normalizeColor('#2CA02C')).toBe('#2ca02c')
    expect(normalizeColor('2ca02c')).toBe('#2ca02c')
    expect(normalizeColor('#2c0')).toBe('#22cc00')
    expect(normalizeColor('  #FFF ')).toBe('#ffffff')
  })

  it('accepts rgb() and bare component lists', () => {
    expect(normalizeColor('rgb(44, 160, 44)')).toBe('#2ca02c')
    expect(normalizeColor('rgb(44,160,44)')).toBe('#2ca02c')
    expect(normalizeColor('44, 160, 44')).toBe('#2ca02c')
    expect(normalizeColor('44 160 44')).toBe('#2ca02c')
    expect(normalizeColor('rgba(0, 0, 255, 0.5)')).toBe('#0000ff')
    expect(normalizeColor('0,0,0')).toBe('#000000')
    expect(normalizeColor('255,255,255')).toBe('#ffffff')
  })

  it('rejects things that are not colors (including out-of-range components)', () => {
    for (const bad of [
      '',
      'red',
      '#12',
      '#1234567',
      '256,0,0',
      '-1,0,0',
      '1,2',
      '1,2,3,4,5',
      'rgb(1,2',
      '#ggg',
    ]) {
      expect(normalizeColor(bad), bad).toBeNull()
    }
  })

  it('round-trips through rgb text', () => {
    expect(toRgbText('#2ca02c')).toBe('rgb(44, 160, 44)')
    expect(normalizeColor(toRgbText('#d62728'))).toBe('#d62728')
  })
})
