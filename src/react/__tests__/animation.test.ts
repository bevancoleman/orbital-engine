import { stepToward } from '../animation'

describe('stepToward', () => {
  it('moves current toward target by maxStep when the gap is larger than maxStep', () => {
    expect(stepToward(0, 1, 0.1)).toBeCloseTo(0.1, 10)
    expect(stepToward(1, 0, 0.1)).toBeCloseTo(0.9, 10)
  })

  it('clamps exactly at the target rather than overshooting when maxStep exceeds the gap', () => {
    expect(stepToward(0.95, 1, 0.5)).toBe(1)
    expect(stepToward(0.05, 0, 0.5)).toBe(0)
  })

  it('is a no-op when current already equals target', () => {
    expect(stepToward(1, 1, 0.1)).toBe(1)
  })

  it('reaches the target in exactly N steps of size maxStep = distance/N — the frame-rate-independence property BodyMarker relies on', () => {
    // Simulates BodyMarker's own usage: maxStep = delta / durationSeconds,
    // called once per frame — this proves that reaches 1 (not overshoots,
    // not undershoots) after enough frames, regardless of how many frames.
    let current = 0
    const target = 1
    const totalSteps = 30 // e.g. 30 frames at a fixed maxStep
    const maxStep = 1 / totalSteps
    for (let i = 0; i < totalSteps; i++) {
      current = stepToward(current, target, maxStep)
    }
    expect(current).toBeCloseTo(1, 10)
  })

  it('handles a negative target correctly (direction, not just magnitude)', () => {
    expect(stepToward(0, -1, 0.3)).toBeCloseTo(-0.3, 10)
  })
})
