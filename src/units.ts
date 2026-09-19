/**
 * Distance display formatting — km/Mm/Gm, the units Star Citizen's own UI
 * uses (a quantum travel readout says "12.4 Mm", not "0.00008 AU"), for
 * Star Citizen system data. This is deliberately separate from the AU
 * formatting used for the Solar System reference dataset (see
 * OrbitalSystemScene.tsx's info panel) — AU is the right convention for
 * real astronomy, but reads as a wall of leading zeros at Star Citizen's
 * much smaller, sub-AU system scale, exactly the "0.00–0.01 AU" belt
 * readout this exists to replace.
 *
 * Display-only: this never touches the underlying km values used by the
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
