import { formatDistanceKm } from '../units'

describe('formatDistanceKm', () => {
  it('formats sub-1000km distances in km', () => {
    expect(formatDistanceKm(42)).toBe('42.00 km')
  })

  it('formats 1000km+ distances in Mm', () => {
    expect(formatDistanceKm(12_400)).toBe('12.40 Mm')
  })

  it('formats 1,000,000km+ distances in Gm', () => {
    expect(formatDistanceKm(3_200_000)).toBe('3.20 Gm')
  })

  it('is continuous at the km/Mm boundary', () => {
    expect(formatDistanceKm(999)).toBe('999.00 km')
    expect(formatDistanceKm(1000)).toBe('1.00 Mm')
  })

  it('is continuous at the Mm/Gm boundary', () => {
    expect(formatDistanceKm(999_999)).toBe('1000.00 Mm')
    expect(formatDistanceKm(1_000_000)).toBe('1.00 Gm')
  })

  it('handles negative distances (offsets) by unit magnitude, not just absolute position', () => {
    expect(formatDistanceKm(-5_000)).toBe('-5.00 Mm')
  })

  it('respects a custom digit count', () => {
    expect(formatDistanceKm(12_345, 0)).toBe('12 Mm')
  })
})
