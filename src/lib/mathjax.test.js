import { describe, expect, it } from 'vitest'
import { hasMath } from './mathjax'

describe('hasMath', () => {
  it('finds $...$ spans', () => {
    expect(hasMath('Velocity ($\\frac{m}{s}$)')).toBe(true)
    expect(hasMath('$x^2$')).toBe(true)
  })

  it('ignores plain text, lone dollar signs and non-strings', () => {
    expect(hasMath('Cost: 5$')).toBe(false)
    expect(hasMath('$$')).toBe(false)
    expect(hasMath('thrust (N)')).toBe(false)
    expect(hasMath(undefined)).toBe(false)
  })
})
