/**
 * The built-in placeholder shapes' geometry and material, per shape and
 * level of detail — one definition shared by the full path (BodyShapes'
 * PlaceholderBodyShape, one mesh per body) and the instanced small-body
 * path (InstancedBodies, one InstancedMesh per shape). They used to be
 * written out twice, the instanced copy "kept in step" by a test; now
 * promoting a body from one path to the other draws exactly the same
 * parts by construction.
 *
 * Every shape is built at UNIT radius — the caller scales it to the
 * body's rendered radius (BodyShape's wrapping group, or the instance
 * matrix). See PlaceholderBodyShape for why: the rendered radius is
 * pixel-floored and changes on practically every zoom frame, and a
 * geometry should only be rebuilt when its LOD segment counts change.
 *
 * The star, comets and jump points (glow and tail sprites many times the
 * body's radius) aren't here: they're always drawn by BodyShapes itself.
 */
import * as THREE from 'three'
import { icosahedronDetailFor, sphereDetailFor, torusDetailFor } from '../levelOfDetail'
import type { BodyType } from '../types'
import { hashSeed } from './bodyTypeStyles'

/** One InstancedMesh per shape (two for surface_installation's base and
 *  spike) on the instanced path. */
export const PLACEHOLDER_SHAPES = ['planet', 'moon', 'plain', 'asteroid', 'station', 'nav_point', 'surface_installation'] as const
export type PlaceholderShape = (typeof PLACEHOLDER_SHAPES)[number]

/** Types whose placeholder has a glow or tail sprite (BodyShapes draws
 *  them itself). */
const SPRITE_TYPES: ReadonlySet<BodyType> = new Set(['star', 'comet', 'jump_point'])

/** The placeholder shape a body type draws as, or null for the sprite
 *  types BodyShapes draws itself. An unrecognised type is a plain sphere. */
export function placeholderShapeFor(type: BodyType): PlaceholderShape | null {
  if (SPRITE_TYPES.has(type)) return null
  switch (type) {
    case 'planet':
    case 'dwarf_planet':
      return 'planet'
    case 'moon':
    case 'asteroid':
    case 'station':
    case 'nav_point':
    case 'surface_installation':
      return type
    default:
      return 'plain'
  }
}

/** Shapes drawn at a fixed per-body orientation (placeholderRotation): an
 *  irregular rock reads as a rock, a station as built, not aligned. */
export const ROTATED_PLACEHOLDER_SHAPES: ReadonlySet<PlaceholderShape> = new Set(['asteroid', 'station', 'nav_point', 'surface_installation'])

/** Natural bodies, which `lightFromStar` shades analytically from the
 *  star's true direction (starLitMaterials.ts) rather than with three's
 *  lights — both on the full path and instanced. */
export const STAR_LIT_PLACEHOLDER_SHAPES: ReadonlySet<PlaceholderShape> = new Set(['planet', 'moon', 'asteroid'])

/** A body's fixed placeholder orientation (an XYZ Euler), seeded from its
 *  id so it never re-randomises between renders, or between the full and
 *  instanced paths. */
export function placeholderRotation(id: string): [number, number, number] {
  const seed = hashSeed(id)
  return [(seed % 620) / 100, ((seed * 7) % 620) / 100, ((seed * 13) % 620) / 100]
}

export type PlaceholderGeometrySpec =
  | { kind: 'sphere'; widthSegments: number; heightSegments: number }
  | { kind: 'icosahedron'; detail: number }
  | { kind: 'torus'; radialSegments: number; tubularSegments: number }
  | { kind: 'octahedron' }
  | { kind: 'platform' }
  | { kind: 'spike' }

export type PlaceholderMaterialSpec =
  | { kind: 'standard'; roughness: number; metalness: number; flatShading: boolean }
  | { kind: 'basic'; wireframe: boolean; opacity: number }

export interface PlaceholderPart {
  geometry: PlaceholderGeometrySpec
  material: PlaceholderMaterialSpec
}

/** The level of detail a shape is built at — levelOfDetail.ts's counts,
 *  as plain numbers so a component can memoize on them. */
export interface PlaceholderDetail {
  widthSegments: number
  heightSegments: number
  icosahedronDetail: number
  radialSegments: number
  tubularSegments: number
}

export function placeholderDetailFor(detailSize: number): PlaceholderDetail {
  const sphere = sphereDetailFor(detailSize)
  const torus = torusDetailFor(detailSize)
  return {
    widthSegments: sphere.widthSegments,
    heightSegments: sphere.heightSegments,
    icosahedronDetail: icosahedronDetailFor(detailSize),
    radialSegments: torus.radialSegments,
    tubularSegments: torus.tubularSegments,
  }
}

function standard(roughness: number, metalness = 0, flatShading = false): PlaceholderMaterialSpec {
  return { kind: 'standard', roughness, metalness, flatShading }
}

/**
 * A shape's parts at a level of detail (placeholderDetailFor; the
 * instanced path always uses detail size 0, the lowest).
 */
export function placeholderParts(shape: PlaceholderShape, detail: PlaceholderDetail): PlaceholderPart[] {
  const sphere: PlaceholderGeometrySpec = { kind: 'sphere', widthSegments: detail.widthSegments, heightSegments: detail.heightSegments }
  switch (shape) {
    case 'planet':
      return [{ geometry: sphere, material: standard(0.85, 0.05) }]
    case 'moon':
      return [{ geometry: sphere, material: standard(0.95) }]
    case 'plain':
      return [{ geometry: sphere, material: { kind: 'basic', wireframe: false, opacity: 1 } }]
    case 'asteroid':
      // A low-poly, flat-shaded icosahedron has an inherently irregular,
      // faceted silhouette — an actual rock shape, not a smooth sphere —
      // for free, with no procedural mesh-deformation cost. Subdivision 0
      // (the default, everyday case) is a deliberate stylistic choice, not
      // just cheapness — it only climbs when zoomed in close enough that
      // "very few polygons" would otherwise be genuinely visible (the
      // real, reported case: 10 Hygiea at true scale, see
      // levelOfDetail.ts).
      return [{ geometry: { kind: 'icosahedron', detail: detail.icosahedronDetail }, material: standard(1, 0, true) }]
    case 'station':
      // A ring/hab-torus is a recognisable "built structure" silhouette —
      // clearly artificial against every natural sphere/rock shape nearby.
      // The tube radius is deliberately purely proportional to the main
      // radius (0.35 of the unit radius, i.e. radius * 0.35 once scaled),
      // with no absolute floor — an absolute floor was the actual bug
      // behind a real, observed one: at true scale (see scale.ts's
      // trueRadius), the ISS's/Hubble's own radius is ~5×10⁻⁸ world
      // units, vanishingly smaller than a fixed 0.02 floor this used to
      // have — so the torus's tube (0.02) ended up enormously larger than
      // its own ring (~5×10⁻⁸), degenerating into a distorted, oversized
      // blob rather than a thin ring, one roughly 4x Earth's own true
      // radius — completely swallowing Earth from any zoom level close
      // enough to also frame the ISS. An absolute floor breaks
      // proportionality for anything genuinely tiny; letting it shrink
      // freely is what a real, honest scale requires.
      return [{ geometry: { kind: 'torus', radialSegments: detail.radialSegments, tubularSegments: detail.tubularSegments }, material: standard(0.4, 0.6) }]
    case 'nav_point':
      // The least substantial marker — a wireframe diamond, since a
      // NavPoint isn't a physical structure at all, just a labelled point.
      // Deliberately NOT detail-scaled: it's a wireframe symbol, not
      // something meant to read as smooth/rounded even up close.
      return [{ geometry: { kind: 'octahedron' }, material: { kind: 'basic', wireframe: true, opacity: 0.9 } }]
    case 'surface_installation':
      // A small flat platform + beacon spike — deliberately NOT a floating
      // torus (that reads as an orbiting station, which this explicitly
      // isn't — see BodyType.surface_installation's own comment) and NOT a
      // sphere (nothing here claims to be a whole celestial body). The
      // shape has no access to the parent's own direction to orient a
      // "planted into the ground" pose exactly (it only ever receives this
      // body's own radius/color/rotation — world placement is the caller's
      // job), so the shape itself carries the "built structure, not a
      // natural or orbiting body" read on its own, via its base+spike
      // silhouette instead of a real surface-normal orientation.
      return [
        { geometry: { kind: 'platform' }, material: standard(0.6, 0.5) },
        { geometry: { kind: 'spike' }, material: standard(0.5, 0.4) },
      ]
  }
}

/** A part's geometry, at unit radius. The surface installation's spike
 *  is translated into place in the geometry itself, so every part of a
 *  shape shares one transform (one instance matrix). */
export function createPlaceholderGeometry(spec: PlaceholderGeometrySpec): THREE.BufferGeometry {
  switch (spec.kind) {
    case 'sphere':
      return new THREE.SphereGeometry(1, spec.widthSegments, spec.heightSegments)
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(1, spec.detail)
    case 'torus':
      return new THREE.TorusGeometry(1, 0.35, spec.radialSegments, spec.tubularSegments)
    case 'octahedron':
      return new THREE.OctahedronGeometry(1, 0)
    case 'platform':
      return new THREE.CylinderGeometry(1, 1.1, 0.3, 8)
    case 'spike':
      return new THREE.ConeGeometry(0.35, 1.2, 8).translate(0, 0.75, 0)
  }
}

/** A part's material in `color` (white on the instanced path, where the
 *  per-instance colour multiplies it). */
export function createPlaceholderMaterial(spec: PlaceholderMaterialSpec, color: THREE.ColorRepresentation = '#ffffff'): THREE.Material {
  if (spec.kind === 'basic') {
    const transparent = spec.opacity < 1
    return new THREE.MeshBasicMaterial({ color, wireframe: spec.wireframe, transparent, opacity: spec.opacity })
  }
  return new THREE.MeshStandardMaterial({ color, roughness: spec.roughness, metalness: spec.metalness, flatShading: spec.flatShading })
}
