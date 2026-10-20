/**
 * Fly-to smoothness at 60fps, end to end: real Solar System routes (the
 * ones a user reported as "still very fast... I want it to be smooth" —
 * Moon → ISS → Hubble — plus interplanetary hops) and the review's
 * context-bulge scenario, each flown through the same sampleFlightFrame
 * composition CameraRig renders, for its own planned duration
 * (flightDurationMs). See flightPath.test.ts for the underlying math.
 */

import {
  DEFAULT_VIEW_DIRECTION,
  VERTICAL_FOV_DEG,
  computeFlightEndpoint,
  computeFocusForBody,
  flightDurationMs,
  sampleFlightFrame,
  type BodyFraming,
  type FlightEndpoints,
} from '../camera'
import { resolveWorldPosition, type WorldVec } from '../render'
import { trueRadius } from '../scale'
import { SOLAR_SYSTEM } from '../solarSystemData'
import { angleBetweenDeg, lengthVec3, subtractVec3 } from '../vec3'

const FPS = 60
const HALF_FOV_DEG = VERTICAL_FOV_DEG / 2
const DATE = new Date('2026-10-19T00:00:00Z')

/** The smoothness ceilings this file holds every flight to. */
const MAX_VIEW_TURN_DEG_PER_FRAME = 3
const MAX_LOG_DISTANCE_STEP_PER_FRAME = 0.3
const MAX_ONSCREEN_DESTINATION_SHIFT_DEG_PER_FRAME = 5
/** How much the on-screen shift itself may change from one frame to the
 *  next — a spike (the old 39°-in-one-frame lurch) fails this even when
 *  it's under the ceiling above. */
const MAX_DESTINATION_SHIFT_CHANGE_DEG = 1
/** First and last frame's camera move, as a fraction of the flight's
 *  fastest frame — "starts and ends at rest" (alongside the moves
 *  shrinking frame over frame into both ends). Not tighter: the review's
 *  bulge scenario holds the camera back to keep Earth in frame and then
 *  zooms into a 1e-6 close-up, which packs its deceleration into fewer
 *  frames (~5% of peak on the last one) than an unbulged flight (~1–2%). */
const MAX_END_MOVE_FRACTION = 0.1

interface FlightTrace {
  durationMs: number
  frames: { position: WorldVec; target: WorldVec }[]
  destination: WorldVec
}

function body(id: string) {
  const found = SOLAR_SYSTEM.bodies.find((b) => b.id === id)
  if (!found) throw new Error(`no body ${id}`)
  return found
}

function flyFrames(flight: FlightEndpoints): FlightTrace {
  const durationMs = flightDurationMs(flight)
  const steps = Math.round((durationMs / 1000) * FPS)
  const frames = []
  for (let i = 0; i <= steps; i++) frames.push(sampleFlightFrame(flight, i / steps))
  return { durationMs, frames, destination: flight.endTarget }
}

/** Flies the Solar System route `ids` in order from a fresh default view
 *  of the first body (in `startFraming`), returning each leg keyed
 *  "from→to". Every later leg arrives in the default 'body' framing. */
function flyRoute(ids: string[], startFraming: BodyFraming = 'body'): Map<string, FlightTrace & { flight: FlightEndpoints }> {
  const first = computeFocusForBody(body(ids[0]!), SOLAR_SYSTEM, DATE, null, startFraming)
  let target = first.position
  let camera: WorldVec = [
    target[0] + DEFAULT_VIEW_DIRECTION[0] * first.distance,
    target[1] + DEFAULT_VIEW_DIRECTION[1] * first.distance,
    target[2] + DEFAULT_VIEW_DIRECTION[2] * first.distance,
  ]
  const legs = new Map<string, FlightTrace & { flight: FlightEndpoints }>()
  for (let i = 1; i < ids.length; i++) {
    const focus = computeFocusForBody(body(ids[i]!), SOLAR_SYSTEM, DATE, body(ids[i - 1]!))
    const end = computeFlightEndpoint(camera, target, focus, DEFAULT_VIEW_DIRECTION)
    const flight: FlightEndpoints = {
      startPosition: camera,
      startTarget: target,
      endPosition: end.position,
      endTarget: end.target,
      contextBody: focus.contextBody,
      predictedTargetAt: null,
    }
    legs.set(`${ids[i - 1]}→${ids[i]}`, { ...flyFrames(flight), flight })
    camera = end.position
    target = end.target
  }
  return legs
}

const viewOf = (f: { position: WorldVec; target: WorldVec }): WorldVec => subtractVec3(f.target, f.position)
const destinationAngle = (f: { position: WorldVec; target: WorldVec }, destination: WorldVec): number =>
  angleBetweenDeg(viewOf(f), subtractVec3(destination, f.position))

function maxOverFrames(trace: FlightTrace, metric: (prev: FlightTrace['frames'][number], next: FlightTrace['frames'][number]) => number): number {
  let worst = 0
  for (let i = 1; i < trace.frames.length; i++) worst = Math.max(worst, metric(trace.frames[i - 1]!, trace.frames[i]!))
  return worst
}

function assertSmooth(trace: FlightTrace): void {
  const turn = maxOverFrames(trace, (a, b) => angleBetweenDeg(viewOf(a), viewOf(b)))
  expect(turn).toBeLessThanOrEqual(MAX_VIEW_TURN_DEG_PER_FRAME)

  const logStep = maxOverFrames(trace, (a, b) =>
    Math.abs(Math.log(lengthVec3(subtractVec3(b.position, b.target)) / lengthVec3(subtractVec3(a.position, a.target))))
  )
  expect(logStep).toBeLessThanOrEqual(MAX_LOG_DISTANCE_STEP_PER_FRAME)

  // The destination's on-screen motion: small every frame it's on screen,
  // and changing smoothly from frame to frame (no spike).
  const angles = trace.frames.map((f) => destinationAngle(f, trace.destination))
  let previousShift: number | null = null
  for (let i = 1; i < angles.length; i++) {
    const shift = Math.abs(angles[i]! - angles[i - 1]!)
    const onScreen = angles[i]! <= HALF_FOV_DEG || angles[i - 1]! <= HALF_FOV_DEG
    if (onScreen) expect(shift).toBeLessThanOrEqual(MAX_ONSCREEN_DESTINATION_SHIFT_DEG_PER_FRAME)
    if (onScreen && previousShift !== null) expect(Math.abs(shift - previousShift)).toBeLessThanOrEqual(MAX_DESTINATION_SHIFT_CHANGE_DEG)
    previousShift = onScreen ? shift : null
  }

  // Zero velocity at both ends: the first and last frames barely move
  // compared with the flight's fastest frame — measured in units of the
  // current viewing distance (how much the view itself changes), not raw
  // world units, which a deep zoom spans many orders of magnitude of.
  const moves = trace.frames.slice(1).map((f, i) => {
    const previous = trace.frames[i]!
    return lengthVec3(subtractVec3(f.position, previous.position)) / lengthVec3(subtractVec3(previous.position, previous.target))
  })
  const peak = Math.max(...moves)
  if (peak > 0) {
    expect(moves[0]! / peak).toBeLessThanOrEqual(MAX_END_MOVE_FRACTION)
    expect(moves[moves.length - 1]! / peak).toBeLessThanOrEqual(MAX_END_MOVE_FRACTION)
    for (let i = 1; i < 3; i++) {
      expect(moves[i - 1]!).toBeLessThan(moves[i]!)
      expect(moves[moves.length - i]!).toBeLessThan(moves[moves.length - i - 1]!)
    }
  }
}

/** Once the destination is in view it never leaves; returns the fraction
 *  of frames it's in view for. */
function assertDestinationStaysInView(trace: FlightTrace): number {
  const inView = trace.frames.map((f) => destinationAngle(f, trace.destination) <= HALF_FOV_DEG)
  const firstIn = inView.indexOf(true)
  expect(firstIn).toBeGreaterThanOrEqual(0)
  for (let i = firstIn; i < inView.length; i++) expect(inView[i]).toBe(true)
  return (inView.length - firstIn) / inView.length
}

describe('fly-to smoothness on real Solar System routes', () => {
  const legs = new Map([...flyRoute(['earth', 'moon', 'iss', 'hubble', 'mars', 'jupiter', 'saturn']), ...flyRoute(['earth', 'saturn'])])

  it.each([...legs.keys()])('%s: turns, zooms and moves the destination smoothly at 60fps, starting and ending at rest', (key) => {
    assertSmooth(legs.get(key)!)
  })

  it.each([...legs.keys()])('%s: keeps the destination in view once it is in view', (key) => {
    // At least the final third — from the top of the zoom-out on, the
    // remaining pan is a fraction of the view (see zoomPanPath). Before
    // that, a destination that starts behind a true-scale close-up (Mars,
    // seen from Hubble) can't be on screen yet.
    expect(assertDestinationStaysInView(legs.get(key)!)).toBeGreaterThan(1 / 3)
  })

  // Earth's 'system' framing has the Moon in it; its 'body' framing (what
  // arriving at Earth gives) is too close to — see computeFocusForBody.
  it('keeps the destination in view the whole way for a dive toward what\'s already ahead', () => {
    expect(assertDestinationStaysInView(flyRoute(['earth', 'moon'], 'system').get('earth→moon')!)).toBe(1)
    expect(assertDestinationStaysInView(legs.get('moon→iss')!)).toBe(1)
  })

  // Satellites arrive framed up close now (see ABSOLUTE_MIN_CAMERA_DISTANCE),
  // so hops to and from them span ~100x more zoom than they did and take
  // ~0.4-0.7s longer: Moon → ISS ~2.9s, ISS → Hubble ~3.7s, Hubble → Mars
  // ~4.5s (all were under 4s).
  it('takes longer the further a flight really travels, within the 1.2s–5s clamps', () => {
    const seconds = (key: string): number => legs.get(key)!.durationMs / 1000
    for (const trace of legs.values()) {
      expect(trace.durationMs).toBeGreaterThanOrEqual(1200)
      expect(trace.durationMs).toBeLessThanOrEqual(5000)
    }
    expect(seconds('earth→moon')).toBeLessThan(seconds('moon→iss'))
    expect(seconds('moon→iss')).toBeGreaterThanOrEqual(2.5)
    expect(seconds('moon→iss')).toBeLessThanOrEqual(3.5)
    expect(seconds('iss→hubble')).toBeGreaterThanOrEqual(3)
    expect(seconds('iss→hubble')).toBeLessThanOrEqual(4)
    expect(seconds('hubble→mars')).toBeGreaterThanOrEqual(4)
    expect(seconds('hubble→mars')).toBeLessThanOrEqual(5)
  })

  // The old front-loaded ease covered half the look-at travel in 33ms on
  // every one of these routes.
  it('no longer front-loads the look-at point: half its travel takes at least a fifth of the flight', () => {
    for (const trace of legs.values()) {
      const travel = lengthVec3(subtractVec3(trace.destination, trace.frames[0]!.target))
      if (travel === 0) continue
      const half = trace.frames.findIndex((f) => lengthVec3(subtractVec3(f.target, trace.frames[0]!.target)) >= travel / 2)
      expect(half / (trace.frames.length - 1)).toBeGreaterThanOrEqual(0.2)
    }
  })

  describe('ISS ↔ Hubble around Earth (shared-parent context body)', () => {
    const earth = body('earth')
    const earthPos = resolveWorldPosition(earth, SOLAR_SYSTEM.bodies, DATE)
    const earthRadius = trueRadius(earth.radiusKm)
    const trips = [legs.get('iss→hubble')!, flyRoute(['hubble', 'iss']).get('hubble→iss')!]

    it('has Earth as its context body', () => {
      for (const trip of trips) expect(trip.flight.contextBody).not.toBeNull()
    })

    it('never puts the camera or its look-at point inside Earth', () => {
      for (const trip of trips) {
        for (const frame of trip.frames) {
          expect(lengthVec3(subtractVec3(frame.position, earthPos))).toBeGreaterThan(earthRadius)
          expect(lengthVec3(subtractVec3(frame.target, earthPos))).toBeGreaterThan(earthRadius)
        }
      }
    })

    it('never shows a blank frame: the origin, Earth or the destination is always in view', () => {
      for (const trip of trips) {
        const origin = trip.frames[0]!.target
        for (const frame of trip.frames) {
          const inView = [origin, earthPos, trip.destination].some((p) => destinationAngle(frame, p) <= HALF_FOV_DEG)
          expect(inView).toBe(true)
        }
      }
    })

    it('is smooth in both directions', () => {
      for (const trip of trips) assertSmooth(trip)
    })
  })
})

/** Arrives at `id` in `from` framing, then flies to its `to` framing —
 *  the flight selecting an already-selected body makes (see
 *  useSelectionNavigation): a pure zoom about the body, no pan. */
function flyFramingToggle(id: string, from: BodyFraming, to: BodyFraming): FlightTrace {
  const start = computeFocusForBody(body(id), SOLAR_SYSTEM, DATE, null, from)
  const startEnd = computeFlightEndpoint(
    [start.position[0], start.position[1] + 1, start.position[2] + 2],
    start.position,
    start,
    DEFAULT_VIEW_DIRECTION
  )
  const focus = computeFocusForBody(body(id), SOLAR_SYSTEM, DATE, null, to)
  const end = computeFlightEndpoint(startEnd.position, startEnd.target, focus, DEFAULT_VIEW_DIRECTION)
  return flyFrames({
    startPosition: startEnd.position,
    startTarget: startEnd.target,
    endPosition: end.position,
    endTarget: end.target,
    contextBody: null,
    predictedTargetAt: null,
  })
}

describe('toggling a body between its body and system framings', () => {
  it.each(['earth', 'jupiter', 'saturn', 'moon'])('%s: zooms out and back in smoothly, keeping the body centred', (id) => {
    for (const [from, to] of [
      ['body', 'system'],
      ['system', 'body'],
    ] as const) {
      const trace = flyFramingToggle(id, from, to)
      assertSmooth(trace)
      for (const frame of trace.frames) expect(destinationAngle(frame, trace.destination)).toBeLessThan(1e-3)
    }
  })
})

describe('the review\'s context-bulge scenario (a wide shot down to a close-up on Earth\'s far side)', () => {
  const contextBody = { position: [0, 0, 0] as WorldVec, radius: 0.0055 }
  const focus = { position: [-0.006, 1e-4, 0] as WorldVec, distance: 1e-6, lookBias: null, contextBody }
  const end = computeFlightEndpoint([0.0059, 5, 0], [0.0059, 0, 0], focus, [0, 1, 0])
  const flight: FlightEndpoints = {
    startPosition: [0.0059, 5, 0],
    startTarget: [0.0059, 0, 0],
    endPosition: end.position,
    endTarget: end.target,
    contextBody,
    predictedTargetAt: null,
  }
  const trace = flyFrames(flight)

  it('is smooth at 60fps', () => {
    assertSmooth(trace)
  })

  it('never passes through Earth', () => {
    for (const frame of trace.frames) {
      expect(lengthVec3(frame.position)).toBeGreaterThan(contextBody.radius)
      expect(lengthVec3(frame.target)).toBeGreaterThan(contextBody.radius)
    }
  })

  it('keeps the destination in view once it is in view', () => {
    expect(assertDestinationStaysInView(trace)).toBeGreaterThan(1 / 3)
  })
})
