import type { SystemDataWarning } from '../validateSystemData'

/** A one-line title + detail string for any SystemDataWarning kind — see
 *  validateSystemData.ts for what each kind means. Kept here (not in the
 *  engine's own data layer) since it's purely a display concern. */
export function describeDataWarning(w: SystemDataWarning): { title: string; detail: string } {
  switch (w.kind) {
    case 'missing-position':
      return { title: w.bodyName, detail: 'no orbit or fixedPosition — renders at the origin' }
    case 'unrecognized-type':
      return { title: w.bodyName, detail: `unrecognized type "${w.type}"` }
    case 'embedded-in-parent':
      return {
        title: w.bodyName,
        detail: `${w.distanceKm.toFixed(0)} km inside ${w.parentName} (${w.parentRadiusKm.toLocaleString()} km radius)`,
      }
    case 'embedded-in-sibling':
      return {
        title: `${w.bodyName} / ${w.otherBodyName}`,
        detail: `${w.distanceKm.toFixed(0)} km apart (radii ${w.bodyRadiusKm.toLocaleString()}/${w.otherBodyRadiusKm.toLocaleString()} km)`,
      }
    case 'invalid-ring':
      return { title: `ring on ${w.bodyId}`, detail: w.message }
    case 'invalid-belt':
      return { title: `belt ${w.beltId}`, detail: w.message }
  }
}
