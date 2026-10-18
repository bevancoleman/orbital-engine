import { jest } from '@jest/globals'
import { createDisposingLru, createRefCounter } from '../resourceCache'

function fakeResource(name: string): { name: string; dispose: jest.Mock } {
  return { name, dispose: jest.fn() }
}

describe('createDisposingLru', () => {
  it('builds a value once per key and returns the cached one after', () => {
    const lru = createDisposingLru<ReturnType<typeof fakeResource>>(4)
    const build = jest.fn(() => fakeResource('a'))
    const first = lru.getOrCreate('a', build)
    const second = lru.getOrCreate('a', build)
    expect(second).toBe(first)
    expect(build).toHaveBeenCalledTimes(1)
    expect(lru.size).toBe(1)
  })

  it('evicts and disposes the least-recently-used entry once over capacity', () => {
    const lru = createDisposingLru<ReturnType<typeof fakeResource>>(2)
    const a = lru.getOrCreate('a', () => fakeResource('a'))
    const b = lru.getOrCreate('b', () => fakeResource('b'))
    // Touch a, so b becomes the oldest.
    lru.getOrCreate('a', () => fakeResource('a2'))
    lru.getOrCreate('c', () => fakeResource('c'))
    expect(lru.size).toBe(2)
    expect(b.dispose).toHaveBeenCalledTimes(1)
    expect(a.dispose).not.toHaveBeenCalled()
    // b is rebuilt fresh on next request.
    const b2 = lru.getOrCreate('b', () => fakeResource('b2'))
    expect(b2.name).toBe('b2')
    expect(a.dispose).toHaveBeenCalledTimes(1)
  })

  it('clear disposes everything', () => {
    const lru = createDisposingLru<ReturnType<typeof fakeResource>>(3)
    const a = lru.getOrCreate('a', () => fakeResource('a'))
    const b = lru.getOrCreate('b', () => fakeResource('b'))
    lru.clear()
    expect(lru.size).toBe(0)
    expect(a.dispose).toHaveBeenCalledTimes(1)
    expect(b.dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-positive capacity', () => {
    expect(() => createDisposingLru(0)).toThrow()
  })
})

describe('createRefCounter', () => {
  it('reports the last release of a key, and only that one', () => {
    const refs = createRefCounter()
    refs.acquire('earth.jpg')
    refs.acquire('earth.jpg')
    expect(refs.release('earth.jpg')).toBe(false)
    expect(refs.count('earth.jpg')).toBe(1)
    expect(refs.release('earth.jpg')).toBe(true)
    expect(refs.count('earth.jpg')).toBe(0)
  })

  it('treats releasing an unheld key as a no-op, not a last release', () => {
    const refs = createRefCounter()
    expect(refs.release('never')).toBe(false)
  })
})
