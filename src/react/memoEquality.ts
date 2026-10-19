/**
 * A React.memo comparator for scene components whose props include world
 * positions. SceneContent re-resolves every body's position each time it
 * renders (resolveAllWorldPositions returns fresh `[x, y, z]` arrays even
 * when nothing moved — paused time, a fixed-position system), so a plain
 * shallow memo would never skip a render. Numeric arrays are compared
 * element-wise; every other prop by identity (Object.is).
 */
export function propsEqualWithVectors<P extends object>(prev: Readonly<P>, next: Readonly<P>): boolean {
  const prevKeys = Object.keys(prev) as (keyof P)[]
  const nextKeys = Object.keys(next) as (keyof P)[]
  if (prevKeys.length !== nextKeys.length) return false
  for (const key of prevKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return false
    if (!valuesEqual(prev[key], next[key])) return false
  }
  return true
}

function isNumericArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number')
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!isNumericArray(a) || !isNumericArray(b) || a.length !== b.length || a.length === 0) return false
  return a.every((v, i) => Object.is(v, b[i]))
}
