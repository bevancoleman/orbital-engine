/**
 * Display strings for the info panel (see InfoPanel.tsx) — pure, so
 * they're unit-testable without rendering anything.
 */
import { AU_KM } from '../constants'
import { formatDistanceKm } from '../units'
import type { BeltRegion, CelestialBody } from '../types'

export { AU_KM }

export function formatAu(km: number, fractionDigits: number): string {
  return `${(km / AU_KM).toFixed(fractionDigits)} AU`
}

/** "dwarf planet", "surface installation", … */
export function bodyTypeLabel(type: string): string {
  return type.replace(/_/g, ' ')
}

/** A real orbiting system (the Solar System) quotes radii in plain km; a
 *  fixed-position one uses formatDistanceKm's scale-aware units. */
export function bodyRadiusText(body: CelestialBody, hasOrbitalMotion: boolean): string {
  return `radius: ${hasOrbitalMotion ? `${body.radiusKm.toLocaleString()} km` : formatDistanceKm(body.radiusKm)}`
}

export function beltExtentText(belt: BeltRegion, hasOrbitalMotion: boolean): string {
  return hasOrbitalMotion
    ? `${(belt.innerRadiusKm / AU_KM).toFixed(2)}–${(belt.outerRadiusKm / AU_KM).toFixed(2)} AU`
    : `${formatDistanceKm(belt.innerRadiusKm, 1)}–${formatDistanceKm(belt.outerRadiusKm, 1)}`
}

/** "co-orbital with Jupiter, +60°" — the reference body's name when it's
 *  in this system, its id otherwise. Null for an ordinary belt. */
export function coOrbitalText(belt: BeltRegion, bodiesById: ReadonlyMap<string, CelestialBody>): string | null {
  const coOrbital = belt.coOrbital
  if (!coOrbital) return null
  const name = bodiesById.get(coOrbital.bodyId)?.name ?? coOrbital.bodyId
  return `co-orbital with ${name}, ${coOrbital.leadAngleDeg > 0 ? '+' : ''}${coOrbital.leadAngleDeg}°`
}
