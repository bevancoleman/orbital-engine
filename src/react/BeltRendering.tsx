import { useMemo } from 'react'
import { Points, PointMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { coOrbitalReferenceAngle } from '../resolve'
import { compressVec, resolveWorldPosition, type WorldVec } from '../render'
import { compressDistance } from '../scale'
import type { BeltRegion, StarSystemData } from '../types'
import { glowSprite, ringGlowTexture } from './textures'

/**
 * A flat, soft-edged glow disc spanning a belt's full inner-to-outer
 * radius — only makes sense for a belt spread around the whole circle
 * (the main asteroid belt, Kuiper belt, Saturn's rings), not a co-orbital
 * cluster like the Trojans, which only occupies a narrow arc.
 */
export function BeltGlowRing({ belt, system, simDate }: { belt: BeltRegion; system: StarSystemData; simDate: Date }) {
  const parent = system.bodies.find((b) => b.id === belt.parentId)
  const [x, y, z] = parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)
  const outerWorldRadius = compressDistance(belt.outerRadiusKm)
  const innerRatio = belt.innerRadiusKm / belt.outerRadiusKm
  const texture = useMemo(() => ringGlowTexture(innerRatio), [innerRatio])

  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[outerWorldRadius, 64]} />
      <meshBasicMaterial
        map={texture}
        color={belt.color ?? '#a8a29e'}
        transparent
        opacity={0.28}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/** Per-particle (radiusKm, angleOffsetRad, phiRad) — generated once and
 *  reused every frame, so a co-orbital population's particles keep their
 *  own fixed slot in the cluster and just carry it around as the reference
 *  angle moves, rather than re-randomising (visibly "sparkling") every tick. */
function useBeltShape(belt: BeltRegion): Float32Array {
  return useMemo(() => {
    const spreadRad = (belt.inclinationSpreadDeg * Math.PI) / 180
    const angularSpreadRad = belt.coOrbital ? (belt.coOrbital.angularSpreadDeg * Math.PI) / 180 : Math.PI * 2
    const arr = new Float32Array(belt.particleCount * 3)
    for (let i = 0; i < belt.particleCount; i++) {
      arr[i * 3] = belt.innerRadiusKm + Math.random() * (belt.outerRadiusKm - belt.innerRadiusKm)
      arr[i * 3 + 1] = belt.coOrbital ? (Math.random() - 0.5) * angularSpreadRad : Math.random() * Math.PI * 2
      arr[i * 3 + 2] = (Math.random() - 0.5) * spreadRad
    }
    return arr
    // Deliberately NOT depending on belt.innerRadiusKm/outerRadiusKm/
    // inclinationSpreadDeg/coOrbital/particleCount — this scatter is meant
    // to stay fixed per belt (see this function's own comment on avoiding
    // "sparkling" from re-randomizing every tick), keyed only on belt.id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [belt.id])
}

export function BeltPoints({ belt, system, simDate }: { belt: BeltRegion; system: StarSystemData; simDate: Date }) {
  // Only build the synthetic scatter shape when there's no real data to use
  // instead — calling the hook unconditionally (not inside the branch
  // below) keeps hook order stable across renders either way.
  const syntheticShape = useBeltShape(belt)

  const positions = useMemo(() => {
    const parent = system.bodies.find((b) => b.id === belt.parentId)
    const parentWorld = parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)

    // Real individual positions (see BeltRegion.realPositions) — e.g. Star
    // Citizen's asteroid fields, where every rock's exact position is known
    // from the game's own data. Used directly, not as a radius range to
    // scatter synthetic points across.
    if (belt.realPositions) {
      const arr = new Float32Array(belt.realPositions.length * 3)
      for (let i = 0; i < belt.realPositions.length; i++) {
        const p = belt.realPositions[i]!
        const [rx, ry, rz] = compressVec({ x: p.xKm, y: p.yKm, z: p.zKm })
        arr[i * 3] = parentWorld[0] + rx
        arr[i * 3 + 1] = parentWorld[1] + ry
        arr[i * 3 + 2] = parentWorld[2] + rz
      }
      return arr
    }

    // A co-orbital population (e.g. Jupiter's Trojans) clusters around an
    // angle measured from its reference body's CURRENT position, not a
    // fixed spot — this is what makes it visibly travel with Jupiter as
    // time advances rather than sitting static in space.
    const refAngle = coOrbitalReferenceAngle(belt, system, simDate)

    const arr = new Float32Array(belt.particleCount * 3)
    for (let i = 0; i < belt.particleCount; i++) {
      const radiusKm = syntheticShape[i * 3]!
      const theta = refAngle + syntheticShape[i * 3 + 1]!
      const phi = syntheticShape[i * 3 + 2]!
      // Compress the OFFSET from the parent independently, then add to the
      // parent's own (already hierarchically-compressed) world position —
      // same reasoning as render.ts's resolveWorldPosition: compressing a
      // combined absolute-style vector would flatten a ring's real spread
      // for any parent far from the star (e.g. Saturn's rings).
      const [rx, ry, rz] = compressVec({
        x: radiusKm * Math.cos(theta) * Math.cos(phi),
        y: radiusKm * Math.sin(theta) * Math.cos(phi),
        z: radiusKm * Math.sin(phi),
      })
      arr[i * 3] = parentWorld[0] + rx
      arr[i * 3 + 1] = parentWorld[1] + ry
      arr[i * 3 + 2] = parentWorld[2] + rz
    }
    return arr
  }, [belt, system, syntheticShape, simDate])

  return (
    <Points positions={positions}>
      <PointMaterial
        map={glowSprite()}
        color={belt.color ?? '#a8a29e'}
        size={4}
        // Fixed screen size rather than shrinking with camera distance —
        // sizeAttenuation is exactly why a belt used to vanish once zoomed
        // out far enough that each particle's true projected size dropped
        // under a pixel. A belt's whole point is to be visible as a hazy
        // band from any distance, not to shrink like an ordinary 3D object.
        sizeAttenuation={false}
        transparent
        opacity={0.3}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </Points>
  )
}
