import { useMemo } from 'react'
import { PointMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { sampleBeltParticles } from '../belts'
import { ringPlaneQuaternion, ringWorldRadius } from '../rings'
import type { CelestialBody, RingBand } from '../types'
import { glowSprite, ringStreakTexture } from './textures'
import { PointCloud } from './PointCloud'
import { DEFAULT_RING_DISC_OPACITY } from './starLighting'
import { useSceneLighting } from './sceneLighting'
import { StarLitRingDisc } from './StarLitShapes'
const DEFAULT_RING_PARTICLES = 600
/** Particle bands are near-flat: a ring of rocks round a moon is thin, not
 *  a thick belt. */
const RING_PARTICLE_SPREAD_DEG = 1.5

/**
 * A body's own ring system (see CelestialBody.rings), drawn inside the
 * body's scene group — so it moves, fades in and out, and is selected with
 * the body rather than being a separate object at the same spot. Radii
 * scale off the body's rendered radius (see rings.ts's ringWorldRadius),
 * and the whole system is oriented into the body's equatorial plane by its
 * spin pole (see rings.ts's ringPlaneQuaternion — falling back to
 * axialTiltDeg when a body has no pole).
 */
export function BodyRings({ body, radius, color }: { body: CelestialBody; radius: number; color: string }) {
  if (!body.rings?.length) return null
  return (
    <group quaternion={ringPlaneQuaternion(body)}>
      {body.rings.map((band, index) =>
        band.style === 'particles' ? (
          <RingParticles key={index} body={body} band={band} index={index} radius={radius} color={band.color ?? color} />
        ) : (
          <RingDisc key={index} body={body} band={band} index={index} radius={radius} color={band.color ?? color} />
        )
      )}
    </group>
  )
}

/** A smooth, translucent band — dust and ice rings, too fine to show as
 *  particles. Lit like the body, so its day side is brighter; with star
 *  lighting on (see sceneLighting.ts), lit by the star itself and
 *  shadowed by the planet (StarLitRingDisc). */
function RingDisc({ body, band, index, radius, color }: { body: CelestialBody; band: RingBand; index: number; radius: number; color: string }) {
  const inner = ringWorldRadius(band.innerRadiusKm, body, radius)
  const outer = ringWorldRadius(band.outerRadiusKm, body, radius)
  const texture = useMemo(() => ringStreakTexture(`${body.id}:${index}`, inner / outer), [body.id, index, inner, outer])
  const { store } = useSceneLighting()
  const opacity = band.opacity ?? DEFAULT_RING_DISC_OPACITY
  if (store) {
    return <StarLitRingDisc store={store} bodyId={body.id} color={color} map={texture} opacity={opacity} inner={inner} outer={outer} />
  }
  return (
    // RingGeometry lies in the XY plane; turn it flat into XZ, the plane
    // the rest of the scene treats as "the reference plane".
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[inner, outer, 128, 1]} />
      <meshStandardMaterial
        map={texture}
        color={color}
        transparent
        opacity={opacity}
        roughness={1}
        metalness={0}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

/** A ring of individual rocks — scattered points, seeded so the pattern
 *  is the same every load. */
function RingParticles({ body, band, index, radius, color }: { body: CelestialBody; band: RingBand; index: number; radius: number; color: string }) {
  const positions = useMemo(() => {
    const samples = sampleBeltParticles({
      id: `${body.id}:ring:${index}`,
      name: '',
      type: 'belt',
      parentId: body.id,
      innerRadiusKm: band.innerRadiusKm,
      outerRadiusKm: band.outerRadiusKm,
      inclinationSpreadDeg: RING_PARTICLE_SPREAD_DEG,
      particleCount: band.particleCount ?? DEFAULT_RING_PARTICLES,
    })
    const out = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i += 3) {
      const r = ringWorldRadius(samples[i]!, body, radius)
      const theta = samples[i + 1]!
      const phi = samples[i + 2]!
      out[i] = r * Math.cos(theta) * Math.cos(phi)
      out[i + 1] = r * Math.sin(phi)
      out[i + 2] = r * Math.sin(theta) * Math.cos(phi)
    }
    return out
  }, [body, band, index, radius])

  return (
    <PointCloud positions={positions}>
      <PointMaterial map={glowSprite()} color={color} size={3} sizeAttenuation={false} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
    </PointCloud>
  )
}
