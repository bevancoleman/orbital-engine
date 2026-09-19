import { distanceToSliderPosition, sliderPositionToDistance } from '../zoomSlider'

const MIN = 0.015
const MAX = 2000

describe('sliderPositionToDistance', () => {
  it('maps 0 to the minimum distance', () => {
    expect(sliderPositionToDistance(0, MIN, MAX)).toBeCloseTo(MIN, 10)
  })

  it('maps 1 to the maximum distance', () => {
    expect(sliderPositionToDistance(1, MIN, MAX)).toBeCloseTo(MAX, 5)
  })

  it('maps 0.5 to the geometric mean, not the arithmetic mean — logarithmic, not linear', () => {
    const mid = sliderPositionToDistance(0.5, MIN, MAX)
    expect(mid).toBeCloseTo(Math.sqrt(MIN * MAX), 6)
    // The arithmetic mean would be ~1000 — wildly different, confirming
    // this isn't a linear mapping.
    expect(mid).toBeLessThan((MIN + MAX) / 100)
  })

  it('is monotonically increasing', () => {
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
    for (let i = 1; i < samples.length; i++) {
      expect(sliderPositionToDistance(samples[i]!, MIN, MAX)).toBeGreaterThan(
        sliderPositionToDistance(samples[i - 1]!, MIN, MAX)
      )
    }
  })

  it('clamps a position outside [0, 1]', () => {
    expect(sliderPositionToDistance(-0.5, MIN, MAX)).toBeCloseTo(MIN, 10)
    expect(sliderPositionToDistance(1.5, MIN, MAX)).toBeCloseTo(MAX, 5)
  })
})

describe('distanceToSliderPosition', () => {
  it('maps the minimum distance to 0', () => {
    expect(distanceToSliderPosition(MIN, MIN, MAX)).toBeCloseTo(0, 10)
  })

  it('maps the maximum distance to 1', () => {
    expect(distanceToSliderPosition(MAX, MIN, MAX)).toBeCloseTo(1, 10)
  })

  it('clamps a distance outside [min, max]', () => {
    expect(distanceToSliderPosition(MIN / 10, MIN, MAX)).toBeCloseTo(0, 10)
    expect(distanceToSliderPosition(MAX * 10, MIN, MAX)).toBeCloseTo(1, 10)
  })

  it('is the exact inverse of sliderPositionToDistance', () => {
    for (const position of [0, 0.1, 0.33, 0.5, 0.75, 1]) {
      const distance = sliderPositionToDistance(position, MIN, MAX)
      expect(distanceToSliderPosition(distance, MIN, MAX)).toBeCloseTo(position, 8)
    }
  })
})
