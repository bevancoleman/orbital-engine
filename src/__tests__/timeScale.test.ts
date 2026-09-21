import { DEFAULT_DAYS_PER_SECOND, MAX_DAYS_PER_SECOND, REAL_TIME_DAYS_PER_SECOND, formatPlaybackSpeed } from '../timeScale'

describe('time scale constants', () => {
  it('real-time is exactly one simulated second per real second', () => {
    expect(REAL_TIME_DAYS_PER_SECOND * 86_400).toBeCloseTo(1, 10)
  })

  it('max is exactly one simulated year every 60 real seconds', () => {
    expect(MAX_DAYS_PER_SECOND * 60).toBeCloseTo(365.25, 10)
  })

  it('default sits comfortably inside the range, closer to the slow end', () => {
    expect(DEFAULT_DAYS_PER_SECOND).toBeGreaterThan(REAL_TIME_DAYS_PER_SECOND)
    expect(DEFAULT_DAYS_PER_SECOND).toBeLessThan(MAX_DAYS_PER_SECOND)
  })
})

describe('formatPlaybackSpeed', () => {
  it('labels real-time explicitly rather than showing a wall of leading zeros', () => {
    expect(formatPlaybackSpeed(REAL_TIME_DAYS_PER_SECOND)).toBe('real-time')
  })

  it('formats the default speed as plain days/second', () => {
    expect(formatPlaybackSpeed(1)).toBe('1.0 d/s')
  })

  it('formats speeds above 1 d/s as plain days/second', () => {
    expect(formatPlaybackSpeed(MAX_DAYS_PER_SECOND)).toBe('6.1 d/s')
  })

  it('formats sub-1 speeds as how many real seconds one simulated day takes', () => {
    expect(formatPlaybackSpeed(0.2)).toBe('1 day / 5.0s')
    expect(formatPlaybackSpeed(0.5)).toBe('1 day / 2.0s')
  })

  it('rounds to a whole number of seconds once it gets slow enough to be unwieldy as a decimal', () => {
    expect(formatPlaybackSpeed(0.01)).toBe('1 day / 100s')
  })

  it('is continuous approaching the real-time boundary from above', () => {
    const justAboveRealTime = REAL_TIME_DAYS_PER_SECOND * 1.5
    expect(formatPlaybackSpeed(justAboveRealTime)).not.toBe('real-time')
    expect(formatPlaybackSpeed(justAboveRealTime)).toMatch(/^1 day \/ \d+s$/)
  })
})
