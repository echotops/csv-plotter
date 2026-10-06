import { describe, expect, it } from 'vitest'
import { applyCompletion, completionsAt } from './autocomplete'

const cols = ['chamber_psi', 'tank_psi', 'TIME_MS', 'sensor A', 'pressure (psi)']
const labels = (c) => c.items.map((i) => i.label)

describe('completionsAt', () => {
  it('suggests columns by case-insensitive prefix, before functions', () => {
    const c = completionsAt('ch', 2, cols)
    expect(labels(c)).toEqual(['chamber_psi'])
    expect(completionsAt('t', 1, cols).items[0].label).toBe('tank_psi')
    expect(labels(completionsAt('t', 1, cols))).toContain('tan()')
  })

  it('only looks at the word before the caret', () => {
    const c = completionsAt('chamber_psi - ta + 3', 15, cols)
    expect(c.start).toBe(14)
    expect(labels(c)[0]).toBe('tank_psi')
  })

  it('brackets names that are not plain identifiers', () => {
    expect(completionsAt('se', 2, cols).items[0].insert).toBe('[sensor A]')
    const c = completionsAt('[se', 3, cols)
    expect(c.items[0].insert).toBe('[sensor A]')
    expect(c.start).toBe(0)
  })

  it('inside brackets matches anywhere in the name and offers only columns', () => {
    const c = completionsAt('[psi', 4, cols)
    expect(labels(c)).toEqual(['chamber_psi', 'tank_psi', 'pressure (psi)'])
  })

  it('swallows an existing closing bracket when completing', () => {
    const c = completionsAt('[sen]', 4, cols)
    const { text, caret } = applyCompletion('[sen]', c, c.items[0])
    expect(text).toBe('[sensor A]')
    expect(caret).toBe(10)
  })

  it('leaves number exponents alone and ignores nothing-to-complete', () => {
    expect(completionsAt('1e', 2, cols)).toBeNull()
    expect(completionsAt('2.5e', 4, cols)).toBeNull()
    expect(completionsAt('chamber_psi - ', 14, cols)).toBeNull()
    expect(completionsAt('zzz', 3, cols)).toBeNull()
  })

  it('stops suggesting once a name is typed in full', () => {
    expect(completionsAt('tank_psi', 8, cols)).toBeNull()
  })

  it('completes functions with an opening parenthesis', () => {
    const c = completionsAt('sq', 2, cols)
    const item = c.items.find((i) => i.label === 'sqrt()')
    expect(applyCompletion('sq', c, item)).toEqual({ text: 'sqrt(', caret: 5 })
  })
})
