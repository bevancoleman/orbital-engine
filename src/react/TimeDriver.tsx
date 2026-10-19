import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { stepPlayback } from './simulationTime'
import type { FramePositions } from './framePositions'

/** Runs before every other per-frame callback in the scene: CameraRig is
 *  at -2 and drei's CameraControls at -1, and both read this frame's
 *  positions. */
export const TIME_DRIVER_PRIORITY = -3

/**
 * Advances the simulated clock from inside the Canvas's render loop, every
 * frame, and re-resolves every body's position for the new time (see
 * framePositions.ts) — must be mounted inside <Canvas>, since useFrame only
 * works there. The date is committed to React state (UI text only) at a
 * much lower rate; see simulationTime.ts's stepPlayback.
 */
export function TimeDriver({
  playing,
  daysPerSecond,
  simTimeRef,
  advance,
  commit,
  frame,
}: {
  playing: boolean
  daysPerSecond: number
  simTimeRef: { readonly current: number }
  advance: (ms: number) => void
  commit: () => void
  frame: FramePositions
}) {
  const accumulator = useRef(0)
  useFrame((_, delta) => {
    if (playing) {
      const step = stepPlayback(accumulator.current, delta, daysPerSecond)
      accumulator.current = step.accumulatorSeconds
      advance(step.advanceMs)
      if (step.commit) commit()
    }
    // Also while paused: a no-op unless the time changed (see
    // FramePositions.update) — but a fresh `frame` for a newly loaded
    // system picks the current time up here.
    frame.update(simTimeRef.current)
  }, TIME_DRIVER_PRIORITY)
  return null
}
