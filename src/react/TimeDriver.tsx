import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { TICK_INTERVAL_SECONDS, simulatedAdvanceMs } from './simulationTime'

/** Advances the simulated clock from inside the Canvas's render loop —
 *  must be mounted inside <Canvas>, since useFrame only works there. */
export function TimeDriver({
  playing,
  daysPerSecond,
  onTick,
}: {
  playing: boolean
  daysPerSecond: number
  onTick: (advanceMs: number) => void
}) {
  const accumulator = useRef(0)
  useFrame((_, delta) => {
    if (!playing) return
    accumulator.current += delta
    // Update ~10x/second rather than every frame — plenty smooth for
    // orbital motion, far cheaper than a full state update at 60fps.
    if (accumulator.current < TICK_INTERVAL_SECONDS) return
    const advanceMs = simulatedAdvanceMs(accumulator.current, daysPerSecond)
    accumulator.current = 0
    onTick(advanceMs)
  })
  return null
}
