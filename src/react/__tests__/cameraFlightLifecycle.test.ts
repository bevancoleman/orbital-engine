import { DEFAULT_VIEW_DIRECTION, flightDurationMs, type CameraObstacle, type FocusTarget } from '../../camera'
import {
  acknowledgeNullFocus,
  advanceCameraFrame,
  advanceSteadyTracking,
  beginFlight,
  createFlightLifecycleState,
  describeCameraActivity,
  focusChanged,
  interruptFlight,
  releaseClearedColliders,
  sameCameraActivity,
  sampleFlight,
  settleFlight,
  trackingViewingDistance,
  type CameraFlightLifecycleState,
} from '../cameraFlightLifecycle'
import type { WorldVec } from '../../render'

const INITIAL_DIRECTION: WorldVec = DEFAULT_VIEW_DIRECTION

/** The duration these tests' focuses carry (FocusTarget.flightDurationMs)
 *  — a planned flight's length, as useSelectionNavigation would set it. */
const FLY_DURATION_MS = 900

function focusAt(position: WorldVec, overrides: Partial<FocusTarget> = {}): FocusTarget {
  return { position, distance: 10, lookBias: null, contextBody: null, flightDurationMs: FLY_DURATION_MS, ...overrides }
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

  // Real bug: retargeting A -> B -> C before the first flight settled
  // replaced the exclusions with just {C, B}, so A became solid again while
  // the camera could still be inside it — an instant distance yank.
  it('keeps every body from an interrupted flight excluded when retargeting mid-flight', () => {
    const toB = beginFlight(
      { ...createFlightLifecycleState(INITIAL_DIRECTION), previousFocusedId: 'a' },
      {
        focus: focusAt([10, 0, 0]),
        focusedId: 'b',
        currentCameraPos: [0, 0, 20],
        currentTargetPos: [0, 0, 0],
        trackedPosition: null,
        nowMs: 0,
      }
    )
    const toC = beginFlight(toB, {
      focus: focusAt([20, 0, 0]),
      focusedId: 'c',
      currentCameraPos: [5, 0, 10],
      currentTargetPos: [5, 0, 0],
      trackedPosition: null,
      nowMs: 100,
    })
    expect([...toC.excludedColliderIds].sort()).toEqual(['a', 'b', 'c'])
  })

  // The planned duration is what a moving body's arrival was predicted
  // for — the flight must land at exactly that moment.
  it('uses the focus\'s own planned flightDurationMs when it has one', () => {
    const state = beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), {
      focus: focusAt([10, 0, 0], { flightDurationMs: 2_345 }),
      focusedId: 'a',
      currentCameraPos: [0, 0, 20],
      currentTargetPos: [0, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    expect(state.flight.durationMs).toBe(2_345)
    expect(sampleFlight(state, 2_344).progress).toBeLessThan(1)
    expect(sampleFlight(state, 2_345).progress).toBe(1)
  })

  it('computes the duration from its own endpoints and pacing when the focus has none', () => {
    const params = {
      focus: focusAt([10, 0, 0], { flightDurationMs: undefined, distance: 1e-4 }),
      focusedId: 'a',
      currentCameraPos: [0, 0, 20] as WorldVec,
      currentTargetPos: [0, 0, 0] as WorldVec,
      trackedPosition: null,
      nowMs: 0,
    }
    const state = beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), params)
    const expected = flightDurationMs(state.flight)
    expect(state.flight.durationMs).toBe(expected)
    expect(expected).toBeGreaterThan(1_200)
    const fast = beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), { ...params, pacing: { speed: 2, minMs: 1 } })
    expect(fast.flight.durationMs).toBeCloseTo(expected / 2, 6)
  })

  // A -> B -> C: the new flight starts from wherever the camera visibly
  // is mid-way to B — no jump on the retarget frame.
  it('starts a mid-flight retarget exactly where the interrupted flight had got to', () => {
    const toB = beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), {
      focus: focusAt([10, 0, 0]),
      focusedId: 'b',
      currentCameraPos: [0, 0, 20],
      currentTargetPos: [0, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    const live = sampleFlight(toB, 400)
    const toC = beginFlight(toB, {
      focus: focusAt([0, 30, 0]),
      focusedId: 'c',
      currentCameraPos: live.position,
      currentTargetPos: live.target,
      trackedPosition: null,
      nowMs: 400,
    })
    const first = sampleFlight(toC, 400)
    expect(first.position).toEqual(live.position)
    expect(first.target).toEqual(live.target)
    // ...and eases away from there rather than lurching on the next frame.
    const next = sampleFlight(toC, 416)
    const step = Math.hypot(next.position[0] - live.position[0], next.position[1] - live.position[1], next.position[2] - live.position[2])
    const later = sampleFlight(toC, 400 + FLY_DURATION_MS / 2)
    const midStep = Math.hypot(...(subtractPoints(sampleFlight(toC, 416 + FLY_DURATION_MS / 2).position, later.position)))
    expect(step).toBeLessThan(midStep)
  })
})

function subtractPoints(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

describe('settleFlight', () => {
  it('ends the flight and drops the tracking anchor so the next steady frame re-anchors absolutely', () => {
    const flying = beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), {
      focus: focusAt([10, 0, 0]),
      focusedId: 'moon',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: [10, 0, 0],
      nowMs: 0,
    })
    const settled = settleFlight(flying)
    expect(settled.isFlying).toBe(false)
    expect(settled.lastTrackedPosition).toBeNull()
  })

  it('leaves collider exclusions for releaseClearedColliders to narrow once the camera is actually clear', () => {
    const state = { ...createFlightLifecycleState(INITIAL_DIRECTION), previousFocusedId: 'earth' }
    const flying = beginFlight(state, {
      focus: focusAt([10, 0, 0]),
      focusedId: 'moon',
      currentCameraPos: [10, 0, 20],
      currentTargetPos: [10, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    expect([...settleFlight(flying).excludedColliderIds].sort()).toEqual(['earth', 'moon'])
  })
})

describe('interruptFlight (zoom slider mid-flight)', () => {
  // Real bug: the slider used to settle a flight wherever its tween
  // happened to be — e.g. 38% of the way from Earth to the Moon — and then
  // track empty space from that frozen mid-flight look-at point.
  function midFlight(): CameraFlightLifecycleState {
    return beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), {
      focus: focusAt([100, 0, 0]),
      focusedId: 'moon',
      currentCameraPos: [0, 0, 20],
      currentTargetPos: [0, 0, 0],
      trackedPosition: [0, 0, 0],
      nowMs: 0,
    })
  }

  it('re-anchors on the live tracked body when there is one', () => {
    const { state, anchor } = interruptFlight(midFlight(), [101, 0, 0])
    expect(state.isFlying).toBe(false)
    expect(anchor).toEqual([101, 0, 0])
    expect(state.lastTrackedPosition).toEqual([101, 0, 0])
  })

  it("falls back to the flight's own destination when nothing is tracked (a belt or system focus)", () => {
    expect(interruptFlight(midFlight(), null).anchor).toEqual([100, 0, 0])
  })
})

describe('releaseClearedColliders', () => {
  const earth: CameraObstacle = { id: 'earth', position: [0, 0, 0], radius: 1 }
  const moon: CameraObstacle = { id: 'moon', position: [10, 0, 0], radius: 0.25 }
  function settledWith(excluded: string[]): CameraFlightLifecycleState {
    return { ...createFlightLifecycleState(INITIAL_DIRECTION), excludedColliderIds: new Set(excluded) }
  }

  it('narrows to just the current selection once the camera is clear of the outgoing body', () => {
    const next = releaseClearedColliders(settledWith(['earth', 'moon']), {
      focusedId: 'moon',
      cameraPos: [10, 0, 2],
      targetPos: [10, 0, 0],
      colliderBodies: [earth, moon],
    })
    expect([...next.excludedColliderIds]).toEqual(['moon'])
  })

  it('keeps the outgoing body excluded while it still sits between the camera and its target', () => {
    // Camera on the far side of Earth from the Moon — re-enabling Earth's
    // collider here is exactly the instant distance yank the exclusion
    // window exists to prevent.
    const next = releaseClearedColliders(settledWith(['earth', 'moon']), {
      focusedId: 'moon',
      cameraPos: [-5, 0, 0],
      targetPos: [10, 0, 0],
      colliderBodies: [earth, moon],
    })
    expect([...next.excludedColliderIds].sort()).toEqual(['earth', 'moon'])
  })

  it('releases the last selection after a deselect once the camera clears it (it used to stay excluded forever)', () => {
    const inside = releaseClearedColliders(settledWith(['moon']), {
      focusedId: null,
      cameraPos: [10, 0, 0.1],
      targetPos: [10, 0, 0],
      colliderBodies: [earth, moon],
    })
    expect([...inside.excludedColliderIds]).toEqual(['moon'])
    const clear = releaseClearedColliders(inside, {
      focusedId: null,
      cameraPos: [10, 0, 5],
      targetPos: [10, 0, 4],
      colliderBodies: [earth, moon],
    })
    expect(clear.excludedColliderIds.size).toBe(0)
  })

  it('never narrows during a flight, and returns the same state object when nothing changes', () => {
    const params = {
      focusedId: 'moon',
      cameraPos: [10, 0, 2] as WorldVec,
      targetPos: [10, 0, 0] as WorldVec,
      colliderBodies: [earth, moon],
    }
    const flying = { ...settledWith(['earth', 'moon']), isFlying: true }
    expect(releaseClearedColliders(flying, params)).toBe(flying)
    const settled = settledWith(['moon'])
    expect(releaseClearedColliders(settled, params)).toBe(settled)
  })
})

describe('sampleFlight', () => {
  // Third real, observed bug: settling has to be driven by ELAPSED TIME
  // (the flight's own durationMs), not a promise that structurally can't resolve while
  // the destination keeps moving — this is exactly what `progress` is for.
  it('reaches progress 1 exactly at the flight\'s duration and clamps beyond it', () => {
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

  // Review finding A2's own scenario: a flight past Earth (radius 0.0055 at
  // the origin) from a wide shot down to a true-scale close-up on the far
  // side. The context bulge used to snap the view ~29° in a single frame at
  // the moment the context body stopped fitting the natural framing.
  it('never turns the view by more than a fraction of a degree between finely-spaced samples across the bulge crossover', () => {
    const state = beginFlight(createFlightLifecycleState([0, 1, 0]), {
      focus: focusAt([-0.006, 1e-4, 0], { distance: 1e-6, contextBody: { position: [0, 0, 0], radius: 0.0055 } }),
      focusedId: 'hubble',
      currentCameraPos: [0.0059, 5, 0],
      currentTargetPos: [0.0059, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })
    const samples = 5400 // 100x the real 60fps frame density
    const viewAt = (i: number): WorldVec => {
      const { position, target } = sampleFlight(state, (i / samples) * FLY_DURATION_MS)
      return [target[0] - position[0], target[1] - position[1], target[2] - position[2]]
    }
    let worst = 0
    let previous = viewAt(0)
    for (let i = 1; i <= samples; i++) {
      const current = viewAt(i)
      const cos =
        (previous[0] * current[0] + previous[1] * current[1] + previous[2] * current[2]) /
        (Math.hypot(...previous) * Math.hypot(...current))
      worst = Math.max(worst, (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI)
      previous = current
    }
    expect(worst).toBeLessThan(1)
  })
})

describe('advanceSteadyTracking', () => {
  it('reports no anchor with nothing tracked', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const { anchor, state: next } = advanceSteadyTracking(state, null)
    expect(anchor).toBeNull()
    expect(next.lastTrackedPosition).toBeNull()
  })

  it('anchors absolutely on the very first tracked frame (nothing anchored yet)', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    const { anchor, state: next } = advanceSteadyTracking(state, [1, 2, 3])
    expect(anchor).toEqual([1, 2, 3])
    expect(next.lastTrackedPosition).toEqual([1, 2, 3])
  })

  it("anchors on the body's live position whenever it moves", () => {
    let state = createFlightLifecycleState(INITIAL_DIRECTION)
    state = advanceSteadyTracking(state, [1, 2, 3]).state
    expect(advanceSteadyTracking(state, [4, 2, 5]).anchor).toEqual([4, 2, 5])
  })

  it('reports no anchor once the body genuinely stops moving (leaves manual panning alone while paused)', () => {
    let state = createFlightLifecycleState(INITIAL_DIRECTION)
    state = advanceSteadyTracking(state, [1, 2, 3]).state
    expect(advanceSteadyTracking(state, [1, 2, 3]).anchor).toBeNull()
  })
})

/** Mirrors CameraRig's own per-frame sequence against a minimal stand-in
 *  for camera-controls: the camera is `target + offset`, a flight frame
 *  writes both (setLookAt), and a tracking anchor moves only the target
 *  (moveTo) — leaving the offset, the part the user orbits/dollies,
 *  untouched. Returns the steady-phase target-vs-body error per frame. */
function runRig(params: { bodyAt: (nowMs: number) => WorldVec; focus: FocusTarget; frameTimesMs: number[] }): {
  offset: WorldVec
  errors: number[]
} {
  let state = createFlightLifecycleState(INITIAL_DIRECTION)
  let target: WorldVec = [0, 0, 0]
  let offset: WorldVec = [0, 0, 20]
  const errors: number[] = []
  state = beginFlight(state, {
    focus: params.focus,
    focusedId: 'iss',
    currentCameraPos: offset,
    currentTargetPos: target,
    trackedPosition: params.bodyAt(0),
    nowMs: 0,
  })
  for (const nowMs of params.frameTimesMs) {
    const tracked = params.bodyAt(nowMs)
    if (state.isFlying) {
      const sample = sampleFlight(state, nowMs)
      target = sample.target
      offset = [sample.position[0] - target[0], sample.position[1] - target[1], sample.position[2] - target[2]]
      if (sample.progress >= 1) state = settleFlight(state)
    } else {
      const step = advanceSteadyTracking(state, tracked)
      state = step.state
      if (step.anchor) target = step.anchor
      errors.push(Math.hypot(target[0] - tracked[0], target[1] - tracked[1], target[2] - tracked[2]))
    }
  }
  return { offset, errors }
}

describe("a full flight-then-settle-then-track sequence, mirroring CameraRig.tsx's own useFrame loop", () => {
  it('flies, settles at FLY_DURATION_MS, then tracks steadily with no discontinuity', () => {
    const { errors, offset } = runRig({
      bodyAt: () => [10, 0, 0],
      focus: focusAt([10, 0, 0], { distance: 5 }),
      frameTimesMs: Array.from({ length: 120 }, (_, i) => (i + 1) * (1000 / 60)),
    })
    expect(errors.length).toBeGreaterThan(0)
    for (const error of errors) expect(error).toBe(0)
    expect(Math.hypot(...offset)).toBeCloseTo(5, 9)
  })

  // Real bug (review finding A1): steady tracking used to apply only
  // frame-to-frame deltas, so any gap between the flight's PREDICTED end
  // target and the body's real position at the moment of settling (render
  // lag, a settle frame landing a few ms past FLY_DURATION_MS, a smoothed
  // vs. raw position) was carried forward forever — for a fast orbiter at
  // high playback speed, enough to leave the body permanently off-screen.
  it('stays exactly on a MOVING body after an imperfectly-timed settle — no permanent drift', () => {
    const speed = 0.01 // world units per ms — huge relative to the 1e-3 framing distance below
    const bodyAt = (nowMs: number): WorldVec => [nowMs * speed, 0, 0]
    // Prediction deliberately 3ms stale (render lag), and frames that never
    // land exactly on FLY_DURATION_MS (the settle frame overshoots it).
    const focus = focusAt(bodyAt(FLY_DURATION_MS - 3), { distance: 1e-3 })
    const frameTimesMs = Array.from({ length: 200 }, (_, i) => 7 + i * 16.7)
    const { errors, offset } = runRig({ bodyAt, focus, frameTimesMs })
    expect(errors.length).toBeGreaterThan(100)
    // Every steady frame — including the very first one after settling —
    // has the target exactly on the live body, however far it's moved.
    for (const error of errors) expect(error).toBe(0)
    // ...and the camera's own offset (framing distance) survived intact.
    expect(Math.hypot(...offset)).toBeCloseTo(1e-3, 9)
  })
})

describe('describeCameraActivity / sameCameraActivity (observable state)', () => {
  const begin = (state: CameraFlightLifecycleState): CameraFlightLifecycleState =>
    beginFlight(state, {
      focus: focusAt([1, 0, 0]),
      focusedId: 'a',
      currentCameraPos: [0, 0, 10],
      currentTargetPos: [0, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })

  it('is idle with no flights before anything has happened', () => {
    const state = createFlightLifecycleState(INITIAL_DIRECTION)
    expect(describeCameraActivity(state, null)).toEqual({ state: 'idle', flightCount: 0 })
  })

  it('is flying while a flight is in progress, even with a tracked body', () => {
    const state = begin(createFlightLifecycleState(INITIAL_DIRECTION))
    expect(describeCameraActivity(state, [1, 0, 0])).toEqual({ state: 'flying', flightCount: 1 })
  })

  it('is tracking once settled on a tracked body, idle once settled on nothing tracked', () => {
    const settled = settleFlight(begin(createFlightLifecycleState(INITIAL_DIRECTION)))
    expect(describeCameraActivity(settled, [1, 0, 0]).state).toBe('tracking')
    expect(describeCameraActivity(settled, null).state).toBe('idle')
  })

  it('counts every flight start, including a retarget mid-flight, and an interrupted one stays counted', () => {
    const twice = begin(begin(createFlightLifecycleState(INITIAL_DIRECTION)))
    expect(twice.flightCount).toBe(2)
    expect(interruptFlight(twice, null).state.flightCount).toBe(2)
    expect(acknowledgeNullFocus(twice).flightCount).toBe(2)
  })

  it('compares field-wise, and treats "nothing reported yet" as different', () => {
    expect(sameCameraActivity(null, { state: 'idle', flightCount: 0 })).toBe(false)
    expect(sameCameraActivity({ state: 'idle', flightCount: 0 }, { state: 'idle', flightCount: 0 })).toBe(true)
    expect(sameCameraActivity({ state: 'tracking', flightCount: 1 }, { state: 'tracking', flightCount: 2 })).toBe(false)
    expect(sameCameraActivity({ state: 'flying', flightCount: 1 }, { state: 'tracking', flightCount: 1 })).toBe(false)
  })
})

describe('advanceCameraFrame', () => {
  const started = (): CameraFlightLifecycleState =>
    beginFlight(createFlightLifecycleState(INITIAL_DIRECTION), {
      focus: focusAt([100, 0, 0]),
      focusedId: 'iss',
      currentCameraPos: [0, 0, 10],
      currentTargetPos: [0, 0, 0],
      trackedPosition: null,
      nowMs: 0,
    })

  it('mid-flight: samples the tween only — no anchoring on the live body', () => {
    const step = advanceCameraFrame(started(), FLY_DURATION_MS / 2, [101, 0, 0])
    expect(step.state.isFlying).toBe(true)
    expect(step.lookAt).not.toBeNull()
    expect(step.anchor).toBeNull()
  })

  it('landing frame: settles AND anchors on the live body in the same frame, not the predicted end', () => {
    // The body is NOT where the flight predicted (simDate ticks at 100ms;
    // the landing frame is never exactly FLY_DURATION_MS) — the anchor has
    // to be the live position on this very frame, or it renders one frame
    // aimed at the prediction.
    const live: WorldVec = [103, 2, 0]
    const step = advanceCameraFrame(started(), FLY_DURATION_MS + 7, live)
    expect(step.state.isFlying).toBe(false)
    expect(step.lookAt!.target).toEqual([100, 0, 0])
    expect(step.anchor).toEqual(live)
    expect(step.state.lastTrackedPosition).toEqual(live)
  })

  it('landing frame with nothing tracked (a belt or the whole system): settles on the flight end, no anchor', () => {
    const step = advanceCameraFrame(started(), FLY_DURATION_MS, null)
    expect(step.state.isFlying).toBe(false)
    expect(step.lookAt).not.toBeNull()
    expect(step.anchor).toBeNull()
  })

  it('steady frames: no tween, anchors only when the body has moved', () => {
    const landed = advanceCameraFrame(started(), FLY_DURATION_MS, [100, 0, 0]).state
    const still = advanceCameraFrame(landed, FLY_DURATION_MS + 16, [100, 0, 0])
    expect(still.lookAt).toBeNull()
    expect(still.anchor).toBeNull()
    const moved = advanceCameraFrame(still.state, FLY_DURATION_MS + 32, [100, 1, 0])
    expect(moved.lookAt).toBeNull()
    expect(moved.anchor).toEqual([100, 1, 0])
  })
})

describe('trackingViewingDistance', () => {
  it('uses the reported distance with nothing focused', () => {
    expect(trackingViewingDistance(250, null)).toBe(250)
  })

  it('caps a stale, larger reported distance (a flight just landed) at the focus framing distance', () => {
    expect(trackingViewingDistance(250, focusAt([0, 0, 0], { distance: 4 }))).toBe(4)
  })

  it('keeps a smaller reported distance (the user zoomed in past the framing)', () => {
    expect(trackingViewingDistance(2, focusAt([0, 0, 0], { distance: 4 }))).toBe(2)
  })
})
