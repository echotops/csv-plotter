import { describe, expect, it } from 'vitest'
import { activeChips } from './chips'
import { DEFAULT_OPTS } from './types'

const opts = (o) => ({ ...DEFAULT_OPTS, ...o })

describe('activeChips', () => {
  it('is empty for default options', () => {
    expect(activeChips(opts({}))).toEqual([])
  })

  it('describes a filter with its parameters and resets it', () => {
    const [chip] = activeChips(opts({ filter: 'Moving average', fp1: 21 }))
    expect(chip.text).toBe('Moving average · 21')
    expect(chip.reset.filter).toBe('None')
  })

  it('ignores a filter on plot types that do not use it', () => {
    expect(activeChips(opts({ filter: 'Moving average', kind: 'Histogram' }))).toEqual([])
  })

  it('lists normalization, log axes and limits', () => {
    const chips = activeChips(opts({ norm: 'Z-score', logy: true, xlim: ['0', ''] }))
    expect(chips.map((c) => c.key)).toEqual(['norm', 'logy', 'xlim'])
    expect(chips[2].text).toBe('X: 0 to auto')
    expect(chips[2].reset).toEqual({ xlim: ['', ''] })
  })
})
