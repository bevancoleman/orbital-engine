/**
 * The pure pacing math behind a fly-to: the van Wijk & Nuij (2003)
 * zoom-and-pan path, the ease-in-out timing over it, and the duration
 * derived from its length. See flightSmoothness.test.ts for the same math
 * exercised end to end over real Solar System routes.
 */

import {
  DEFAULT_FLIGHT_PACING,
  FLIGHT_PATH_SPEED,
  FLIGHT_PEAK_TURN_DEG_PER_SECOND,
  FLIGHT_TURN_DEG_PER_SECOND,
  FLIGHT_VIEW_WIDTH_PER_DISTANCE,
  FLIGHT_ZOOM_RHO,
  flightDurationMs,
  flightPathLength,
  planFocusFlight,
  sampleFlightFrame,
  smoothstep,
  trajectorySamplesFor,
  zoomPanPath,
} from '../camera'
import type { FocusTarget } from '../camera'
import type { WorldVec } from '../render'
import { angleBetweenDeg, subtractVec3 } from '../vec3'

const RHO = FLIGHT_ZOOM_RHO

describe('smoothstep — the flight\'s ease-in-out timing', () => {
  it('runs from exactly 0 to exactly 1, clamped outside [0, 1]', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(-3)).toBe(0)
    expect(smoothstep(4)).toBe(1)
  })

  it('is symmetric about the midpoint (accelerates as much as it decelerates)', () => {
    for (const t of [0.1, 0.25, 0.4]) expect(smoothstep(t) + smoothstep(1 - t)).toBeCloseTo(1, 12)
  })

  it('starts and ends at zero velocity, peaking at 1.5x the average in the middle', () => {
    const slope = (t: number): number => (smoothstep(t + 1e-6) - smoothstep(t - 1e-6)) / 2e-6
    expect(Math.abs(slope(1e-6))).toBeLessThan(1e-4)
    expect(Math.abs(slope(1 - 1e-6))).toBeLessThan(1e-4)
    expect(slope(0.5)).toBeCloseTo(1.5, 6)
  })

  it('is NOT front-loaded: a quarter of the time covers well under a quarter of the way', () => {
    expect(smoothstep(0.25)).toBeLessThan(0.2)
  })
})

describe('zoomPanPath — van Wijk & Nuij optimal zoom-and-pan', () => {
  it('starts exactly at the start width with no pan, and ends exactly at the end width fully panned', () => {
    const path = zoomPanPath(10, 1, 0.01)
    expect(path.at(0)).toEqual({ pan: 0, width: 1 })
    expect(path.at(1)).toEqual({ pan: 1, width: 0.01 })
  })

  it('matches the paper\'s closed-form length for a short hop at equal widths (w0 = w1)', () => {
    const u = 0.3
    const w = 1
    expect(zoomPanPath(u, w, w).length).toBeCloseTo((2 * Math.asinh((RHO * RHO * u) / (2 * w))) / RHO, 10)
  })

  it('zooms out mid-flight on a long hop at equal widths, symmetrically, then back in', () => {
    const path = zoomPanPath(1000, 1, 1)
    const mid = path.at(0.5)
    expect(mid.pan).toBeCloseTo(0.5, 9)
    // Peak width ≈ the whole pan distance for ρ = √2 — both ends visible.
    expect(mid.width).toBeGreaterThan(900)
    expect(path.at(0.3).width).toBeCloseTo(path.at(0.7).width, 6)
  })

  it('treats a negligible pan as a pure zoom: geometric width, length |ln(w1/w0)|/ρ', () => {
    const path = zoomPanPath(0, 1e-6, 10)
    expect(path.length).toBeCloseTo(Math.log(1e7) / RHO, 10)
    expect(path.at(0.5).width).toBeCloseTo(Math.sqrt(1e-6 * 10), 12)
    expect(path.at(0.5).pan).toBeCloseTo(0.5, 12)
    // Same in the other direction (zooming in).
    expect(zoomPanPath(0, 10, 1e-6).length).toBeCloseTo(Math.log(1e7) / RHO, 10)
  })

  it('has zero length for no pan and no zoom (e.g. re-framing a body from where the camera already is)', () => {
    const path = zoomPanPath(0, 2, 2)
    expect(path.length).toBe(0)
    expect(path.at(0.5)).toEqual({ pan: 0.5, width: 2 })
  })

  it('degrades to a plain blend, not NaN, for a zero-width end (camera exactly on its target)', () => {
    const path = zoomPanPath(1, 0, 2)
    expect(path.length).toBe(0)
    expect(path.at(0.5)).toEqual({ pan: 0.5, width: 1 })
  })

  it('stays numerically sane across true-scale dynamic range (ISS close-up to an interplanetary pan)', () => {
    const path = zoomPanPath(39.3, 3.5e-6, 0.096)
    expect(Number.isFinite(path.length)).toBe(true)
    for (let i = 0; i <= 100; i++) {
      const { pan, width } = path.at(i / 100)
      expect(Number.isFinite(pan) && Number.isFinite(width)).toBe(true)
      expect(width).toBeGreaterThan(0)
      expect(pan).toBeGreaterThanOrEqual(0)
      expect(pan).toBeLessThanOrEqual(1)
    }
  })

  it('pans monotonically and never steps the log-width faster than ρ per unit of path length', () => {
    const path = zoomPanPath(5, 0.001, 0.2)
    const n = 2000
    let previous = path.at(0)
    for (let i = 1; i <= n; i++) {
      const next = path.at(i / n)
      expect(next.pan).toBeGreaterThanOrEqual(previous.pan - 1e-12)
      const logStep = Math.abs(Math.log(next.width / previous.width))
      expect(logStep).toBeLessThanOrEqual((RHO * path.length) / n + 1e-9)
      previous = next
    }
  })

  // The "destination stays in view" guarantee, in the path's own terms:
  // the remaining pan measured in view widths only ever shrinks, so once
  // the destination is inside the view it can never drift back out.
  it('only ever shrinks the remaining pan relative to the view width', () => {
    for (const [u, w0, w1] of [
      [0.35, 0.0134, 1.7e-6],
      [0.0108, 1.7e-6, 1.7e-6],
      [39, 1.7e-6, 0.045],
      [97, 3.4, 6.3],
    ] as const) {
      const path = zoomPanPath(u, w0, w1)
      let previous = Infinity
      for (let i = 0; i <= 500; i++) {
        const { pan, width } = path.at(i / 500)
        const remaining = ((1 - pan) * u) / width
        expect(remaining).toBeLessThanOrEqual(previous * (1 + 1e-9) + 1e-12)
        previous = remaining
      }
    }
  })
})

describe('flightPathLength', () => {
  it('measures the zoom-and-pan path between two camera/target pairs, in view widths', () => {
    const k = FLIGHT_VIEW_WIDTH_PER_DISTANCE
    const length = flightPathLength([0, 0, 1], [0, 0, 0], [5, 0, 2], [5, 0, 0])
    expect(length).toBeCloseTo(zoomPanPath(5, 1 * k, 2 * k).length, 12)
  })
})

describe('flightDurationMs — perceptually constant speed, clamped', () => {
  const at = (target: WorldVec, distance: number, direction: WorldVec = [0, 0, 1]) => ({
    position: [target[0] + direction[0] * distance, target[1] + direction[1] * distance, target[2] + direction[2] * distance] as WorldVec,
    target,
  })
  const flight = (a: ReturnType<typeof at>, b: ReturnType<typeof at>) => ({
    startPosition: a.position,
    startTarget: a.target,
    endPosition: b.position,
    endTarget: b.target,
  })

  it('defaults to a 1.2s minimum and a 5s maximum', () => {
    // 5s since satellites can be framed up close: a hop between two of
    // them now spans enough zoom that 4s squeezed its mid-flight turn past
    // the smoothness ceiling (see FLIGHT_PEAK_TURN_DEG_PER_SECOND).
    expect(DEFAULT_FLIGHT_PACING).toEqual({ speed: 1, minMs: 1200, maxMs: 5000 })
  })

  it('never goes below the minimum, even for a flight that goes nowhere', () => {
    const here = at([0, 0, 0], 1)
    expect(flightDurationMs(flight(here, here))).toBe(1200)
  })

  it('is proportional to the path length between the clamps', () => {
    const a = flightDurationMs(flight(at([0, 0, 0], 1e-4), at([0.01, 0, 0], 1e-4)))
    const length = flightPathLength(at([0, 0, 0], 1e-4).position, [0, 0, 0], at([0.01, 0, 0], 1e-4).position, [0.01, 0, 0])
    expect(a).toBeCloseTo((length / FLIGHT_PATH_SPEED) * 1000, 6)
  })

  it('caps at the maximum for an enormous path', () => {
    expect(flightDurationMs(flight(at([0, 0, 0], 1e-9), at([1000, 0, 0], 1e-9)))).toBe(5000)
  })

  it('gives a turn concentrated mid-flight enough time at its fastest, not just on average', () => {
    // A context body to keep in frame makes the path swing out and back:
    // planned with it, the flight is never faster than the peak-turn rule.
    const start = at([0, 0, 0], 1e-6, [0, 0, 1])
    const end = at([0.002, 0, 0], 1e-6, [0, 1, 0])
    const contextBody = { position: [0.001, -0.01, 0] as WorldVec, radius: 0.005 }
    const withContext = flightDurationMs({ ...flight(start, end), contextBody })
    expect(withContext).toBeGreaterThanOrEqual(flightDurationMs(flight(start, end)))
    const endpoints = { ...flight(start, end), contextBody, predictedTargetAt: null }
    const frames = Math.round((withContext / 1000) * 60)
    let worst = 0
    for (let i = 1; i <= frames; i++) {
      const a = sampleFlightFrame(endpoints, (i - 1) / frames)
      const b = sampleFlightFrame(endpoints, i / frames)
      worst = Math.max(worst, angleBetweenDeg(subtractVec3(a.target, a.position), subtractVec3(b.target, b.position)))
    }
    expect(worst).toBeLessThanOrEqual(FLIGHT_PEAK_TURN_DEG_PER_SECOND / 60 + 0.1)
  })

  it('gives a big view turn enough time even when the path itself is short', () => {
    const ms = flightDurationMs(flight(at([0, 0, 0], 1, [0, 0, 1]), at([0, 0, 0], 1, [0, 0, -1])))
    expect(ms).toBeCloseTo((180 / FLIGHT_TURN_DEG_PER_SECOND) * 1000, 6)
  })

  it('scales with pacing: speed 2 halves it, and custom clamps apply', () => {
    const f = flight(at([0, 0, 0], 1e-4), at([0.01, 0, 0], 1e-4))
    expect(flightDurationMs(f, { speed: 2, minMs: 1 })).toBeCloseTo(flightDurationMs(f) / 2, 6)
    expect(flightDurationMs(f, { minMs: 5000, maxMs: 6000 })).toBe(5000)
    expect(flightDurationMs(f, { maxMs: 500, minMs: 100 })).toBe(500)
  })

  it('falls back to the defaults for nonsensical pacing values instead of returning NaN', () => {
    const f = flight(at([0, 0, 0], 1e-4), at([0.01, 0, 0], 1e-4))
    expect(flightDurationMs(f, { speed: 0 })).toBe(flightDurationMs(f))
    expect(flightDurationMs(f, { speed: Number.NaN, minMs: -1, maxMs: Number.NaN })).toBe(flightDurationMs(f))
  })
})

describe('trajectorySamplesFor', () => {
  it('samples a flight once per 60fps frame of its own duration, never fewer than one', () => {
    expect(trajectorySamplesFor(900)).toBe(54)
    expect(trajectorySamplesFor(2500)).toBe(150)
    expect(trajectorySamplesFor(0)).toBe(1)
  })
})

describe('planFocusFlight — duration first, then the arrival prediction for that duration', () => {
  const pose = { position: [0, 0, 1e-4] as WorldVec, target: [0, 0, 0] as WorldVec }
  /** A destination moving along +x at `speed` world units per real ms. */
  const movingFocus = (speed: number) => {
    const calls: number[] = []
    const focusAt = (durationMs: number): FocusTarget => {
      calls.push(durationMs)
      return { position: [1 + speed * durationMs, 0, 0], distance: 1e-4, lookBias: null, contextBody: null }
    }
    return { focusAt, calls }
  }

  it('predicts the arrival for exactly the duration it returns', () => {
    const { focusAt, calls } = movingFocus(1e-3)
    const focus = planFocusFlight(focusAt, pose)
    expect(focus.position[0]).toBeCloseTo(1 + 1e-3 * focus.flightDurationMs!, 9)
    expect(calls[0]).toBe(0) // the destination as it is right now, first
  })

  it('re-predicts once when the predicted arrival moves the duration', () => {
    const { focusAt, calls } = movingFocus(1)
    const focus = planFocusFlight(focusAt, pose)
    expect(calls).toHaveLength(3)
    expect(focus.position[0]).toBe(1 + focus.flightDurationMs!)
  })

  it('skips the second prediction for a destination that isn\'t moving', () => {
    const { focusAt, calls } = movingFocus(0)
    planFocusFlight(focusAt, pose)
    expect(calls).toHaveLength(2)
  })

  it('plans the minimum duration before any camera pose exists', () => {
    const { focusAt } = movingFocus(0)
    expect(planFocusFlight(focusAt, null).flightDurationMs).toBe(DEFAULT_FLIGHT_PACING.minMs)
    expect(planFocusFlight(focusAt, null, { minMs: 2000 }).flightDurationMs).toBe(2000)
  })

  it('honours pacing', () => {
    const { focusAt } = movingFocus(0)
    const normal = planFocusFlight(focusAt, pose).flightDurationMs!
    expect(planFocusFlight(focusAt, pose, { speed: 2, minMs: 1 }).flightDurationMs).toBeCloseTo(normal / 2, 6)
  })
})
