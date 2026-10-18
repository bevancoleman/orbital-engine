/**
 * Route-simulator coverage for the context-body bulge: a flight between
 * two stations hugging the same planet. The simulator used to call
 * sampleFlightPath alone, so it never exercised CameraRig's context bulge
 * or keep-clear target at all; it now runs the same sampleFlightFrame
 * composition CameraRig does (see camera.ts).
 */

import { CAMERA_ROUTE_SAMPLES_PER_FLIGHT, CAMERA_ROUTE_START_DATE } from '../fixtures/cameraRouteFixture'
import { simulateCameraRoute, type CameraRouteFrame } from '../routeCameraSimulator'
import { resolveWorldPosition, type WorldVec } from '../render'
import { trueRadius } from '../scale'
import type { OrbitalElements, StarSystemData } from '../types'

/** cameraRoute.test.ts's hard per-frame ceiling for the main fixture. */
const MAX_TURN_RATE_DEG = 20

function vecDistance(a: WorldVec, b: WorldVec): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function stationOrbit(meanAnomalyAtEpochDeg: number): OrbitalElements {
  return {
    semiMajorAxisKm: 7_000,
    eccentricity: 0,
    inclinationDeg: 0,
    longitudeOfAscendingNodeDeg: 0,
    argumentOfPeriapsisDeg: 0,
    meanAnomalyAtEpochDeg,
    orbitalPeriodDays: 0.06,
    epoch: '2026-01-01T00:00:00Z',
  }
}

const PLANET_RADIUS_KM = 6_000
const SYSTEM: StarSystemData = {
  id: 'bulge-fixture',
  name: 'Bulge Fixture',
  bodies: [
    { id: 'star', name: 'Star', type: 'star', parentId: null, radiusKm: 50_000, orbit: null, fixedPosition: { xKm: 0, yKm: 0, zKm: 0 } },
    {
      id: 'planet',
      name: 'Planet',
      type: 'planet',
      parentId: 'star',
      radiusKm: PLANET_RADIUS_KM,
      orbit: null,
      fixedPosition: { xKm: 150_000_000, yKm: 0, zKm: 0 },
    },
    { id: 'stationA', name: 'A', type: 'station', parentId: 'planet', radiusKm: 0.05, orbit: stationOrbit(0), fixedPosition: null },
    { id: 'stationB', name: 'B', type: 'station', parentId: 'planet', radiusKm: 0.05, orbit: stationOrbit(170), fixedPosition: null },
  ],
}

describe('simulateCameraRoute — context-body bulge on a sibling flight past a shared parent', () => {
  const frames = simulateCameraRoute(SYSTEM, ['stationA', 'stationB'], CAMERA_ROUTE_START_DATE, {
    samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
    trackSteps: 1,
    trackStepMs: 0,
  })
  const siblingFlight = frames.filter((f) => f.leg === 1 && f.phase === 'flight')
  const planetPos = resolveWorldPosition(SYSTEM.bodies[1]!, SYSTEM.bodies, CAMERA_ROUTE_START_DATE)
  const planetRadius = trueRadius(PLANET_RADIUS_KM)
  const offsetLength = (f: CameraRouteFrame): number => vecDistance(f.cameraPos, f.target)

  it('backs the camera well out past both endpoint framings mid-flight to keep the planet in view', () => {
    const endpointMax = Math.max(offsetLength(siblingFlight[0]!), offsetLength(siblingFlight[siblingFlight.length - 1]!))
    const peak = Math.max(...siblingFlight.map(offsetLength))
    expect(peak).toBeGreaterThan(endpointMax * 10)
  })

  it('never puts the camera or its look-at point inside the planet', () => {
    for (const frame of siblingFlight) {
      expect(vecDistance(frame.cameraPos, planetPos)).toBeGreaterThan(planetRadius)
      expect(vecDistance(frame.target, planetPos)).toBeGreaterThan(planetRadius)
    }
  })

  it('turns the view continuously — no single-sample jump that survives denser sampling', () => {
    // A ~170° swing around the planet in one 900ms flight is genuinely
    // fast near the start (easeOutCubic's steepest stretch reads ~26° per
    // 60fps frame here), so this checks CONTINUITY rather than the main
    // fixture's per-frame ceiling: at 10x the frame density, a smooth path's
    // per-sample turn shrinks roughly tenfold, while a discontinuity (the
    // old bulge's crossover snap) would stay just as large.
    const dense = simulateCameraRoute(SYSTEM, ['stationA', 'stationB'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT * 10,
      trackSteps: 1,
      trackStepMs: 0,
    })
    for (const frame of dense) {
      if (frame.leg === 1 && frame.phase === 'flight' && frame.step > 0 && frame.turnRateDeg !== null) {
        expect(frame.turnRateDeg).toBeLessThan(MAX_TURN_RATE_DEG / 4)
      }
    }
  })
})
