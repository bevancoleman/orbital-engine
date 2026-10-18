import { useMemo } from 'react'
import { PointMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { beltGlowInnerRatio, sampleBeltParticles } from '../belts'
import { coOrbitalReferenceAngle } from '../resolve'
import type { WorldVec } from '../render'
import { compressDistance } from '../scale'
import type { BeltRegion, BeltSite, StarSystemData } from '../types'
import { compressedOffsets, syntheticBeltOffsets } from './beltGeometry'
import { PointCloud } from './PointCloud'
import { glowSprite, ringGlowTexture } from './textures'

// Every component here takes its belt's parent world position from
// SceneContent (which already resolved every body's position once for
// this frame) rather than re-resolving the parent itself, and applies it
// as a group position over PARENT-RELATIVE vertices — see beltGeometry.ts.

/**
 * A flat, soft-edged glow disc spanning a belt's full inner-to-outer
 * radius — only makes sense for a belt spread around the whole circle
 * (the main asteroid belt, the Kuiper belt), not a co-orbital
 * cluster like the Trojans, which only occupies a narrow arc.
 */
export function BeltGlowRing({ belt, parentWorldPos }: { belt: BeltRegion; parentWorldPos: WorldVec }) {
  const outerWorldRadius = compressDistance(belt.outerRadiusKm)
  const innerRatio = beltGlowInnerRatio(belt)
  // Shared and cached by ratio (see ringGlowTexture) — not created per
  // mount, so nothing here to dispose.
  const texture = ringGlowTexture(innerRatio)

  return (
    <mesh position={parentWorldPos} rotation={[-Math.PI / 2, 0, 0]}>
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

export function BeltPoints({
  belt,
  system,
  simDate,
  parentWorldPos,
}: {
  belt: BeltRegion
  system: StarSystemData
  simDate: Date
  parentWorldPos: WorldVec
}) {
  // Per-particle (radius, angle offset, elevation), generated once per belt
  // and reused every frame, so a co-orbital population's particles keep
  // their own fixed slot in the cluster and just carry it round as the
  // reference angle moves. Seeded from the belt's id (see belts.ts), so the
  // pattern is also the same on every load.
  const syntheticShape = useMemo(() => sampleBeltParticles(belt), [belt])

  // A co-orbital population (e.g. Jupiter's Trojans) clusters around an
  // angle measured from its reference body's CURRENT position, not a
  // fixed spot — this is what makes it visibly travel with Jupiter as time
  // advances rather than sitting static in space. 0 for every other belt,
  // so for those the buffer below is built once and never again.
  const referenceAngle = belt.realPositions ? 0 : coOrbitalReferenceAngle(belt, system, simDate)

  const positions = useMemo(
    () =>
      // Real individual positions (see BeltRegion.realPositions) — e.g.
      // Star Citizen's asteroid fields, where every rock's exact position
      // is known from the game's own data. Used directly, not as a radius
      // range to scatter synthetic points across.
      belt.realPositions ? compressedOffsets(belt.realPositions) : syntheticBeltOffsets(belt, syntheticShape, referenceAngle),
    [belt, syntheticShape, referenceAngle]
  )

  return (
    <group position={parentWorldPos}>
      <PointCloud positions={positions}>
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
      </PointCloud>
    </group>
  )
}

/**
 * Named sites inside a belt (see BeltRegion.sites) — drawn as larger,
 * brighter markers among the belt's own population, so they read as
 * "these particular places, in this belt" rather than as another belt.
 */
export function BeltSites({ belt, parentWorldPos }: { belt: BeltRegion; parentWorldPos: WorldVec }) {
  if (!belt.sites?.length) return null
  return (
    <group position={parentWorldPos}>
      {belt.sites.map((site) => (
        <SiteMarkers key={site.name} site={site} fallbackColor={belt.color} />
      ))}
    </group>
  )
}

function SiteMarkers({ site, fallbackColor }: { site: BeltSite; fallbackColor?: string }) {
  const positions = useMemo(() => compressedOffsets(site.positions), [site])
  return (
    <PointCloud positions={positions}>
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
    </PointCloud>
  )
}
