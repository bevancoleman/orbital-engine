import * as THREE from 'three'

// True volumetric (raymarched-density) fog is a lot of machinery for what's
// actually needed here: belts reading as a soft haze instead of vanishing
// into sub-pixel dots once zoomed out. A soft radial-gradient sprite (drawn
// once to a canvas, reused for every belt) plus additive blending gets the
// same practical effect much more cheaply — overlapping glows merge into a
// hazy cloud exactly the way a real dust belt photograph looks, and unlike
// a hard-edged dot, a glow sprite still reads as "something's there" even
// well under a pixel in true size, at zoom levels where a plain dot would
// have already disappeared entirely.
let glowSpriteCache: THREE.CanvasTexture | null = null
export function glowSprite(): THREE.CanvasTexture {
  if (glowSpriteCache) return glowSpriteCache
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.4)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  glowSpriteCache = new THREE.CanvasTexture(canvas)
  return glowSpriteCache
}

/** A soft-edged radial-gradient ring texture — transparent at the centre,
 *  rising to the belt's own colour across [innerRatio, 1] of the radius,
 *  fading back out past the outer edge. Used for the full-ring glow layer
 *  (see BeltGlowRing) so a belt still reads as a visible, soft-edged band
 *  even when zoomed out far enough that individual particles fall below a
 *  pixel — a flat, filled shape doesn't disappear between pixel samples
 *  the way sparse points can. */
export function ringGlowTexture(innerRatio: number): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const r = size / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  const fadeIn = Math.max(0, innerRatio - 0.08)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(fadeIn, 'rgba(255,255,255,0)')
  gradient.addColorStop(innerRatio, 'rgba(255,255,255,0.18)')
  gradient.addColorStop((innerRatio + 1) / 2, 'rgba(255,255,255,0.3)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}
