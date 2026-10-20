import * as THREE from 'three'
import { icosahedronDetailFor, sphereDetailFor, torusDetailFor } from '../../levelOfDetail'
import type { BodyType } from '../../types'
import { hashSeed } from '../bodyTypeStyles'
import {
  PLACEHOLDER_SHAPES,
  ROTATED_PLACEHOLDER_SHAPES,
  STAR_LIT_PLACEHOLDER_SHAPES,
  createPlaceholderGeometry,
  createPlaceholderMaterial,
  placeholderDetailFor,
  placeholderParts,
  placeholderRotation,
  placeholderShapeFor,
} from '../placeholderShapes'

describe('placeholderShapeFor', () => {
  it.each([
    ['planet', 'planet'],
    ['dwarf_planet', 'planet'],
    ['moon', 'moon'],
    ['asteroid', 'asteroid'],
    ['station', 'station'],
    ['nav_point', 'nav_point'],
    ['surface_installation', 'surface_installation'],
    ['mystery', 'plain'],
  ] as const)('draws a %s as %s', (type, shape) => {
    expect(placeholderShapeFor(type as BodyType)).toBe(shape)
    expect(PLACEHOLDER_SHAPES).toContain(shape)
  })

  it.each(['star', 'comet', 'jump_point'] as const)('leaves a %s, with its glow or tail sprite, to BodyShapes', (type) => {
    expect(placeholderShapeFor(type)).toBeNull()
  })

  it('star-lights the natural bodies and orients the irregular and built ones', () => {
    expect([...STAR_LIT_PLACEHOLDER_SHAPES].sort()).toEqual(['asteroid', 'moon', 'planet'])
    expect([...ROTATED_PLACEHOLDER_SHAPES].sort()).toEqual(['asteroid', 'nav_point', 'station', 'surface_installation'])
  })
})

describe('placeholderRotation', () => {
  it('is a fixed per-body orientation seeded from the id', () => {
    const seed = hashSeed('asteroid-7')
    expect(placeholderRotation('asteroid-7')).toEqual([(seed % 620) / 100, ((seed * 7) % 620) / 100, ((seed * 13) % 620) / 100])
    expect(placeholderRotation('asteroid-7')).toEqual(placeholderRotation('asteroid-7'))
    expect(placeholderRotation('asteroid-8')).not.toEqual(placeholderRotation('asteroid-7'))
  })
})

describe('placeholderParts / createPlaceholderGeometry / createPlaceholderMaterial', () => {
  function vertexCount(geometry: THREE.BufferGeometry): number {
    return geometry.getAttribute('position').count
  }

  it('builds each shape at the level of detail levelOfDetail.ts picks', () => {
    for (const size of [0, 0.01, 0.4]) {
      const detail = placeholderDetailFor(size)
      const sphere = sphereDetailFor(size)
      const torus = torusDetailFor(size)
      const [planet] = placeholderParts('planet', detail)
      expect(planet!.geometry).toEqual({ kind: 'sphere', widthSegments: sphere.widthSegments, heightSegments: sphere.heightSegments })
      expect(vertexCount(createPlaceholderGeometry(planet!.geometry))).toBe(vertexCount(new THREE.SphereGeometry(1, sphere.widthSegments, sphere.heightSegments)))
      expect(placeholderParts('asteroid', detail)[0]!.geometry).toEqual({ kind: 'icosahedron', detail: icosahedronDetailFor(size) })
      expect(placeholderParts('station', detail)[0]!.geometry).toEqual({ kind: 'torus', radialSegments: torus.radialSegments, tubularSegments: torus.tubularSegments })
    }
  })

  it('keeps the station\'s tube proportional to its ring, with no absolute floor', () => {
    const torus = createPlaceholderGeometry({ kind: 'torus', radialSegments: 8, tubularSegments: 16 }) as THREE.TorusGeometry
    expect(torus.parameters.radius).toBe(1)
    expect(torus.parameters.tube).toBe(0.35)
  })

  it('puts the surface installation\'s spike on its platform, in the geometry, so both parts share a transform', () => {
    const [platform, spike] = placeholderParts('surface_installation', placeholderDetailFor(0)).map((part) => createPlaceholderGeometry(part.geometry))
    platform!.computeBoundingBox()
    spike!.computeBoundingBox()
    expect(platform!.boundingBox!.max.y).toBeCloseTo(0.15, 6)
    expect(spike!.boundingBox!.min.y).toBeCloseTo(0.15, 6)
    expect(spike!.boundingBox!.max.y).toBeCloseTo(1.35, 6)
  })

  it('gives each shape its material: matte natural bodies, a faceted rock, a metallic station, a wireframe nav point', () => {
    const material = (shape: (typeof PLACEHOLDER_SHAPES)[number]) => placeholderParts(shape, placeholderDetailFor(0))[0]!.material
    expect(material('planet')).toEqual({ kind: 'standard', roughness: 0.85, metalness: 0.05, flatShading: false })
    expect(material('moon')).toEqual({ kind: 'standard', roughness: 0.95, metalness: 0, flatShading: false })
    expect(material('asteroid')).toEqual({ kind: 'standard', roughness: 1, metalness: 0, flatShading: true })
    expect(material('station')).toEqual({ kind: 'standard', roughness: 0.4, metalness: 0.6, flatShading: false })
    const nav = createPlaceholderMaterial(material('nav_point'), '#ff0000') as THREE.MeshBasicMaterial
    expect(nav).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(nav.wireframe).toBe(true)
    expect(nav.transparent).toBe(true)
    expect(nav.opacity).toBe(0.9)
    expect(nav.color.getHexString()).toBe('ff0000')
    const plain = createPlaceholderMaterial(material('plain')) as THREE.MeshBasicMaterial
    expect(plain.transparent).toBe(false)
    expect(plain.color.getHexString()).toBe('ffffff')
    const rock = createPlaceholderMaterial(material('asteroid')) as THREE.MeshStandardMaterial
    expect(rock).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(rock.flatShading).toBe(true)
  })
})
