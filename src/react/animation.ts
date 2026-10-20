/**
 * Small, dependency-free animation math shared across the rendering layer —
 * pulled out specifically so it's unit-testable without a real WebGL
 * context (see ARCHITECTURE.md's "Two-tier testing" section): everything
 * else in src/react/ needs an actual renderer to verify, but this doesn't.
 */

/** Moves `current` toward `target` by at most `maxStep`, clamping exactly
 *  at the target rather than overshooting — the frame-rate-independent
 *  core of BodyMarker's visibility fade (see its own useFrame): call this
 *  once per frame with `maxStep = delta / durationSeconds` and it reaches
 *  the target in exactly `durationSeconds` regardless of frame rate. */
export function stepToward(current: number, target: number, maxStep: number): number {
  const diff = target - current
  return Math.abs(diff) <= maxStep ? target : current + Math.sign(diff) * maxStep
}

/** How long a body takes to grow in / shrink out when it crosses in or
 *  out of the visible set (see ProximitySelector's screen-space thinning
 *  and computeVisibleBodyIds' rank-and-cap) — replaces what used to be an
 *  instant pop the moment a hard distance cliff was crossed, which could
 *  make a body vanish entirely from what looked like a trivial zoom
 *  change. Shared by BodyMarker and the instanced small bodies
 *  (InstancedBodies), so both fade alike. */
export const VISIBILITY_FADE_SECONDS = 0.3
