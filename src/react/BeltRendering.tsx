import { useMemo } from 'react'
import { Points, PointMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { beltGlowInnerRatio, sampleBeltParticles } from '../belts'
import { coOrbitalReferenceAngle } from '../resolve'
import { compressVec, resolveWorldPosition, type WorldVec } from '../render'
import { compressDistance } from '../scale'
import type { BeltRegion, BeltSite, StarSystemData } from '../types'
import { glowSprite, ringGlowTexture } from './textures'

/**
 * A flat, soft-edged glow disc spanning a belt's full inner-to-outer
 * radius — only makes sense for a belt spread around the whole circle
 * (the main asteroid belt, the Kuiper belt), not a co-orbital
 * cluster like the Trojans, which only occupies a narrow arc.
 */
export function BeltGlowRing({ belt, system, simDate }: { belt: BeltRegion; system: StarSystemData; simDate: Date }) {
  const parent = system.bodies.find((b) => b.id === belt.parentId)
  const [x, y, z] = parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)
  const outerWorldRadius = compressDistance(belt.outerRadiusKm)
  const innerRatio = beltGlowInnerRatio(belt)
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

export function BeltPoints({ belt, system, simDate }: { belt: BeltRegion; system: StarSystemData; simDate: Date }) {
  // Per-particle (radius, angle offset, elevation), generated once per belt
  // and reused every frame, so a co-orbital population's particles keep
  // their own fixed slot in the cluster and just carry it round as the
  // reference angle moves. Seeded from the belt's id (see belts.ts), so the
  // pattern is also the same on every load. Built unconditionally — before
  // the realPositions branch below — to keep hook order stable.
  const syntheticShape = useMemo(() => sampleBeltParticles(belt), [belt])

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
      // for any parent far from the star.
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

/**
 * Named sites inside a belt (see BeltRegion.sites) — drawn as larger,
 * brighter markers among the belt's own population, so they read as
 * "these particular places, in this belt" rather than as another belt.
 */
export function BeltSites({ belt, system, simDate }: { belt: BeltRegion; system: StarSystemData; simDate: Date }) {
  const parent = system.bodies.find((b) => b.id === belt.parentId)
  const parentWorld = useMemo(
    () => (parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)),
    [parent, system, simDate]
  )
  if (!belt.sites?.length) return null
  return (
    <>
      {belt.sites.map((site) => (
        <SiteMarkers key={site.name} site={site} parentWorld={parentWorld} fallbackColor={belt.color} />
      ))}
    </>
  )
}

function SiteMarkers({ site, parentWorld, fallbackColor }: { site: BeltSite; parentWorld: WorldVec; fallbackColor?: string }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(site.positions.length * 3)
    site.positions.forEach((p, i) => {
      const [rx, ry, rz] = compressVec({ x: p.xKm, y: p.yKm, z: p.zKm })
      arr[i * 3] = parentWorld[0] + rx
      arr[i * 3 + 1] = parentWorld[1] + ry
      arr[i * 3 + 2] = parentWorld[2] + rz
    })
    return arr
  }, [site, parentWorld])
  return (
    <Points positions={positions}>
      <PointMaterial
        map={glowSprite()}
        color={site.color ?? fallbackColor ?? '#fbbf24'}
        size={7}
        sizeAttenuation={false}
        transparent
        opacity={0.85}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </Points>
  )
}

