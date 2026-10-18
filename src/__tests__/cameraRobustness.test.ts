/**
 * Continuity and degenerate-input guards for camera.ts's flight/tracking
 * math — each describe pins down one specific, previously-found way a
 * function could jump discontinuously or return NaN, so a later change
 * can't quietly reintroduce it. See camera.test.ts for the main behaviour
 * suite.
 */

import {
  DEFAULT_VIEW_DIRECTION,
  adaptiveSmoothingRadius,
  applyContextBulge,
  computeColliderBodies,
  computeSmoothedTrackedPosition,
  distanceToFit,
  keepClearOfContextBody,
  naturalFlightOffset,
  predictBodyTrajectory,
  safePredictFlightTarget,
  sampleFlightPath,
  smoothTrajectory,
  trajectoryDiameter,
} from '../camera'
import { resolveWorldPosition, type WorldVec } from '../render'
import { simulateCameraRoute } from '../routeCameraSimulator'
import { CAMERA_ROUTE_FIXTURE_SYSTEM, CAMERA_ROUTE_START_DATE } from '../fixtures/cameraRouteFixture'
import type { CelestialBody, OrbitalElements, StarSystemData } from '../types'

const DATE = new Date('2026-01-01T00:00:00Z')

function subtract(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function angleDeg(a: WorldVec, b: WorldVec): number {
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId'>): CelestialBody {
  return {
    name: overrides.id,
    type: 'station',
    radiusKm: 5,
    orbit: null,
    fixedPosition: { xKm: 0, yKm: 0, zKm: 0 },
    ...overrides,
  }
}

function epicycleSystem(): StarSystemData {
  const planetOrbit: OrbitalElements = {
    semiMajorAxisKm: 150_000_000,
    eccentricity: 0,
    inclinationDeg: 0,
    longitudeOfAscendingNodeDeg: 0,
    argumentOfPeriapsisDeg: 0,
    meanAnomalyAtEpochDeg: 0,
    orbitalPeriodDays: 200,
    epoch: DATE.toISOString(),
  }
  const moonOrbit: OrbitalElements = {
    semiMajorAxisKm: 30_000,
    eccentricity: 0,
    inclinationDeg: 5,
    longitudeOfAscendingNodeDeg: 0,
    argumentOfPeriapsisDeg: 0,
    meanAnomalyAtEpochDeg: 0,
    orbitalPeriodDays: 0.31891,
    epoch: DATE.toISOString(),
  }
  return {
    id: 'test',
    name: 'Test',
    bodies: [
      body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
      { ...body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_000, fixedPosition: undefined }), orbit: planetOrbit },
      { ...body({ id: 'moon', parentId: 'planet', type: 'moon', radiusKm: 400, fixedPosition: undefined }), orbit: moonOrbit },
    ],
  }
}

describe('DEFAULT_VIEW_DIRECTION', () => {
  it('is genuinely unit length and points along the initial [0, 60, 120] camera offset', () => {
    expect(Math.hypot(...DEFAULT_VIEW_DIRECTION)).toBeCloseTo(1, 12)
    expect(angleDeg(DEFAULT_VIEW_DIRECTION, [0, 60, 120])).toBeCloseTo(0, 4)
  })
})

describe('applyContextBulge — continuity across the "already fits" crossover', () => {
  // Real, measured bug: the bulge used to return pathPosition untouched
  // whenever the context body already fit, and otherwise a position whose
  // DIRECTION was already rotated by the full bump — so at the exact
  // crossover (needed distance == natural distance) the distance matched
  // but the direction snapped, a ~29° view jump in a single frame on an
  // ISS/Hubble-style flight past Earth.
  const contextBody = { position: [0, 0, 0] as WorldVec, radius: 0.0055 }
  const startPosition: WorldVec = [0.0059, 5, 0]
  const startTarget: WorldVec = [0.0059, 0, 0]
  const endTarget: WorldVec = [-0.006, 1e-4, 0]
  const endPosition: WorldVec = [-0.006, 1e-4 + 1e-6, 0]

  function viewDirectionAt(t: number): WorldVec {
    const path = sampleFlightPath(startPosition, startTarget, endPosition, endTarget, t)
    const target = keepClearOfContextBody(path.target, contextBody)
    const position = applyContextBulge(path.position, startPosition, startTarget, endPosition, endTarget, target, contextBody, t)
    return subtract(target, position)
  }

  it('never turns the view by more than a fraction of a degree between finely-spaced samples', () => {
    // 100x the real 60fps frame density: a genuine discontinuity shows up
    // as the same large jump at ANY sample density, while smooth motion's
    // per-sample change shrinks proportionally.
    const samples = 5400
    let worst = 0
    let previous = viewDirectionAt(0)
    for (let i = 1; i <= samples; i++) {
      const current = viewDirectionAt(i / samples)
      worst = Math.max(worst, angleDeg(previous, current))
      previous = current
    }
    expect(worst).toBeLessThan(1)
  })
})

describe('naturalFlightOffset — exactly antipodal start/end directions', () => {
  // slerp's "relative" axis (b minus its projection on a) is the zero
  // vector when a and b are exactly opposite; the old fallback reused b
  // itself as that axis, so the blended direction collapsed through zero
  // length and overshot to ~1.41 instead of tracing a great circle.
  it('keeps the blended direction unit length at every t', () => {
    for (const t of [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
      const { direction } = naturalFlightOffset([0, 0, 1], [0, 0, 0], [0, 0, -1], [0, 0, 0], t)
      expect(Math.hypot(...direction)).toBeCloseTo(1, 9)
    }
  })

  it('passes through a direction perpendicular to both endpoints partway through', () => {
    let closestToPerpendicular = Infinity
    for (let i = 1; i < 100; i++) {
      const { direction } = naturalFlightOffset([0, 0, 1], [0, 0, 0], [0, 0, -1], [0, 0, 0], i / 100)
      closestToPerpendicular = Math.min(closestToPerpendicular, Math.abs(direction[2]))
    }
    expect(closestToPerpendicular).toBeLessThan(0.05)
  })
})

describe('trajectory sample-count guards', () => {
  const system = epicycleSystem()
  const moon = system.bodies.find((b) => b.id === 'moon')!

  it('rejects a zero or fractional sample count with a clear error instead of NaN dates', () => {
    expect(() => predictBodyTrajectory(moon, system, DATE, 1, 900, 0)).toThrow(RangeError)
    expect(() => predictBodyTrajectory(moon, system, DATE, 1, 900, 2.5)).toThrow(RangeError)
    expect(() => safePredictFlightTarget(moon, system, DATE, 1, 1, 900, 0)).toThrow(RangeError)
  })

  it('still works with a single sample (two points — both ends of the flight)', () => {
    expect(predictBodyTrajectory(moon, system, DATE, 1, 900, 1)).toHaveLength(2)
  })

  it('rejects a zero samplesPerFlight in the route simulator', () => {
    expect(() =>
      simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['planetA'], CAMERA_ROUTE_START_DATE, { samplesPerFlight: 0 })
    ).toThrow(RangeError)
  })
})

describe('non-finite radius guards', () => {
  it('distanceToFit falls back to its floor for a NaN radius instead of returning NaN', () => {
    expect(Number.isFinite(distanceToFit(NaN))).toBe(true)
    expect(distanceToFit(NaN)).toBe(distanceToFit(0))
  })

  it('computeColliderBodies never hands CameraRig a NaN collider radius', () => {
    const system: StarSystemData = {
      id: 'test',
      name: 'Test',
      bodies: [{ ...body({ id: 'odd', parentId: null }), radiusKm: Number.NaN }],
    }
    expect(computeColliderBodies(system, DATE)[0]!.radius).toBe(0)
  })
})

describe('smoothTrajectory / adaptiveSmoothingRadius — prefix-sum rewrite matches the plain moving average', () => {
  function naiveSmooth(points: WorldVec[], radius: number): WorldVec[] {
    return points.map((_, i) => {
      const lo = Math.max(0, i - radius)
      const hi = Math.min(points.length - 1, i + radius)
      const sum: WorldVec = [0, 0, 0]
      for (let k = lo; k <= hi; k++) for (let c = 0; c < 3; c++) sum[c]! += points[k]![c]!
      const n = hi - lo + 1
      return [sum[0] / n, sum[1] / n, sum[2] / n]
    })
  }
  const points: WorldVec[] = Array.from({ length: 40 }, (_, i) => [Math.sin(i * 0.7) * 3, Math.cos(i * 0.3), i * 0.1])

  it('gives the same result as a direct per-point average for every integer radius', () => {
    for (const radius of [0, 1, 3, 7, 50]) {
      const fast = smoothTrajectory(points, radius)
      const slow = naiveSmooth(points, radius)
      fast.forEach((p, i) => p.forEach((v, c) => expect(v).toBeCloseTo(slow[i]![c]!, 9)))
    }
  })

  it('blends the two neighbouring integer windows for a fractional radius', () => {
    const blended = smoothTrajectory(points, 2.25)
    const lo = naiveSmooth(points, 2)
    const hi = naiveSmooth(points, 3)
    blended.forEach((p, i) => p.forEach((v, c) => expect(v).toBeCloseTo(lo[i]![c]! * 0.75 + hi[i]![c]! * 0.25, 9)))
  })

  it('returns a radius whose smoothed points never stray past the lag limit', () => {
    for (const viewingDistance of [0.5, 1, 2, 5, 20]) {
      const radius = adaptiveSmoothingRadius(points, 7, viewingDistance)
      const smoothed = smoothTrajectory(points, radius)
      const worst = Math.max(...smoothed.map((p, i) => Math.hypot(...subtract(p, points[i]!))))
      expect(worst).toBeLessThanOrEqual(0.15 * viewingDistance + 1e-12)
    }
  })

  it('trajectoryDiameter still reports the true largest pairwise distance', () => {
    expect(trajectoryDiameter([[0, 0, 0], [1, 0, 0], [0.5, 0.2, 0], [0, 0, 0]])).toBeCloseTo(1, 12)
    expect(trajectoryDiameter([[0, 0, 0]])).toBe(0)
  })
})

describe('adaptive smoothing — no step jumps as the affordable window shrinks', () => {
  // Real, measured bug: the adaptive window radius used to be an integer
  // step function of the viewing distance (and of time, as the body's own
  // excursions change frame to frame), so each flip between radius r and
  // r-1 jumped the tracked position by a sizeable fraction of the viewing
  // distance in a single frame. Exercised on a sharply curved synthetic
  // path (a circle sampled coarsely), where neighbouring window sizes
  // genuinely disagree about the smoothed midpoint.
  const points: WorldVec[] = Array.from({ length: 15 }, (_, i) => [Math.cos((i - 7) * 0.3), Math.sin((i - 7) * 0.3), 0])
  const smoothedMidpoint = (viewingDistance: number): WorldVec =>
    smoothTrajectory(points, adaptiveSmoothingRadius(points, 7, viewingDistance))[7]!

  it('moves the smoothed midpoint continuously as the viewing distance changes', () => {
    const steps = 4000
    let previous = smoothedMidpoint(0.01)
    let worstJumpFraction = 0
    for (let i = 1; i <= steps; i++) {
      const viewingDistance = 0.01 * Math.pow(1000, i / steps) // 0.01 .. 10, geometric
      const current = smoothedMidpoint(viewingDistance)
      worstJumpFraction = Math.max(worstJumpFraction, Math.hypot(...subtract(current, previous)) / viewingDistance)
      previous = current
    }
    // A radius flip shows up as a jump of several percent of the viewing
    // distance; continuous blending keeps each tiny step well under 1%.
    expect(worstJumpFraction).toBeLessThan(0.01)
  })

  it('still reproduces the raw position exactly when no smoothing is affordable', () => {
    const system = epicycleSystem()
    const moon = system.bodies.find((b) => b.id === 'moon')!
    const raw = resolveWorldPosition(moon, system.bodies, DATE)
    const smoothed = computeSmoothedTrackedPosition(moon, system, DATE, 6 / 24, 1e-12)
    smoothed.forEach((v, c) => expect(v).toBeCloseTo(raw[c]!, 12))
  })
})

describe('simulateCameraRoute — flight framing measured at each sample\'s real moment', () => {
  // With a nonzero flightDaysPerSecond, the body (and its parent) keep
  // moving during the flight; framing used to be scored against the
  // body's fixed ARRIVAL position and the parent's leg-START position for
  // every flight frame. Each flight frame now carries its own sim date.
  it('advances each flight frame\'s simDate from the leg start to the predicted arrival', () => {
    const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['moonA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: 10,
      trackSteps: 1,
      trackStepMs: 0,
      flightDaysPerSecond: 1,
    })
    const flight = frames.filter((f) => f.phase === 'flight')
    const times = flight.map((f) => new Date(f.simDate).getTime())
    expect(times[0]).toBe(CAMERA_ROUTE_START_DATE.getTime())
    expect(times[times.length - 1]).toBe(CAMERA_ROUTE_START_DATE.getTime() + 0.9 * 86_400_000)
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!)
  })
})
