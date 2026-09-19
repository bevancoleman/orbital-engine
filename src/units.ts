/**
 * Distance display formatting — km/Mm/Gm, scaled to whichever unit keeps
 * the number readable. AU (used elsewhere for the Solar System reference
 * dataset — see OrbitalSystemScene.tsx's info panel) is the right
 * convention for real astronomy, but for a dataset whose distances are all
 * well under 1 AU, it reads as a wall of leading zeros ("0.0003 AU"). This
 * exists for that case.
 *
 * Display-only: it never touches the underlying km values used by the
 * rest of the engine (rendering, camera-fit, orbital math all keep working
 * in km/AU as before) — same principle as the pixel floor in pixelFloor.ts,
 * a presentation-layer concern kept out of the real data.
 */

export function formatDistanceKm(km: number, digits = 2): string {
  const abs = Math.abs(km)
  if (abs >= 1_000_000) return `${(km / 1_000_000).toFixed(digits)} Gm`
  if (abs >= 1_000) return `${(km / 1_000).toFixed(digits)} Mm`
  return `${km.toFixed(digits)} km`
}
