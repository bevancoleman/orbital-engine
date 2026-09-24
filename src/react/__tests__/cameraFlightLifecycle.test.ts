import { FLY_DURATION_MS, type FocusTarget } from '../../camera'
import {
  acknowledgeNullFocus,
  advanceSteadyTracking,
  beginFlight,
  createFlightLifecycleState,
  focusChanged,
  recordLiveTrackedPosition,
  sampleFlight,
  settleFlight,
} from '../cameraFlightLifecycle'
import type { WorldVec } from '../../render'

const INITIAL_DIRECTION: WorldVec = [0, 0.447, 0.894]

function focusAt(position: WorldVec, overrides: Partial<FocusTarget> = {}): FocusTarget {
  return { position, distance: 10, lookBias: null, contextBody: null, ...overrides }
}

describe('focusChanged', () => {
  it('is false for the freshly-created state and a null focus', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    expect(focusChanged(state, null)).toBe(false)
  })

  it('is true the first time a real focus is seen', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    expect(focusChanged(state, focusAt([1, 0, 0]))).toBe(true)
  })

  it('is false for the SAME focus object seen again (e.g. re-rendered with an unchanged prop)', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const focus = focusAt([1, 0, 0])
    const afterBegin = beginFlight(state, {
      focus,
      focusedId: 'a',
      currentCameraPos: [0, 0, 10],
      currentTargetPos: [0, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    expect(focusChanged(afterBegin, focus)).toBe(false)
  })

  it('is true for a DIFFERENT object even with identical field values — computeFocusForBody always returns a fresh object', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const first = focusAt([1, 0, 0])
    const afterBegin = beginFlight(state, {
      focus: first,
      focusedId: 'a',
      currentCameraPos: [0, 0, 10],
      currentTargetPos: [0, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    const second = focusAt([1, 0, 0]) // same values, new object — e.g. recenter() on the same body
    expect(focusChanged(afterBegin, second)).toBe(true)
  })
})

describe('acknowledgeNullFocus', () => {
  it('records null as the last-seen focus without starting a flight', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const afterFocus = beginFlight(state, {
      focus: focusAt([1, 0, 0]),
      focusedId: 'a',
      currentCameraPos: [0, 0, 10],
      currentTargetPos: [0, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    const afterDeselect = acknowledgeNullFocus(afterFocus)
    expect(afterDeselect.isFlying).toBe(true) // deselecting alone doesn't interrupt an in-progress flight
    expect(focusChanged(afterDeselect, null)).toBe(false)
    // A later, genuinely new focus must still register as changed.
    expect(focusChanged(afterDeselect, focusAt([2, 0, 0]))).toBe(true)
  })
})

describe('beginFlight', () => {
  it('starts from the LIVE camera/target passed in, not any prior flight state', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const next = beginFlight(state, {
      focus: focusAt([5, 0, 0]),
      focusedId: 'a',
      currentCameraPos: [1, 2, 3],
      currentTargetPos: [0, 0, 0],
      trackedPosition: null,
      nowMs: 100,
    })
    expect(next.isFlying).toBe(true)
    expect(next.flight.startPosition).toEqual([1, 2, 3])
    expect(next.flight.startTarget).toEqual([0, 0, 0])
    expect(next.flight.startTimeMs).toBe(100)
  })

  it('ends exactly at focus.position, at focus.distance along the resolved direction', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const focus = focusAt([10, 0, 0], { distance: 5 })
    const next = beginFlight(state, {
      focus,
      focusedId: 'a',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    expect(next.flight.endTarget).toEqual([10, 0, 0])
    const dist = Math.hypot(...next.flight.endPosition.map((v, i) => v - focus.position[i]!))
    expect(dist).toBeCloseTo(5, 9)
  })

  // Sixth real, observed bug (see CameraRig.tsx's own header): the flight's
  // endpoint must be a FIXED snapshot of `focus` at the moment the flight
  // starts, never re-derived from a live tracked position later — that's
  // exactly what let a fast orbiter's motion alias into visible jitter.
  it('fixes the endpoint at flight start — later calls with a different trackedPosition never change it', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const focus = focusAt([10, 0, 0])
    const afterBegin = beginFlight(state, {
      focus,
      focusedId: 'a',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: [1, 1, 1],
      nowMs: 0,
    })
    const sampleEarly = sampleFlight(afterBegin, 0)
    const sampleLate = sampleFlight(afterBegin, FLY_DURATION_MS)
    // The endpoint itself (not just a sample) must be untouched by anything
    // other than the ORIGINAL beginFlight call.
    expect(afterBegin.flight.endTarget).toEqual([10, 0, 0])
    expect(sampleLate.target).toEqual([10, 0, 0])
    expect(sampleEarly.progress).toBe(0)
    expect(sampleLate.progress).toBe(1)
  })

  // First real, observed bug: BOTH the outgoing and incoming body must stay
  // excluded from collision for the flight's whole duration, not just the
  // incoming one — otherwise the outgoing body's own collider yanks the
  // still-nearby live camera the instant it becomes solid again.
  it('excludes both the outgoing and incoming body from collision for the duration of the flight', () => {
    const state = { ...createFlightLifecycleState(INITIAL_DIRECTION), previousFocusedId: 'earth' }
    const next = beginFlight(state, {
      focus: focusAt([10, 0, 0]),
      focusedId: 'moon',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    expect([...next.excludedColliderIds].sort()).toEqual(['earth', 'moon'])
    expect(next.previousFocusedId).toBe('moon')
  })

  it('excludes only the incoming body when there was no prior selection', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const next = beginFlight(state, {
      focus: focusAt([10, 0, 0]),
      focusedId: 'moon',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    expect([...next.excludedColliderIds]).toEqual(['moon'])
  })
})

describe('settleFlight', () => {
  it('narrows the collider exclusion down to just the current selection', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const flying = beginFlight(state, {
      focus: focusAt([10, 0, 0]),
      focusedId: 'moon',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    const settled = settleFlight(flying, 'moon')
    expect(settled.isFlying).toBe(false)
    expect([...settled.excludedColliderIds]).toEqual(['moon'])
  })

  it('excludes nothing once settled if nothing is selected', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const flying = beginFlight(state, {
      focus: focusAt([10, 0, 0]),
      focusedId: 'moon',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    const settled = settleFlight(flying, null)
    expect(settled.excludedColliderIds.size).toBe(0)
  })
})

describe('sampleFlight', () => {
  // Third real, observed bug: settling has to be driven by ELAPSED TIME
  // (FLY_DURATION_MS), not a promise that structurally can't resolve while
  // the destination keeps moving — this is exactly what `progress` is for.
  it('reaches progress 1 exactly at FLY_DURATION_MS and clamps beyond it', () => {
    const state = beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), {
      focus: focusAt([10, 0, 0]),
      focusedId: 'a',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 1_000,
    })
    expect(sampleFlight(state, 1_000).progress).toBe(0)
    expect(sampleFlight(state, 1_000 + FLY_DURATION_MS).progress).toBe(1)
    expect(sampleFlight(state, 1_000 + FLY_DURATION_MS * 10).progress).toBe(1)
  })

  it('never reports negative progress for a nowMs before the flight started', () => {
    const state = beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), {
      focus: focusAt([10, 0, 0]),
      focusedId: 'a',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 1_000,
    })
    expect(sampleFlight(state, 500).progress).toBe(0)
  })
})

describe('advanceSteadyTracking', () => {
  it('reports no delta with nothing tracked', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const { delta, state: next } = advanceSteadyTracking(state, null)
    expect(delta).toBeNull()
    expect(next.lastTrackedPosition).toBeNull()
  })

  it('reports no delta on the first frame a body is tracked (nothing to compare against yet)', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const { delta, state: next } = advanceSteadyTracking(state, [1, 2, 3])
    expect(delta).toBeNull()
    expect(next.lastTrackedPosition).toEqual([1, 2, 3])
  })

  it('reports exactly how far the body moved since the last frame', () => {
    let state = createFlightLifecycleState(INITIAL_DIRECTION)
    state = advanceSteadyTracking(state, [1, 2, 3]).state
    const { delta } = advanceSteadyTracking(state, [4, 2, 5])
    expect(delta).toEqual([3, 0, 2])
  })

  it('reports no delta once the body genuinely stops moving', () => {
    let state = createFlightLifecycleState(INITIAL_DIRECTION)
    state = advanceSteadyTracking(state, [1, 2, 3]).state
    const { delta } = advanceSteadyTracking(state, [1, 2, 3])
    expect(delta).toBeNull()
  })
})

describe('recordLiveTrackedPosition', () => {
  // Keeps the steady-state baseline fresh DURING a flight (see
  // CameraRig.tsx's own comment) so the very first post-flight tracking
  // delta is an ordinary one-frame motion, not a big correction.
  it('updates lastTrackedPosition without touching anything else about the flight', () => {
    const flying = beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), {
      focus: focusAt([10, 0, 0]),
      focusedId: 'a',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    const updated = recordLiveTrackedPosition(flying, [7, 8, 9])
    expect(updated.lastTrackedPosition).toEqual([7, 8, 9])
    expect(updated.isFlying).toBe(true)
    expect(updated.flight).toBe(flying.flight)
  })
})

describe('a full flight-then-settle-then-track sequence, mirroring CameraRig.tsx\'s own useFrame loop', () => {
  it('flies, settles at FLY_DURATION_MS, then tracks steadily with no discontinuity', () => {
    let state = createFlightLifecycleState(INITIAL_DIRECTION)
    const focus = focusAt([10, 0, 0], { distance: 5 })

    state = beginFlight(state, {
      focus,
      focusedId: 'moon',
      currentCameraPos: [0, 0, 20],
      currentTargetPos: [0, 0, 0],
      trackedPosition: [10, 0, 0],
      nowMs: 0,
    })
    expect(state.isFlying).toBe(true)

    const midSample = sampleFlight(state, FLY_DURATION_MS / 2)
    expect(midSample.progress).toBeGreaterThan(0)
    expect(midSample.progress).toBeLessThan(1)
    state = recordLiveTrackedPosition(state, [10, 0, 0])

    const finalSample = sampleFlight(state, FLY_DURATION_MS)
    expect(finalSample.progress).toBe(1)
    state = recordLiveTrackedPosition(state, [10, 0, 0])
    state = settleFlight(state, 'moon')
    expect(state.isFlying).toBe(false)

    // Steady tracking picks up seamlessly: the body hasn't moved since the
    // last recorded position, so the very first post-flight frame reports
    // no delta at all (not a big "catch up" jump).
    const { delta } = advanceSteadyTracking(state, [10, 0, 0])
    expect(delta).toBeNull()

    // A genuine subsequent move IS reported.
    const { delta: nextDelta } = advanceSteadyTracking(state, [11, 0, 0])
    expect(nextDelta).toEqual([1, 0, 0])
  })
})
