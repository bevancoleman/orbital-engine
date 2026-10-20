import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cometTailGeometry, type CometTailGeometry } from '../comets'
import { trueRadius } from '../scale'
import type { WorldVec } from '../render'
import type { CelestialBody, StarSystemData } from '../types'
import type { FramePositions } from './framePositions'
import { useSceneLighting } from './sceneLighting'
import { createRibbonBuffers, fillRibbon, type RibbonBuffers } from './tailRibbon'
import { glowSprite } from './textures'
import { useFollowPosition } from './useFollowPosition'

/** Comets that get a real tail: a `comet` with an orbit round the
 *  system's star — the tail physics (comets.ts) needs the star's
 *  direction and the comet's heliocentric orbit. Any other comet keeps
 *  its placeholder's fixed streak (see BodyShapes). */
export function tailedComets(system: StarSystemData): CelestialBody[] {
  const star = system.bodies.find((b) => b.type === 'star')
  if (!star) return []
  return system.bodies.filter((b) => b.type === 'comet' && b.orbit && b.parentId === star.id)
}

/** Ion tails glow blue (CO⁺ fluorescence); dust shines by reflected,
 *  slightly reddened sunlight. */
const ION_COLOR = '#8fb8ff'
const DUST_COLOR = '#fff0d2'
const COMA_COLOR = '#e8f4ff'
const ION_SAMPLES = 24
/** Peak alphas: additive, so overlapping dust curves add up into a fan —
 *  kept low so the overlap doesn't saturate to a white slab. */
const ION_ALPHA = 0.3
const DUST_ALPHA = 0.18
const COMA_ALPHA = 0.35
/** The ion tail's half-width at its far end, as a fraction of its length
 *  — real plasma tails are ~10⁵–10⁶ km wide over ~10⁷ km. */
const ION_FLARE = 0.02

/** World units per km — tails are local extents drawn at true scale,
 *  like rings (see comets.ts). */
const WORLD_PER_KM = trueRadius(1)

/**
 * Every tailed comet's ion and dust tails, in world space. Mounted once in
 * SceneContent (under RenderPass's rebased root). Draws nothing when
 * comet tails are off (OrbitalSystemScene's `cometTails`), so the set in
 * the lighting context is the one switch.
 */
export function CometTails({ system, frame }: { system: StarSystemData; frame: FramePositions }) {
  const { tailedCometIds } = useSceneLighting()
  const comets = useMemo(() => tailedComets(system).filter((c) => tailedCometIds.has(c.id)), [system, tailedCometIds])
  return (
    <>
      {comets.map((comet) => {
        const position = frame.positions.get(comet.id)
        return position ? <CometTail key={comet.id} comet={comet} position={position} frame={frame} /> : null
      })}
    </>
  )
}

function CometTail({ comet, position, frame }: { comet: CelestialBody; position: WorldVec; frame: FramePositions }) {
  const groupRef = useRef<THREE.Group>(null)
  useFollowPosition(groupRef, position)
  const parts = useMemo(() => createTailParts(), [])
  useEffect(() => () => disposeTailParts(parts), [parts])
  const resolved = useRef<{ timeMs: number; tail: CometTailGeometry | null }>({ timeMs: Number.NaN, tail: null })

  useFrame(({ camera }) => {
    if (!comet.orbit || !groupRef.current) return
    // Rebuilt only when the simulated time moves — the tail's shape
    // depends on nothing else.
    if (frame.timeMs !== resolved.current.timeMs) {
      const tail = cometTailGeometry(comet.orbit, frame.date)
      resolved.current = { timeMs: frame.timeMs, tail }
      groupRef.current.visible = tail.activity > 0
      if (tail.activity > 0) updateTailParts(parts, tail)
    }
    const tail = resolved.current.tail
    if (tail && tail.activity > 0) {
      // World coordinates here: RenderPass only rebases inside gl.render.
      const distance = Math.hypot(camera.position.x - position[0], camera.position.y - position[1], camera.position.z - position[2])
      ;(parts.coma.material as THREE.SpriteMaterial).opacity = COMA_ALPHA * tail.activity * insideFade(distance, tail.comaRadiusKm * WORLD_PER_KM)
    }
  })

  return (
    <group ref={groupRef} position={position} visible={false}>
      <primitive object={parts.ion.mesh} />
      {parts.dust.map((ribbon, i) => (
        <primitive key={i} object={ribbon.mesh} />
      ))}
      <primitive object={parts.coma} />
    </group>
  )
}

interface Ribbon {
  buffers: RibbonBuffers
  geometry: THREE.BufferGeometry
  mesh: THREE.Mesh
}

interface TailParts {
  ion: Ribbon
  dust: Ribbon[]
  coma: THREE.Sprite
  materials: THREE.Material[]
}

function createTailParts(): TailParts {
  const ionMaterial = createRibbonMaterial(ION_COLOR)
  const dustMaterial = createRibbonMaterial(DUST_COLOR)
  const comaMaterial = new THREE.SpriteMaterial({
    map: glowSprite(),
    color: COMA_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  return {
    ion: createRibbon(ION_SAMPLES, ionMaterial),
    // One ribbon per β curve (comets.ts's DUST_BETAS), 20 points each.
    dust: [0, 1, 2].map(() => createRibbon(20, dustMaterial)),
    coma: new THREE.Sprite(comaMaterial),
    materials: [ionMaterial, dustMaterial, comaMaterial],
  }
}

function disposeTailParts(parts: TailParts): void {
  for (const ribbon of [parts.ion, ...parts.dust]) ribbon.geometry.dispose()
  for (const material of parts.materials) material.dispose()
}

function createRibbon(points: number, material: THREE.Material): Ribbon {
  const buffers = createRibbonBuffers(points)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3))
  geometry.setAttribute('aTangent', new THREE.BufferAttribute(buffers.tangent, 3))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(buffers.side, 1))
  geometry.setAttribute('aWidth', new THREE.BufferAttribute(buffers.width, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(buffers.alpha, 1))
  geometry.setAttribute('aAlong', new THREE.BufferAttribute(buffers.along, 1))
  geometry.setIndex(new THREE.BufferAttribute(buffers.index, 1))
  const mesh = new THREE.Mesh(geometry, material)
  // The vertex shader moves every vertex sideways, and the tail reshapes
  // as time passes: a stale bounding sphere would cull it wrongly.
  mesh.frustumCulled = false
  return { buffers, geometry, mesh }
}

function markUpdated(ribbon: Ribbon): void {
  for (const name of ['position', 'aTangent', 'aWidth', 'aAlpha', 'aAlong']) ribbon.geometry.getAttribute(name).needsUpdate = true
}

function updateTailParts(parts: TailParts, tail: CometTailGeometry): void {
  const ionPoints: WorldVec[] = []
  const ionWidths: number[] = []
  const ionAlphas: number[] = []
  for (let i = 0; i < ION_SAMPLES; i++) {
    const s = i / (ION_SAMPLES - 1)
    const along = tail.ionLengthKm * s
    ionPoints.push([tail.ionDirection[0] * along, tail.ionDirection[1] * along, tail.ionDirection[2] * along])
    ionWidths.push(tail.comaRadiusKm + ION_FLARE * tail.ionLengthKm * s)
    ionAlphas.push(ION_ALPHA * tail.activity * (1 - s) ** 1.5)
  }
  fillRibbon(parts.ion.buffers, ionPoints, ionWidths, ionAlphas, WORLD_PER_KM)
  markUpdated(parts.ion)
  parts.dust.forEach((ribbon, i) => {
    const track = tail.dust[i]
    if (!track) return
    fillRibbon(ribbon.buffers, track.points, track.widthsKm, track.weights.map((w) => DUST_ALPHA * w), WORLD_PER_KM)
    markUpdated(ribbon)
  })
  // The glow sprite's visible core is about half its square: ×4 the radius.
  parts.coma.scale.setScalar(4 * tail.comaRadiusKm * WORLD_PER_KM)
}

/**
 * Fades a glow out as the camera gets inside it — from fully visible at
 * 4× its radius to nothing at 1×. Flat glows (a sprite, a ribbon) have a
 * constant brightness however close you are, so framing the nucleus a
 * few km away put the camera inside a coma 10⁵ km across and whited out
 * the view; inside a real coma its light is spread over the whole sky.
 * The ribbon shader applies the same rule per vertex.
 */
function insideFade(distance: number, radius: number): number {
  if (!(radius > 0)) return 0
  const t = Math.min(Math.max((distance / radius - 1) / 3, 0), 1)
  return t * t * (3 - 2 * t)
}

const RIBBON_VERTEX_GLSL = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aTangent;
attribute float aSide;
attribute float aWidth;
attribute float aAlpha;
attribute float aAlong;
varying float vSide;
varying float vAlpha;
varying float vAlong;
varying float vHalfWidth;
void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  // Sideways = across the tail AND across the line of sight, so the
  // ribbon faces the camera. Worked out in view space, where the camera
  // is at the origin (rebased or not — see RenderPass).
  vec3 tangent = (modelViewMatrix * vec4(aTangent, 0.0)).xyz;
  vec3 across = cross(tangent, viewPosition.xyz);
  float acrossLength = length(across);
  across = acrossLength > 0.0 ? across / acrossLength : vec3(1.0, 0.0, 0.0);
  // The model-view's uniform scale (RenderPass normalizes by the viewing
  // distance) applied to the width too.
  float scale = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  float halfWidth = aWidth * scale;
  // Fade out where the camera is inside the tail (see insideFade in
  // CometTails.tsx): both lengths are in the same, rebased units.
  float inside = smoothstep(1.0, 4.0, length(viewPosition.xyz) / max(halfWidth, 1e-30));
  viewPosition.xyz += across * aSide * halfWidth;
  gl_Position = projectionMatrix * viewPosition;
  vSide = aSide;
  vAlpha = aAlpha * inside;
  vAlong = aAlong;
  vHalfWidth = aWidth;
  #include <logdepthbuf_vertex>
}
`

const RIBBON_FRAGMENT_GLSL = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying float vSide;
varying float vAlpha;
varying float vAlong;
varying float vHalfWidth;
void main() {
  #include <logdepthbuf_fragment>
  // Brightest along the axis, fading to nothing at the edges, and rounded
  // off over the first couple of widths from the nucleus instead of
  // starting at a blunt edge (the coma glow covers the head).
  float profile = exp(-3.0 * vSide * vSide) - exp(-3.0);
  float head = smoothstep(0.0, 2.0 * vHalfWidth, vAlong);
  gl_FragColor = vec4(uColor, vAlpha * max(profile, 0.0) * head);
  #include <tonemapping_fragment>
  #include <${'colorspace_fragment' in THREE.ShaderChunk ? 'colorspace_fragment' : 'encodings_fragment'}>
}
`

function createRibbonMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: RIBBON_VERTEX_GLSL,
    fragmentShader: RIBBON_FRAGMENT_GLSL,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}
