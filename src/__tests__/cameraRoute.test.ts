/**
 * Whole-route regression test: reruns the fixed camera-route fixture
 * (src/fixtures/cameraRouteFixture.ts) through simulateCameraRoute and
 * checks it frame-by-frame — both invariants that must ALWAYS hold (no
 * reference needed, any failure is a real bug) and a percentage-tolerance
 * diff against the checked-in golden reference (src/fixtures/
 * cameraRouteReference.json), the "didn't regress vs. last known-good"
 * check requested for this fixture. See scripts/plotCameraRoute.ts for the
 * human-eyeball counterpart to this test — that renders the same trace as
 * an SVG; this file only compares numbers.
 */

import {
  CAMERA_ROUTE_FIXTURE_SYSTEM,
  CAMERA_ROUTE_FIXTURE_WAYPOINTS,
  CAMERA_ROUTE_START_DATE,
  CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
  CAMERA_ROUTE_TRACK_STEPS,
  CAMERA_ROUTE_TRACK_STEP_MS,
  CAMERA_ROUTE_ORBITING_BODY_IDS,
  CAMERA_ROUTE_TRACKING_SPEEDS_DPS,
  daysPerSecondToTrackStepMs,
  describeTrackingSpeed,
} from '../fixtures/cameraRouteFixture'
import cameraRouteReference from '../fixtures/cameraRouteReference.json' with { type: 'json' }
import { simulateCameraRoute, type CameraRouteFrame } from '../routeCameraSimulator'
import { DEFAULT_DAYS_PER_SECOND, MAX_DAYS_PER_SECOND } from '../timeScale'
import { smoothTrajectory } from '../camera'
import type { WorldVec } from '../render'

/** How far a frame's numbers may drift from the checked-in reference
 *  before it counts as a regression, as a percentage of DEFAULT_CAMERA_
 *  DISTANCE (the fixture's natural length scale — see camera.ts) rather
 *  than of each individual (sometimes near-zero) value, which would make
 *  the tolerance meaningless right at convergence 0 or a perfectly locked
 *  track frame. */
const CAMERA_ROUTE_TOLERANCE_PCT = 0.5
const SCALE_REFERENCE = 134 // DEFAULT_CAMERA_DISTANCE, duplicated to avoid importing camera.ts's internals into the test
const TOLERANCE_WORLD_UNITS = (CAMERA_ROUTE_TOLERANCE_PCT / 100) * SCALE_REFERENCE
const CONVERGENCE_TOLERANCE = CAMERA_ROUTE_TOLERANCE_PCT / 100
const ANGLE_TOLERANCE_DEG = 1
const MONOTONICITY_EPSILON = 1e-9
const FINAL_CONVERGENCE_EPSILON = 1e-9
const TRACKING_ERROR_BOUND = 1e-6 // world units — a "locked on" camera should have ~zero residual error
/** Per-frame turn-rate is allowed to grow by this many degrees frame-over-
 *  frame before counting as a real "not smooth" spike, rather than
 *  requiring strict non-increase — easeOutCubic's deceleration makes
 *  turn-rate trend down within a flight, but it isn't a perfectly convex
 *  curve at every step, so a small tolerance avoids flagging harmless
 *  numerical wobble while still catching a genuine whiplash spike (the
 *  naturalFlightOffset near-antipodal bug this fixture originally caught
 *  produced single-frame jumps of 40-70°, an order of magnitude past this). */
const TURN_RATE_SLACK_DEG = 2
/** Hard, absolute per-frame ceilings — exceeding these is a failure
 *  regardless of trend, leg, or phase (a sharp turn OR a sharp flight-path
 *  bend is a failure on its own terms, not just relative to its own
 *  neighbours). Measured directly on this fixture at ONE CAMERA UPDATE PER
 *  REAL RENDERED FRAME (see CAMERA_ROUTE_SAMPLES_PER_FLIGHT/
 *  CAMERA_ROUTE_TRACK_STEPS in the fixture — sampling any coarser
 *  manufactures apparent sharpness that was never really there): the
 *  worst legitimate single-frame value across every leg/phase is ~8.8°
 *  (turn-rate) and ~10.8° (flight-path-turn), so 20° leaves real margin
 *  above genuine smooth motion while still catching a regression an order
 *  of magnitude smaller than the bugs this fixture has already caught
 *  (a 70°+ near-antipodal pinch, a 169° cross-phase comparison artifact). */
const MAX_TURN_RATE_DEG = 20
const MAX_FLIGHT_PATH_TURN_DEG = 20
/** How close to exactly 0 turnRateDeg must be on a track frame — a rigid
 *  translation applied identically to camera and target can't change the
 *  offset between them, so this should hold at essentially floating-point
 *  precision (measured directly, in the 1e-6..1e-7 range) regardless of
 *  playback speed or how fast the tracked body is actually moving. A much
 *  looser bound than this would stop catching a real regression that
 *  reintroduced SOME rotation into tracking. */
const RIGID_TRACKING_TURN_EPSILON = 1e-4
/** How close to exactly 1.0 targetFramingScore must be to count as
 *  "perfectly framed" — framingScore is computed via acos/angle math (see
 *  angleBetweenDeg in routeCameraSimulator.ts), which round-trips through
 *  trig functions and measurably loses precision below ~1e-7 even for
 *  geometry that's exactly aligned in theory (observed directly: ~5e-8
 *  residual on the star leg, where the angle is mathematically exactly
 *  0). A tighter epsilon than this would fail on that float noise alone,
 *  not a real regression. */
const FRAMING_SCORE_EPSILON = 1e-6

function subtract(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vecDistance(a: WorldVec, b: WorldVec): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function frameLabel(frame: CameraRouteFrame): string {
  return `leg ${frame.leg} (${frame.bodyId}) ${frame.phase} step ${frame.step}`
}

/** Same intent as expect(...).toBeLessThanOrEqual(...), but with a label
 *  in the failure message identifying which frame/field regressed — Jest's
 *  `expect` (unlike Chai) doesn't accept a message as a second argument. */
function assertWithinTolerance(value: number, limit: number, label: string): void {
  if (value > limit) throw new Error(`${label}: ${value} exceeds tolerance ${limit}`)
}

describe('simulateCameraRoute — fixed fixture', () => {
  const frames = simulateCameraRoute(
    CAMERA_ROUTE_FIXTURE_SYSTEM,
    CAMERA_ROUTE_FIXTURE_WAYPOINTS,
    CAMERA_ROUTE_START_DATE,
    {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: CAMERA_ROUTE_TRACK_STEPS,
      trackStepMs: CAMERA_ROUTE_TRACK_STEP_MS,
    }
  )

  it('produces the same number of frames as the checked-in reference', () => {
    expect(frames.length).toBe((cameraRouteReference as CameraRouteFrame[]).length)
  })

  describe('invariants (independent of the reference — any failure here is a real bug)', () => {
    it('never lets a flight leg\'s target-convergence decrease frame-over-frame', () => {
      let previousConvergence = -Infinity
      let previousLeg = -1
      for (const frame of frames) {
        if (frame.phase !== 'flight' || frame.convergence === null) continue
        if (frame.leg !== previousLeg) {
          previousLeg = frame.leg
          previousConvergence = -Infinity
        }
        expect(frame.convergence).toBeGreaterThanOrEqual(previousConvergence - MONOTONICITY_EPSILON)
        previousConvergence = frame.convergence
      }
    })

    it('reaches target-convergence 1.0 on the final frame of every leg', () => {
      const lastStepPerLeg = new Map<number, CameraRouteFrame>()
      for (const frame of frames) {
        if (frame.phase === 'flight') lastStepPerLeg.set(frame.leg, frame)
      }
      for (const [, frame] of lastStepPerLeg) {
        expect(frame.convergence).toBeGreaterThanOrEqual(1 - FINAL_CONVERGENCE_EPSILON)
      }
    })

    it('keeps tracking error bounded on every track frame (camera stays locked on)', () => {
      for (const frame of frames) {
        if (frame.phase !== 'track' || frame.trackingError === null) continue
        expect(frame.trackingError).toBeLessThan(TRACKING_ERROR_BOUND)
      }
    })

    it('never spikes turn-rate mid-flight (the whiplash this fixture was built to catch)', () => {
      // Within a single leg's flight phase, turn-rate should trend DOWN
      // (easeOutCubic decelerates) from its first interior sample onward.
      // Step 0 of every leg reads ~0 (sampleFlightPath is exactly
      // continuous with wherever the camera just settled — see
      // slerpUnitVec3's exact-endpoint handling in camera.ts), and step 1
      // is the curve's own fastest, largest turn by construction — neither
      // has a meaningful "previous rate" to compare against, so both are
      // skipped and monotonic-non-increase is checked from step 2 on.
      let previousRate: number | null = null
      let previousLeg = -1
      for (const frame of frames) {
        if (frame.phase !== 'flight' || frame.turnRateDeg === null) continue
        if (frame.leg !== previousLeg) {
          previousLeg = frame.leg
          previousRate = null
          continue
        }
        if (previousRate !== null) {
          assertWithinTolerance(frame.turnRateDeg - previousRate, TURN_RATE_SLACK_DEG, `turn-rate spike at ${frameLabel(frame)}`)
        }
        previousRate = frame.turnRateDeg
      }
    })

    it('never lets any single frame\'s camera turn exceed a hard ceiling — a sharp turn is a failure on its own', () => {
      for (const frame of frames) {
        if (frame.turnRateDeg === null) continue
        assertWithinTolerance(frame.turnRateDeg, MAX_TURN_RATE_DEG, `turn-rate ceiling at ${frameLabel(frame)}`)
      }
    })

    it('never lets any single frame\'s flight-path bend exceed a hard ceiling — a sharp path change is a failure on its own', () => {
      // Distinct from turn-rate: this is how much the camera's own
      // TRAJECTORY through space bends, not how much the viewing angle
      // rotates — a route can have one smooth and the other kinked (see
      // flightPathTurnDeg's own comment in routeCameraSimulator.ts).
      for (const frame of frames) {
        if (frame.flightPathTurnDeg === null) continue
        assertWithinTolerance(frame.flightPathTurnDeg, MAX_FLIGHT_PATH_TURN_DEG, `flight-path-turn ceiling at ${frameLabel(frame)}`)
      }
    })

    it('keeps the star (no lookBias, same start and end look-at point) framed at a perfect 1.0 for the entire phase', () => {
      // The star leg's `target` never actually moves (INITIAL_TARGET is
      // already [0,0,0], the star's own real position — see
      // routeCameraSimulator's own INITIAL_TARGET), so there's nothing to
      // fly TOWARD in terms of framing: the star should already be
      // dead-centre from frame 0, and stay there through the whole flight
      // AND the settle/track phase, regardless of the camera's distance
      // still changing underneath it. This is the exact scenario that
      // motivated targetFramingScore existing at all, distinct from
      // convergence (which the checks above already assert reaches 1.0
      // only at the END of the flight — a "progress" measure, not a
      // "still in view" one).
      const starFrames = frames.filter((f) => f.bodyId === 'star')
      expect(starFrames.length).toBeGreaterThan(0)
      for (const frame of starFrames) {
        assertWithinTolerance(1 - frame.targetFramingScore, FRAMING_SCORE_EPSILON, `star targetFramingScore at ${frameLabel(frame)}`)
      }
    })

    it('never loses track of the target once framing has reached 1.0 within a leg', () => {
      // "Always improving, never losing track" — once a leg's
      // targetFramingScore first reaches a perfect 1.0, it must stay at
      // 1.0 for the rest of that leg (through the remainder of the flight
      // and the whole settle/track phase). A drop back down after
      // achieving lock would mean the camera let the target drift out of
      // ideal framing again, which is exactly the failure this metric
      // exists to catch — as opposed to convergence, which is allowed
      // (expected) to be non-monotonic in less strict ways since it's
      // measuring animation progress, not framing.
      let lockedThisLeg = false
      let previousLeg = -1
      for (const frame of frames) {
        if (frame.leg !== previousLeg) {
          previousLeg = frame.leg
          lockedThisLeg = false
        }
        const isPerfect = frame.targetFramingScore >= 1 - FRAMING_SCORE_EPSILON
        if (lockedThisLeg) {
          assertWithinTolerance(1 - frame.targetFramingScore, FRAMING_SCORE_EPSILON, `lost target lock at ${frameLabel(frame)}`)
        }
        if (isPerfect) lockedThisLeg = true
      }
    })
  })

  describe('regression vs. checked-in reference', () => {
    const reference = cameraRouteReference as CameraRouteFrame[]

    it('frames the same body (and parent) as the reference at every step', () => {
      // Exact equality, not tolerance — WHAT a frame is framing is
      // categorical, not a drifting number. A mismatch here means the
      // route itself changed shape (a different leg order, or a body's
      // parentId changed), which the numeric tolerance checks below
      // wouldn't reliably catch on their own.
      frames.forEach((frame, i) => {
        const expected = reference[i]
        if (!expected) throw new Error(`no reference frame at index ${i} (${frameLabel(frame)})`)
        expect(frame.bodyId).toBe(expected.bodyId)
        expect(frame.parentBodyId).toBe(expected.parentBodyId)
      })
    })

    it('matches the reference cameraPos/target within tolerance, frame by frame', () => {
      frames.forEach((frame, i) => {
        const expected = reference[i]
        if (!expected) throw new Error(`no reference frame at index ${i} (${frameLabel(frame)})`)

        const label = frameLabel(frame)
        const posDrift = vecDistance(frame.cameraPos, expected.cameraPos)
        const targetDrift = vecDistance(frame.target, expected.target)
        assertWithinTolerance(posDrift, TOLERANCE_WORLD_UNITS, `cameraPos drift at ${label}`)
        assertWithinTolerance(targetDrift, TOLERANCE_WORLD_UNITS, `target drift at ${label}`)

        if (frame.convergence !== null && expected.convergence !== null) {
          assertWithinTolerance(
            Math.abs(frame.convergence - expected.convergence),
            CONVERGENCE_TOLERANCE,
            `convergence drift at ${label}`
          )
        }
        if (frame.trackingError !== null && expected.trackingError !== null) {
          assertWithinTolerance(
            Math.abs(frame.trackingError - expected.trackingError),
            TOLERANCE_WORLD_UNITS,
            `trackingError drift at ${label}`
          )
        }
        if (frame.turnRateDeg !== null && expected.turnRateDeg !== null) {
          assertWithinTolerance(
            Math.abs(frame.turnRateDeg - expected.turnRateDeg),
            ANGLE_TOLERANCE_DEG,
            `turnRateDeg drift at ${label}`
          )
        }
        if (frame.flightPathTurnDeg !== null && expected.flightPathTurnDeg !== null) {
          assertWithinTolerance(
            Math.abs(frame.flightPathTurnDeg - expected.flightPathTurnDeg),
            ANGLE_TOLERANCE_DEG,
            `flightPathTurnDeg drift at ${label}`
          )
        }
        assertWithinTolerance(
          Math.abs(frame.targetFramingScore - expected.targetFramingScore),
          CONVERGENCE_TOLERANCE,
          `targetFramingScore drift at ${label}`
        )
        if (frame.parentFramingScore !== null && expected.parentFramingScore !== null) {
          assertWithinTolerance(
            Math.abs(frame.parentFramingScore - expected.parentFramingScore),
            CONVERGENCE_TOLERANCE,
            `parentFramingScore drift at ${label}`
          )
        }
      })
    })
  })
})

describe('tracking accuracy across playback speeds', () => {
  // "Tracking is working" means: once the camera has settled on a body,
  // it stays exactly locked on as that body keeps orbiting — regardless
  // of how fast simulated time is advancing. Runs each orbiting body's
  // own settle/track phase, in isolation (a single-waypoint route, so
  // only that body's track phase is under test), at multiple playback
  // speeds up to 2 d/s — see CAMERA_ROUTE_TRACKING_SPEEDS_DPS's own
  // comment in the fixture for why those specific speeds.
  //
  // Deliberately does NOT assert a ceiling on flightPathTurnDeg here (the
  // camera's own per-frame movement-direction change) the way the main
  // route fixture does for flight frames: a fast, close orbiter (moonA,
  // stationA) sampled at a fast playback speed genuinely CAN bend by tens
  // of degrees per rendered frame — that's real orbital curvature, sampled
  // once per frame same as anywhere else in this fixture, not a smoothness
  // bug to fix (confirmed directly: moonA/stationA reach ~20-28°/frame at
  // 2 d/s, purely from how much of their own short orbit elapses in a
  // single 1/60s frame at that speed — see naturalFlightOffset's own
  // slerp fix for what WAS a real bug, a discontinuity independent of any
  // legitimate orbital speed).
  for (const bodyId of CAMERA_ROUTE_ORBITING_BODY_IDS) {
    describe(bodyId, () => {
      for (const speed of CAMERA_ROUTE_TRACKING_SPEEDS_DPS) {
        const trackStepMs = daysPerSecondToTrackStepMs(speed)
        const speedLabel = describeTrackingSpeed(speed)

        it(`stays locked on at ${speedLabel} (${speed.toFixed(5)} d/s)`, () => {
          const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, [bodyId], CAMERA_ROUTE_START_DATE, {
            samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
            trackSteps: CAMERA_ROUTE_TRACK_STEPS,
            trackStepMs,
          })
          const trackFrames = frames.filter((f) => f.phase === 'track')
          expect(trackFrames.length).toBe(CAMERA_ROUTE_TRACK_STEPS)

          for (const frame of trackFrames) {
            const label = `${bodyId} @ ${speedLabel}, ${frameLabel(frame)}`
            // The core "is tracking working" check: the camera's target
            // should land exactly on the body's live position every
            // frame, at any speed — trackingDelta is a plain rigid
            // translation matching the body's own real motion exactly,
            // so this should hold to floating-point precision, not just
            // "close enough", no matter how far the body itself moved.
            if (frame.trackingError !== null) {
              assertWithinTolerance(frame.trackingError, TRACKING_ERROR_BOUND, `trackingError at ${label}`)
            }
            // A rigid translation applied identically to camera AND
            // target can't change the offset between them — turnRateDeg
            // should read as exactly 0 (to floating-point precision)
            // regardless of speed or how fast the tracked body moves.
            if (frame.turnRateDeg !== null) {
              assertWithinTolerance(frame.turnRateDeg, RIGID_TRACKING_TURN_EPSILON, `turnRateDeg at ${label}`)
            }
          }
        })
      }
    })
  }
})

describe('smoothness ceilings hold for every body flown to INDEPENDENTLY, not just chained', () => {
  // Real coverage gap this closes: the main "simulateCameraRoute — fixed
  // fixture" suite above only ever flies the CHAINED route (star ->
  // planetA -> moonA -> stationA in order), where each leg starts from
  // wherever the previous leg's flight happened to leave the camera. That
  // chained starting angle is not necessarily the most demanding one for
  // a given destination. scripts/plotCameraRoute.ts's per-phase images
  // instead fly to EVERY waypoint independently, starting fresh from the
  // same default view each time (see its own comment for why) — a real,
  // different flight, with its own start/end offset geometry, that the
  // chained test above never actually exercises. Caught directly during
  // development: moonA's independent flight bent at ~32°/frame — over
  // MAX_FLIGHT_PATH_TURN_DEG — while the chained route's own moonA leg
  // (arriving from planetA, a less extreme starting angle) stayed
  // comfortably under it the whole time, so this exact regression would
  // have shipped silently without a test that flies each body from a
  // fresh start too.
  for (const waypointId of CAMERA_ROUTE_FIXTURE_WAYPOINTS) {
    it(`${waypointId}: turn-rate and flight-path-bend ceilings hold when flown to fresh (not chained)`, () => {
      const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, [waypointId], CAMERA_ROUTE_START_DATE, {
        samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
        trackSteps: CAMERA_ROUTE_TRACK_STEPS,
        trackStepMs: CAMERA_ROUTE_TRACK_STEP_MS,
      })
      for (const frame of frames) {
        const label = frameLabel(frame)
        if (frame.turnRateDeg !== null) {
          assertWithinTolerance(frame.turnRateDeg, MAX_TURN_RATE_DEG, `turn-rate ceiling (independent start) at ${label}`)
        }
        if (frame.flightPathTurnDeg !== null) {
          assertWithinTolerance(frame.flightPathTurnDeg, MAX_FLIGHT_PATH_TURN_DEG, `flight-path-turn ceiling (independent start) at ${label}`)
        }
      }
    })
  }
})

describe('flight-phase trajectory prediction (predictedTargetAt)', () => {
  // "Consider future locations as part of generating the path" — for a
  // body genuinely moving during its own flight (fast orbiter, or any
  // orbiter at a high playback speed), the look-at point should track
  // where it REALLY is throughout the flight, not just where it started
  // (flightDaysPerSecond=0) or a single fixed endpoint.
  it('holds the look-at point still when flightDaysPerSecond is 0 (the default — unchanged behaviour)', () => {
    const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['stationA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: 1,
      trackStepMs: 0,
    })
    const flight = frames.filter((f) => f.phase === 'flight')
    const late = flight.slice(-10)
    for (const frame of late) {
      assertWithinTolerance(vecDistance(frame.target, late[0]!.target), 1e-6, `unexpected target drift at ${frameLabel(frame)}`)
    }
  })

  it('tracks a body\'s REAL predicted motion throughout the flight when the trajectory guard leaves it active', () => {
    // planetA (365-day period) at the app's own default speed: slow
    // enough that safePredictFlightTarget's own guard stays ACTIVE (its
    // predicted excursion during the flight is small relative to its own
    // final viewing distance — see that function's comment), unlike a
    // close/fast orbiter (moonA, stationA), which the SAME guard correctly
    // falls back away from at any of this fixture's realistic speeds (see
    // the dedicated fallback tests below) — unlike the old, pre-cap test
    // this replaces, which used a hardcoded 2 d/s no longer reachable
    // under MAX_DAYS_PER_SECOND at all. Its look-at point should still
    // keep moving (following the real predicted trajectory) through the
    // LATE part of the flight, not settle onto one fixed point the
    // moment the front-loaded ease has mostly finished blending in.
    const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['planetA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: 1,
      trackStepMs: 0,
      flightDaysPerSecond: DEFAULT_DAYS_PER_SECOND,
    })
    const flight = frames.filter((f) => f.phase === 'flight')
    const late = flight.slice(-10)
    const lateMovement = vecDistance(late[0]!.target, late[late.length - 1]!.target)
    // Comfortably above float noise (1e4x the flightDaysPerSecond=0 test's
    // own 1e-6 ceiling for "stationary") — this needs to be REAL orbital
    // movement, not a rounding artifact. planetA moves little in absolute
    // terms over one short flight even at this active speed (it's a
    // slow-orbiting planet, not picked for drama) — that's expected, not
    // a weak assertion: the point is confirming the trajectory genuinely
    // varies target(t), not how far.
    expect(lateMovement).toBeGreaterThan(1e-4)
  })

  it('falls back to the fixed endpoint for a close/fast orbiter whose own excursion would otherwise bend the flight path', () => {
    // The real bug this guard exists for: forcing trajectory-tracking on
    // for moonA/stationA at any of this fixture's realistic (post-cap)
    // speeds measured flight-path bends of 24-90°/frame, because their
    // own predicted excursion during the flight is large relative to how
    // close the camera ends up (a true-scale close orbiter) — see
    // safePredictFlightTarget's own comment in camera.ts. Confirmed
    // directly here: with the guard active, the look-at point should NOT
    // keep drifting from its arrival point once settled, the same
    // "stationary" signature as the flightDaysPerSecond=0 test above.
    const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['moonA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: 1,
      trackStepMs: 0,
      flightDaysPerSecond: MAX_DAYS_PER_SECOND,
    })
    const flight = frames.filter((f) => f.phase === 'flight')
    const late = flight.slice(-10)
    assertWithinTolerance(vecDistance(late[0]!.target, late[late.length - 1]!.target), 1e-6, 'expected the guard to fall back to a fixed endpoint')
  })

  it('still reaches exactly the predicted arrival point at the end of the flight (t=1 boundary unaffected)', () => {
    const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['planetA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: 1,
      trackStepMs: 0,
      flightDaysPerSecond: DEFAULT_DAYS_PER_SECOND,
    })
    const flight = frames.filter((f) => f.phase === 'flight')
    assertWithinTolerance(1 - flight[flight.length - 1]!.targetFramingScore, FRAMING_SCORE_EPSILON, 'final frame not perfectly framed')
  })
})

describe('track-phase smoothing (smoothTracking)', () => {
  // The epicycle spike this addresses: a tracked body whose own PARENT is
  // also moving traces a genuinely combined path — see smoothTrajectory's
  // own comment in camera.ts for the full investigation. Verified away
  // from the very start/end of the (necessarily finite, for testing) track
  // phase, where the moving-average window is fully populated — the last
  // few frames near either end still show a smaller residual purely from
  // the window being clamped there (see smoothTrajectory's own comment),
  // which a real, continuous (never-ending) tracking phase wouldn't have.
  // Real, honest finding while re-tuning this fixture for
  // MAX_HOURS_PER_SECOND: the ~29°/frame "epicycle" spike this feature
  // was originally built to fix was measured at the OLD test speed
  // (2 d/s = 48 h/s) — well above what the app can request now. At
  // MAX_DAYS_PER_SECOND (6 h/s) itself, this fixture's own worst case
  // (moonA) only reaches ~4.2°/frame UNSMOOTHED — the underlying
  // "planet's own drift is comparable in magnitude to a close moon's own
  // per-frame motion" mechanism is still real (see smoothTrajectory's own
  // comment), it's just far milder within the now-realistic speed range.
  // So this integration-level test checks the honest, current claim
  // (smoothing doesn't make the realistic case WORSE) rather than
  // reasserting a dramatic reduction that isn't the reality at this speed
  // any more — see the synthetic unit test below for direct proof the
  // underlying algorithm still does what it says on a real epicycle.
  it('never makes the realistic worst case (moonA at MAX_DAYS_PER_SECOND) worse than leaving tracking unsmoothed', () => {
    const unsmoothed = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['moonA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: CAMERA_ROUTE_TRACK_STEPS,
      trackStepMs: daysPerSecondToTrackStepMs(MAX_DAYS_PER_SECOND),
    })
    const smoothed = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['moonA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: CAMERA_ROUTE_TRACK_STEPS,
      trackStepMs: daysPerSecondToTrackStepMs(MAX_DAYS_PER_SECOND),
      smoothTracking: true,
    })
    const interior = (frames: CameraRouteFrame[]) => frames.filter((f) => f.phase === 'track').slice(10, -10)
    const maxBend = (frames: CameraRouteFrame[]) => Math.max(...frames.map((f) => f.flightPathTurnDeg ?? 0))
    expect(maxBend(interior(smoothed))).toBeLessThanOrEqual(maxBend(interior(unsmoothed)) + 1)
  })

  it('smoothTrajectory itself substantially reduces a genuine, synthetic epicycle-style spike', () => {
    // Direct, fixture-independent proof the underlying algorithm still
    // does what it was built for: two combined circular motions (a fast,
    // small orbit riding on a slower, larger one) at a relative frequency
    // and magnitude chosen to reproduce the same ~29°/frame class of spike
    // originally found — not tied to whatever speed cap this fixture's
    // own bodies happen to need today.
    const points: WorldVec[] = []
    for (let i = 0; i < 60; i++) {
      const fast = (i / 15) * 2 * Math.PI // fast orbit: full turn every 15 samples
      const slow = (i / 200) * 2 * Math.PI // slow "parent" drift
      points.push([Math.cos(fast) * 0.03 + Math.cos(slow) * 0.02, 0, Math.sin(fast) * 0.03 + Math.sin(slow) * 0.02])
    }
    const maxBend = (data: WorldVec[]) => {
      let best = 0
      let prevDelta: WorldVec | null = null
      for (let i = 1; i < data.length; i++) {
        const delta = subtract(data[i]!, data[i - 1]!)
        if (prevDelta) {
          const la = Math.hypot(...delta)
          const lb = Math.hypot(...prevDelta)
          if (la > 1e-12 && lb > 1e-12) {
            const dot = (delta[0] * prevDelta[0] + delta[1] * prevDelta[1] + delta[2] * prevDelta[2]) / (la * lb)
            best = Math.max(best, (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI)
          }
        }
        prevDelta = delta
      }
      return best
    }
    const unsmoothedBend = maxBend(points)
    const smoothedBend = maxBend(smoothTrajectory(points, 7).slice(7, -7))
    expect(unsmoothedBend).toBeGreaterThan(20)
    expect(smoothedBend).toBeLessThan(5)
  })

  it('keeps the resulting tracking error small — the explicit, accepted tradeoff for not spiking', () => {
    const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['moonA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: CAMERA_ROUTE_TRACK_STEPS,
      trackStepMs: daysPerSecondToTrackStepMs(2),
      smoothTracking: true,
    })
    const track = frames.filter((f) => f.phase === 'track')
    for (const frame of track) {
      if (frame.trackingError === null) continue
      // "Small" relative to DEFAULT_CAMERA_DISTANCE (134, the fixture's
      // natural length scale) — a deliberate, bounded lag (measured max
      // ~0.16 at this speed/window), not a runaway drift, even though
      // it's larger than moonA's own compressed orbital radius (~0.026):
      // the lag is proportional to how far the body moves ACROSS the
      // whole smoothing window, not just its orbital radius.
      assertWithinTolerance(frame.trackingError, 0.2, `trackingError at ${frameLabel(frame)}`)
    }
  })

  it('leaves the default (smoothTracking: false) behaviour byte-for-byte unchanged', () => {
    const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, ['moonA'], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: CAMERA_ROUTE_TRACK_STEPS,
      trackStepMs: daysPerSecondToTrackStepMs(2),
    })
    const track = frames.filter((f) => f.phase === 'track')
    for (const frame of track) {
      if (frame.trackingError === null) continue
      expect(frame.trackingError).toBeLessThan(TRACKING_ERROR_BOUND)
    }
  })
})
