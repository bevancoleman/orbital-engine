/**
 * Tiny tuple-based 3-vector helpers shared by the camera math (camera.ts)
 * and the route simulator (routeCameraSimulator.ts), which used to each
 * keep their own copies. Plain `WorldVec` tuples in, fresh tuples out — no
 * three.js dependency, so everything built on these stays pure and
 * unit-testable.
 */

import type { WorldVec } from './render'

export function subtractVec3(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function addVec3(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function scaleVec3(a: WorldVec, s: number): WorldVec {
  return [a[0] * s, a[1] * s, a[2] * s]
}

export function lengthVec3(a: WorldVec): number {
  return Math.hypot(a[0], a[1], a[2])
}

export function dotVec3(a: WorldVec, b: WorldVec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function crossVec3(a: WorldVec, b: WorldVec): WorldVec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function lerpVec3(a: WorldVec, b: WorldVec, t: number): WorldVec {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Normalizes `v`, falling back to `fallback` (assumed already sane —
 *  never itself renormalized here) when `v` is degenerate (zero or
 *  near-zero length) rather than producing NaNs/Infinity. */
export function normalizeOr(v: WorldVec, fallback: WorldVec): WorldVec {
  const len = lengthVec3(v)
  return len > 1e-9 ? scaleVec3(v, 1 / len) : fallback
}

/** Angle in degrees between two vectors — 0 when either is (near) zero
 *  length, since there's no direction to be off FROM. */
export function angleBetweenDeg(a: WorldVec, b: WorldVec): number {
  const la = lengthVec3(a)
  const lb = lengthVec3(b)
  if (la < 1e-12 || lb < 1e-12) return 0
  const cos = Math.max(-1, Math.min(1, dotVec3(a, b) / (la * lb)))
  return (Math.acos(cos) * 180) / Math.PI
}

/** Some unit vector perpendicular to unit vector `a` — whichever world axis
 *  is least aligned with `a`, crossed with it, so the result is never
 *  degenerate. */
export function anyPerpendicularUnitVec3(a: WorldVec): WorldVec {
  const ax = Math.abs(a[0])
  const ay = Math.abs(a[1])
  const az = Math.abs(a[2])
  const axis: WorldVec = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1]
  return normalizeOr(crossVec3(a, axis), [1, 0, 0])
}
