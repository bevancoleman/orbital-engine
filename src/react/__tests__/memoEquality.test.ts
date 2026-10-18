import { propsEqualWithVectors } from '../memoEquality'

describe('propsEqualWithVectors', () => {
  const fn = (): void => undefined
  const body = { id: 'earth' }

  it('treats equal numeric tuples as equal even when they are new arrays', () => {
    expect(propsEqualWithVectors({ position: [1, 2, 3], body }, { position: [1, 2, 3], body })).toBe(true)
  })

  it('detects a changed component in a numeric tuple', () => {
    expect(propsEqualWithVectors({ position: [1, 2, 3] }, { position: [1, 2, 3.0001] })).toBe(false)
    expect(propsEqualWithVectors({ position: [1, 2, 3] }, { position: [1, 2] })).toBe(false)
  })

  it('compares everything else by identity', () => {
    expect(propsEqualWithVectors({ body, onSelect: fn }, { body, onSelect: fn })).toBe(true)
    expect(propsEqualWithVectors({ body }, { body: { id: 'earth' } })).toBe(false)
    expect(propsEqualWithVectors({ ids: ['a'] }, { ids: ['a'] })).toBe(false)
    expect(propsEqualWithVectors({ n: Number.NaN }, { n: Number.NaN })).toBe(true)
  })

  it('detects added or removed props', () => {
    const loose = propsEqualWithVectors<Record<string, unknown>>
    expect(loose({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(loose({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false)
  })
})
