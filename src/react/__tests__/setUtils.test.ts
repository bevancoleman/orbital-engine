import { setsEqual } from '../setUtils'

describe('setsEqual', () => {
  it('is true for two empty sets', () => {
    expect(setsEqual(new Set(), new Set())).toBe(true)
  })

  it('is true for sets with the same members in a different order', () => {
    expect(setsEqual(new Set(['a', 'b', 'c']), new Set(['c', 'a', 'b']))).toBe(true)
  })

  it('is false when sizes differ', () => {
    expect(setsEqual(new Set(['a', 'b']), new Set(['a']))).toBe(false)
  })

  it('is false when sizes match but members differ', () => {
    expect(setsEqual(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false)
  })

  it('is true for the same set instance', () => {
    const s = new Set(['a', 'b'])
    expect(setsEqual(s, s)).toBe(true)
  })
})
