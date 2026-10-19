import { useEffect, useState } from 'react'
import {
  computeFocusForBelt,
  computeFocusForBody,
  computeFocusForSystem,
  planFocusFlight,
  safePredictFlightTarget,
  type CameraPose,
  type FlightPacing,
  type FocusTarget,
} from '../camera'
import type { BeltRegion, CelestialBody, StarSystemData } from '../types'
import {
  childTarget,
  parentTarget,
  parseSelectionValue,
  resolveSelection,
  type Selection,
  type SystemIndex,
} from './selectionNavigation'
import { flightTargetDate } from './simulationTime'
import type { ActionLog } from './useActionLog'
import type { SimulationClock } from './useSimulationClock'
import { useStableCallback } from './useStableCallback'

export interface SelectionNavigationOptions {
  system: StarSystemData
  index: SystemIndex
  clock: SimulationClock
  log: ActionLog
  onSelectBody?: (body: CelestialBody) => void
  externalFocus?: { bodyId: string; token: number } | null
  /** Runs inside the system-reset effect, after selection/focus are reset
   *  — the scene uses it to clear the interaction store and restart the
   *  action log's session. */
  onSystemChange: () => void
  /** The camera's live pose (CameraRig writes it every frame) — a new
   *  flight's duration is planned from it, and a moving destination's
   *  arrival predicted for that duration (see camera.ts's planFocusFlight).
   *  null before the first frame. */
  cameraPose?: { readonly current: CameraPose | null }
  /** See OrbitalSystemSceneProps.flightPacing. */
  flightPacing?: FlightPacing
}

export interface SelectionNavigation {
  selection: Selection
  selectedBody: CelestialBody | null
  selectedBelt: BeltRegion | null
  focus: FocusTarget | null
  canGoUp: boolean
  canGoDown: boolean
  // Every callback below has a stable identity (see useStableCallback).
  selectBody(body: CelestialBody): void
  selectFromDropdown(value: string): void
  goUp(): void
  goDown(): void
  recenter(): void
  reset(): void
}

/**
 * What's selected, where the camera should fly, and every toolbar/map
 * action that changes either — plus the two effects that reset/override
 * them from outside (a system switch; an externalFocus request).
 */
export function useSelectionNavigation(options: SelectionNavigationOptions): SelectionNavigation {
  const { system, index, clock, log } = options
  const [selection, setSelection] = useState<Selection>(null)
  const [focus, setFocus] = useState<FocusTarget | null>(null)
  const resolved = resolveSelection(selection, index)
  const { selectedBody, selectedBelt } = resolved

  const targetDate = (durationMs: number): Date => flightTargetDate(clock.simDate, clock.playing, clock.daysPerSecond, durationMs)

  // Plans the flight's duration from the live camera pose first, then
  // predicts the arrival for exactly that duration — see planFocusFlight.
  // The flight reuses that duration (FocusTarget.flightDurationMs), so a
  // moving destination is where the prediction said when the flight lands.
  function planned(focusAt: (durationMs: number) => FocusTarget): FocusTarget {
    return planFocusFlight(focusAt, options.cameraPose?.current ?? null, options.flightPacing)
  }

  // computeFocusForBody, plus (while playing) where `body` will REALLY be
  // at each moment of the flight there, not just at its predicted end point
  // — see safePredictFlightTarget and FocusTarget.predictedTargetAt's own
  // comments. Skipped entirely while paused: simDate === flightTargetDate()
  // in that case, so every sample would be identical to the single fixed
  // endpoint computeFocusForBody already predicts, same reasoning
  // flightTargetDate itself already uses.
  function focusOnBodyWithTrajectory(body: CelestialBody, previousBody: CelestialBody | null = null): FocusTarget {
    return planned((durationMs) => {
      const target = computeFocusForBody(body, system, targetDate(durationMs), previousBody)
      const predictedTargetAt = clock.playing
        ? (safePredictFlightTarget(body, system, clock.simDate, clock.daysPerSecond, target.distance, durationMs) ?? undefined)
        : undefined
      return { ...target, predictedTargetAt }
    })
  }
  const focusOnBelt = (belt: BeltRegion): FocusTarget => planned((ms) => computeFocusForBelt(belt, system, targetDate(ms)))
  const focusOnSystem = (): FocusTarget => planned((ms) => computeFocusForSystem(system, targetDate(ms)))

  // Split from selectBody (below) on purpose: this updates the scene's own
  // selection/camera state only, without notifying onSelectBody — used by
  // the externalFocus effect further down, so that flying the camera to an
  // ALREADY-CHOSEN location (the route planner's "jump to this object"
  // button) doesn't ALSO re-fire onSelectBody as if the user had just
  // freshly clicked a body on the map. Real, observed bug this fixes: the
  // route planner's onSelectBody handler fills whichever of
  // origin/destination is "active" and then flips which one is active —
  // exactly right for a genuine map click, but firing that same logic
  // again right after a jump-to-location click (which already knows
  // exactly which field it's for) stomped the field the jump had just set
  // and silently flipped the active slot out from under the user.
  function focusOnBody(body: CelestialBody): void {
    // The OUTGOING body (before this selection replaces it) — passed
    // through so computeFocusForBody can find a shared context body (see
    // camera.ts's findContextBody) to keep in frame mid-flight, e.g.
    // Earth for a flight between the ISS and Hubble. null when nothing
    // (or a belt) was selected before this.
    setSelection({ kind: 'body', id: body.id })
    setFocus(focusOnBodyWithTrajectory(body, selectedBody))
    log.recordAction({ type: 'select-body', bodyId: body.id })
  }
  function selectBodyNow(body: CelestialBody): void {
    focusOnBody(body)
    options.onSelectBody?.(body)
  }
  function selectBelt(belt: BeltRegion): void {
    setSelection({ kind: 'belt', id: belt.id })
    setFocus(focusOnBelt(belt))
    log.recordAction({ type: 'select-belt', beltId: belt.id })
  }

  const parent = parentTarget(resolved, index)
  const child = childTarget(resolved, index)

  const selectBody = useStableCallback(selectBodyNow)
  const selectFromDropdown = useStableCallback((value: string) => {
    const picked = parseSelectionValue(value)
    if (!picked) return
    if (picked.kind === 'body') {
      const body = index.bodiesById.get(picked.id)
      if (body) selectBodyNow(body)
    } else {
      const belt = index.beltsById.get(picked.id)
      if (belt) selectBelt(belt)
    }
  })
  // "Up" always lands on a body — see parentTarget. Disabled once there's
  // nowhere further up to go (the star itself).
  const goUp = useStableCallback(() => {
    if (!parent) return
    selectBodyNow(parent)
    log.recordAction({ type: 'up' })
  })
  // "Down" descends into the first real child of the selected body — see
  // childTarget. No-op for a belt (nothing orbits a belt) or a childless body.
  const goDown = useStableCallback(() => {
    if (!child) return
    selectBodyNow(child)
    log.recordAction({ type: 'down' })
  })
  const recenter = useStableCallback(() => {
    if (selectedBody) setFocus(focusOnBodyWithTrajectory(selectedBody))
    else if (selectedBelt) setFocus(focusOnBelt(selectedBelt))
    log.recordAction({ type: 'recenter' })
  })
  const reset = useStableCallback(() => {
    setSelection(null)
    setFocus(focusOnSystem())
    log.recordAction({ type: 'reset' })
  })

  // Frame the whole system on first load, and again whenever a different
  // system is loaded in (e.g. switching between star systems in a
  // multi-system app) — without this, a newly-loaded system keeps whatever
  // camera position the previous one left behind, which is almost never a
  // sane framing for it.
  useEffect(() => {
    setSelection(null)
    setFocus(focusOnSystem())
    options.onSystemChange()
    // Deliberately keyed on system.id alone, not simDate (which ticks every
    // frame) or the callbacks — this must re-run only when a genuinely
    // different system loads in, not on every simulation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.id])

  // An externally-requested selection (see ExternalFocusRequest) —
  // deliberately registered AFTER the system-reset effect above, so on a
  // cross-system jump (system.id AND externalFocus changing together in one
  // commit) this runs second and wins, landing on the actually-requested
  // body instead of getting overwritten back to "nothing selected, whole
  // system framed."
  const externalBodyId = options.externalFocus?.bodyId
  const externalToken = options.externalFocus?.token
  useEffect(() => {
    if (externalBodyId === undefined) return
    const body = index.bodiesById.get(externalBodyId)
    // focusOnBody, not selectBody — see focusOnBody's own comment: this is
    // an already-chosen location's camera catching up, not a fresh user
    // pick, so it must not re-fire onSelectBody.
    if (body) focusOnBody(body)
    // Deliberately NOT depending on focusOnBody itself (a new closure every
    // render, capturing system/simDate — including it would re-run this
    // effect constantly and fight the intentional ordering described
    // above) — externalFocus.bodyId/token and system.id are the only
    // things that should actually trigger a fresh fly-to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalBodyId, externalToken, system.id])

  return {
    selection,
    selectedBody,
    selectedBelt,
    focus,
    canGoUp: parent !== null,
    canGoDown: child !== null,
    selectBody,
    selectFromDropdown,
    goUp,
    goDown,
    recenter,
    reset,
  }
}
