import { describe, expect, it } from 'vitest'
import { moveItem } from './list'

describe('moveItem', () => {
  it('moves forward and backward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns the same list for no-ops and bad indices, and never mutates', () => {
    const l = ['a', 'b']
    expect(moveItem(l, 1, 1)).toBe(l)
    expect(moveItem(l, 0, 5)).toBe(l)
    expect(moveItem(l, -1, 0)).toBe(l)
    moveItem(l, 0, 1)
    expect(l).toEqual(['a', 'b'])
  })
})
