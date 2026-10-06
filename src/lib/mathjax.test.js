import { describe, expect, it } from 'vitest'
import { hasMath, layoutHasMath, mixedToTex, texLayout } from './mathjax'

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

describe('layoutHasMath', () => {
  it('looks at the title and axis labels', () => {
    expect(layoutHasMath({ title: { text: 'plain' }, xaxis: { title: { text: '$t$' } } })).toBe(true)
    expect(layoutHasMath({ title: { text: 'plain' }, yaxis2: { title: { text: '$\\alpha$' } } })).toBe(true)
    expect(layoutHasMath({ title: { text: 'plain' }, xaxis: { title: { text: 'time' } } })).toBe(false)
    expect(layoutHasMath({})).toBe(false)
  })
})

describe('mixedToTex', () => {
  it('wraps the plain parts in \\text and keeps the math', () => {
    expect(mixedToTex('Velocity ($\\frac{m}{s}$)')).toBe('$\\text{Velocity (}\\frac{m}{s}\\text{)}$')
    expect(mixedToTex('$x^2$')).toBe('$x^2$')
    expect(mixedToTex('a $b$ c $d$')).toBe('$\\text{a }b\\text{ c }d$')
  })

  it('escapes characters that are special inside \\text', () => {
    expect(mixedToTex('chamber_psi 50% $x$')).toBe('$\\text{chamber\\_psi 50\\% }x$')
  })

  it('leaves labels without math alone', () => {
    expect(mixedToTex('thrust (N)')).toBe('thrust (N)')
    expect(mixedToTex('Cost: 5$')).toBe('Cost: 5$')
  })
})

describe('texLayout', () => {
  it('converts every title without touching the original', () => {
    const layout = {
      title: { text: 'a $b$', font: { size: 15 } },
      xaxis: { title: { text: 'x' }, showgrid: true },
      yaxis: { title: { text: 'v ($m$)' } },
      yaxis2: { title: { text: '$q$' } },
    }
    const out = texLayout(layout)
    expect(out.title).toEqual({ text: '$\\text{a }b$', font: { size: 15 } })
    expect(out.xaxis).toEqual({ title: { text: 'x' }, showgrid: true })
    expect(out.yaxis.title.text).toBe('$\\text{v (}m\\text{)}$')
    expect(out.yaxis2.title.text).toBe('$q$')
    expect(layout.title.text).toBe('a $b$')
    expect(texLayout({})).toEqual({})
  })
})
