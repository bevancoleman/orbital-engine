import {
  DEFAULT_DAYS_PER_SECOND,
  MAX_DAYS_PER_SECOND,
  MAX_HOURS_PER_SECOND,
  REAL_TIME_DAYS_PER_SECOND,
  clampPlaybackSpeed,
  formatPlaybackSpeed,
} from '../timeScale'

describe('time scale constants', () => {
  it('real-time is exactly one simulated second per real second', () => {
    expect(REAL_TIME_DAYS_PER_SECOND * 86_400).toBeCloseTo(1, 10)
  })

  it('max is exactly MAX_HOURS_PER_SECOND (6h/s), not the old one-year-per-minute value', () => {
    // Real, deliberate change: the old max (365.25/60 ≈ 6.1 d/s = ~146
    // h/s) let a fast/close orbiter's own flight develop genuine,
    // hard-to-smooth curvature spikes (measured directly on the fixed
    // camera-route fixture) — MAX_HOURS_PER_SECOND=6 is anchored instead
    // to what this engine's own 60fps camera math can render smoothly,
    // split between Phobos (~7.65h period) and the ISS (~1.55h period) —
    // see that constant's own comment in timeScale.ts.
    expect(MAX_HOURS_PER_SECOND).toBe(6)
    expect(MAX_DAYS_PER_SECOND * 24).toBeCloseTo(MAX_HOURS_PER_SECOND, 10)
  })

  it('default sits comfortably inside the range, closer to the slow end', () => {
    expect(DEFAULT_DAYS_PER_SECOND).toBeGreaterThan(REAL_TIME_DAYS_PER_SECOND)
    expect(DEFAULT_DAYS_PER_SECOND).toBeLessThan(MAX_DAYS_PER_SECOND)
  })
})

describe('clampPlaybackSpeed', () => {
  it('caps a too-fast request at MAX_DAYS_PER_SECOND', () => {
    expect(clampPlaybackSpeed(1000)).toBe(MAX_DAYS_PER_SECOND)
  })

  it('floors a too-slow (or negative) request at REAL_TIME_DAYS_PER_SECOND', () => {
    expect(clampPlaybackSpeed(-5)).toBe(REAL_TIME_DAYS_PER_SECOND)
    expect(clampPlaybackSpeed(0)).toBe(REAL_TIME_DAYS_PER_SECOND)
  })

  it('leaves an already-in-range request untouched', () => {
    expect(clampPlaybackSpeed(DEFAULT_DAYS_PER_SECOND)).toBe(DEFAULT_DAYS_PER_SECOND)
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
    // A literal value, not MAX_DAYS_PER_SECOND — MAX is now 0.25 d/s (see
    // MAX_HOURS_PER_SECOND's own comment), comfortably under 1, so this
    // branch needs its own value to stay exercised at all.
    expect(formatPlaybackSpeed(6.1)).toBe('6.1 d/s')
  })

  it('formats the actual max speed (now well under 1 d/s) the same way any other sub-1 speed reads', () => {
    expect(formatPlaybackSpeed(MAX_DAYS_PER_SECOND)).toBe('1 day / 4.0s')
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
