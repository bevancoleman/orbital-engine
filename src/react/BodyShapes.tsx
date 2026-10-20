import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import { useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import {
  icosahedronDetailFor,
  sphereDetailFor,
  torusDetailFor,
  type SphereDetail,
} from '../levelOfDetail'
import type { CelestialBody } from '../types'
import { glowSprite } from './textures'
import { hashSeed, TEXTURABLE_BODY_TYPES } from './bodyTypeStyles'
import { createRefCounter } from './resourceCache'
import { useSceneLighting } from './sceneLighting'
import { StarLitAtmosphere, StarLitSphere } from './StarLitShapes'

/**
 * A soft additive rim just outside the surface, sized from the body's real
 * CelestialBody.atmosphereHeightKm rather than one fixed ratio applied to
 * every planet — Venus's real ~250km cloud tops read as visibly thicker
 * than Earth's ~100km "edge of space," and a body with no real substantial
 * atmosphere (Mercury, the dwarf planets, any gas/ice giant — none of
 * which set the field) gets no rim at all instead of an identical glow
 * implying an atmosphere that doesn't exist. Shared between the placeholder
 * sphere and a real-textured one (TexturedSphereBody) so a body doesn't
 * lose its atmosphere just because a real surface photo is available for
 * it.
 *
 * With star lighting on (see sceneLighting.ts) the rim is star-lit too:
 * brighter over the day side, fading past the terminator.
 */
export function AtmosphereRim({ body, color, sphere }: { body: CelestialBody; color: string; sphere: SphereDetail }) {
  const { store } = useSceneLighting()
  if (!body.atmosphereHeightKm) return null
  const ratio = 1 + body.atmosphereHeightKm / body.radiusKm
  if (store) {
    return (
      <StarLitAtmosphere
        store={store}
        bodyId={body.id}
        color={color}
        ratio={ratio}
        widthSegments={sphere.widthSegments}
        heightSegments={sphere.heightSegments}
      />
    )
  }
  return (
    <mesh>
      <sphereGeometry args={[ratio, sphere.widthSegments, sphere.heightSegments]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.12}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.BackSide}
      />
    </mesh>
  )
}

/**
 * The generic, always-available geometry for a body, distinct by type — a
 * sphere reads fine for a real celestial body (star/planet/moon/dwarf
 * planet), but every type here shares the exact same placeholder radius as
 * every other of its kind (a consuming app's own data source may not
 * publish real sizes for every body type), so shape is the only
 * cue that actually distinguishes "a station" from "a jump point" from "a
 * bare nav marker" at a glance, not size. No real texture imagery exists in
 * any current data source for planets/the star either (same
 * placeholder-only situation as radius) — what's rendered here is lit
 * shading (a directional light, added in the Canvas below) and glow, both
 * of which are honest ("this is a lit sphere") rather than a fabricated
 * surface texture standing in for real imagery this pipeline doesn't have.
 * This is what every body renders as by default, and what a specific body
 * with a real `modelUrl` (see BodyShape) falls back to if that model fails
 * to load.
 *
 * Built at UNIT radius — BodyShape applies the body's real rendered radius
 * as a `scale` on the wrapping group. The rendered radius is pixel-floored
 * (see pixelFloor.ts), so it changes on practically every zoom frame; when
 * it was baked into the geometry args instead, every sphere, torus, ring
 * and atmosphere in the scene was thrown away and rebuilt on every one of
 * those frames. Now a geometry is only rebuilt when its LOD segment counts
 * actually change tier.
 */
export function PlaceholderBodyShape({
  body,
  color,
  detailSize,
}: {
  body: CelestialBody
  color: string
  /** How much of the view this body fills right now — see
   *  levelOfDetail.ts's apparentSize. Drives polygon count so a body only
   *  gets expensive detail when actually zoomed in close enough to need
   *  it, not as a fixed per-type constant. */
  detailSize: number
}) {
  const seed = useMemo(() => hashSeed(body.id), [body.id])
  const rotation = useMemo(
    () => [(seed % 620) / 100, ((seed * 7) % 620) / 100, ((seed * 13) % 620) / 100] as [number, number, number],
    [seed]
  )
  const sphere = sphereDetailFor(detailSize)
  const icosahedronSubdivisions = icosahedronDetailFor(detailSize)
  const torus = torusDetailFor(detailSize)
  const { store, tailedCometIds } = useSceneLighting()
  // With star lighting on (see sceneLighting.ts), the natural spheres
  // take the star-lit material: a real terminator, eclipse and ring
  // shadows. Without it, the original fixed-light material, unchanged.
  const litSphere = store ? (
    <StarLitSphere
      store={store}
      bodyId={body.id}
      color={color}
      widthSegments={sphere.widthSegments}
      heightSegments={sphere.heightSegments}
    />
  ) : null

  switch (body.type) {
    case 'star':
      return (
        <>
          <mesh>
            <sphereGeometry args={[1, sphere.widthSegments, sphere.heightSegments]} />
            <meshBasicMaterial color={color} />
          </mesh>
          <sprite scale={[6, 6, 1]}>
            <spriteMaterial
              map={glowSprite()}
              color={color}
              transparent
              opacity={0.55}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </sprite>
        </>
      )

    case 'planet':
    case 'dwarf_planet':
      return (
        <>
          {litSphere ?? (
            <mesh>
              <sphereGeometry args={[1, sphere.widthSegments, sphere.heightSegments]} />
              <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
            </mesh>
          )}
          <AtmosphereRim body={body} color={color} sphere={sphere} />
        </>
      )

    case 'moon':
      return (
        litSphere ?? (
          <mesh>
            <sphereGeometry args={[1, sphere.widthSegments, sphere.heightSegments]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
        )
      )

    case 'asteroid':
      // A low-poly, flat-shaded icosahedron has an inherently irregular,
      // faceted silhouette — an actual rock shape, not a smooth sphere —
      // for free, with no procedural mesh-deformation cost. Subdivision 0
      // (the default, everyday case) is a deliberate stylistic choice, not
      // just cheapness — it only climbs when zoomed in close enough that
      // "very few polygons" would otherwise be genuinely visible (the
      // real, reported case: 10 Hygiea at true scale, see
      // levelOfDetail.ts).
      return (
        <mesh rotation={rotation}>
          <icosahedronGeometry args={[1, icosahedronSubdivisions]} />
          <meshStandardMaterial color={color} roughness={1} flatShading />
        </mesh>
      )

    case 'comet':
      return (
        <>
          <mesh rotation={rotation}>
            <icosahedronGeometry args={[1, Math.max(icosahedronSubdivisions, 1)]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
          {/* A faint trailing streak — comets are the one body type whose
              defining visual feature isn't its own shape at all. Only drawn
              when there's no real tail (CometTails, which needs an orbit
              round the system's star): a fixed, recognisable mark rather
              than omitting the feature entirely. */}
          {!tailedCometIds.has(body.id) && (
            <sprite scale={[9, 2.4, 1]} position={[3.5, 0, 0]}>
              <spriteMaterial
                map={glowSprite()}
                color={color}
                transparent
                opacity={0.25}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </sprite>
          )}
        </>
      )

    case 'station':
      // A ring/hab-torus is a recognisable "built structure" silhouette —
      // clearly artificial against every natural sphere/rock shape nearby.
      // The tube radius is deliberately purely proportional to the main
      // radius (0.35 of the unit radius, i.e. radius * 0.35 once scaled),
      // with no absolute floor — an absolute floor
      // was the actual bug behind a real, observed one: at true scale (see
      // scale.ts's trueRadius), the ISS's/Hubble's own radius is ~5×10⁻⁸
      // world units, vanishingly smaller than a fixed 0.02 floor this used
      // to have — so the torus's tube (0.02) ended up enormously larger
      // than its own ring (~5×10⁻⁸), degenerating into a distorted,
      // oversized blob rather than a thin ring, one roughly 4x Earth's own
      // true radius — completely swallowing Earth from any zoom level
      // close enough to also frame the ISS. An absolute floor breaks
      // proportionality for anything genuinely tiny; letting it shrink
      // freely is what a real, honest scale requires.
      return (
        <mesh rotation={rotation}>
          <torusGeometry args={[1, 0.35, torus.radialSegments, torus.tubularSegments]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
        </mesh>
      )

    case 'jump_point':
      // A hollow, glowing ring — a hole in space, not a structure — visually
      // distinct from a station's solid torus.
      return (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.65, 1.15, torus.tubularSegments]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.85}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <sprite scale={[5, 5, 1]}>
            <spriteMaterial
              map={glowSprite()}
              color={color}
              transparent
              opacity={0.4}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </sprite>
        </>
      )

    case 'nav_point':
      // The least substantial marker — a wireframe diamond, since a
      // NavPoint isn't a physical structure at all, just a labelled point.
      // Deliberately NOT detail-scaled: it's a wireframe symbol, not
      // something meant to read as smooth/rounded even up close.
      return (
        <mesh rotation={rotation}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.9} />
        </mesh>
      )

    case 'surface_installation':
      // A small flat platform + beacon spike — deliberately NOT a floating
      // torus (that reads as an orbiting station, which this explicitly
      // isn't — see BodyType.surface_installation's own comment) and NOT a
      // sphere (nothing here claims to be a whole celestial body). This
      // component has no access to the parent's own direction to orient a
      // "planted into the ground" pose exactly (it only ever receives this
      // body's own radius/color/rotation — world placement is the caller's
      // job), so the shape itself carries the "built structure, not a
      // natural or orbiting body" read on its own, via its base+spike
      // silhouette instead of a real surface-normal orientation.
      return (
        <group rotation={rotation}>
          <mesh>
            <cylinderGeometry args={[1, 1.1, 0.3, 8]} />
            <meshStandardMaterial color={color} roughness={0.6} metalness={0.5} />
          </mesh>
          <mesh position={[0, 0.75, 0]}>
            <coneGeometry args={[0.35, 1.2, 8]} />
            <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
          </mesh>
        </group>
      )

    default:
      return (
        <mesh>
          <sphereGeometry args={[1, sphere.widthSegments, sphere.heightSegments]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )
  }
}

/** Catches a failed/broken model load (a 404, a corrupt file, an
 *  unsupported format) and renders the ordinary placeholder shape instead —
 *  a class component because React error boundaries can't be written as
 *  hooks. Without this, one body with a bad `modelUrl` would take down the
 *  whole scene rather than just falling back for that one body.
 *
 *  Always mounted with `key={url}` (see BodyShape), so pointing a body at a
 *  different asset gets a fresh boundary and a fresh attempt instead of
 *  staying stuck on a previous URL's failure. The failure is reported via
 *  console.warn — falling back is the right behaviour, but doing it
 *  silently made a broken asset URL indistinguishable from a body that
 *  simply had none. */
class ModelErrorBoundary extends Component<{ url: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn(`orbital-engine: failed to load "${this.props.url}" — falling back to the placeholder shape.`, error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Loads a real model (see CelestialBody.modelUrl) and uniformly scales it
 *  so its own bounding sphere is the unit sphere — BodyShape's wrapping
 *  group then scales that to the body's rendered radius, the same as every
 *  placeholder shape. Models come in whatever arbitrary real-world
 *  units/scale their source used, not this engine's compressed world
 *  units, so a fixed scale wouldn't work consistently across different
 *  models. Normalizing here (rather than to the rendered radius directly)
 *  means the deep clone and bounding-box walk happen once per loaded
 *  model, not on every zoom frame the pixel-floored radius changes. */
function LoadedBodyModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const prepared = useMemo(() => {
    const clone = scene.clone(true)
    const box = new THREE.Box3().setFromObject(clone)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const scale = sphere.radius > 1e-6 ? 1 / sphere.radius : 1
    clone.scale.setScalar(scale)
    clone.position.sub(sphere.center.multiplyScalar(scale))
    return clone
  }, [scene])
  return <primitive object={prepared} />
}

// Which texture URLs are currently mounted on a TexturedSphereBody — drei's
// useTexture caches every texture it ever loads for the page's lifetime,
// so switching between systems (or asset modes) kept every previously-seen
// surface texture resident on the GPU. When the last user of a URL
// unmounts, its cache entry is cleared and its GPU copy disposed.
const textureUsers = createRefCounter()

function markAsSrgb(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace
}

/** Loads a real surface texture (see CelestialBody.textureUrl) and wraps it
 *  around a sphere — real imagery standing in for the full 3D model this
 *  body doesn't have, rather than a flat colour. Still gets the same real,
 *  height-based AtmosphereRim as the placeholder sphere (see that
 *  component) — a real photo of Earth or Venus shouldn't lose its
 *  atmosphere just because a texture was available for it. Unit radius,
 *  like every shape here (see PlaceholderBodyShape). */
function TexturedSphereBody({
  body,
  color,
  textureUrl,
  detailSize,
}: {
  body: CelestialBody
  color: string
  textureUrl: string
  detailSize: number
}) {
  // colorSpace is set in useTexture's onLoad (a layout effect that runs
  // before drei uploads the texture), not as a side effect inside useMemo
  // during render.
  const texture = useTexture(textureUrl, markAsSrgb)
  useEffect(() => {
    textureUsers.acquire(textureUrl)
    return () => {
      if (textureUsers.release(textureUrl)) {
        useTexture.clear(textureUrl)
        texture.dispose()
      }
    }
  }, [textureUrl, texture])
  const sphere = sphereDetailFor(detailSize)
  const { store } = useSceneLighting()
  return (
    <>
      {store ? (
        <StarLitSphere
          store={store}
          bodyId={body.id}
          color={color}
          map={texture}
          widthSegments={sphere.widthSegments}
          heightSegments={sphere.heightSegments}
        />
      ) : (
        <mesh>
          <sphereGeometry args={[1, sphere.widthSegments, sphere.heightSegments]} />
          <meshStandardMaterial map={texture} roughness={0.9} metalness={0.05} />
        </mesh>
      )}
      <AtmosphereRim body={body} color={color} sphere={sphere} />
    </>
  )
}

function BodyShapeAtUnitRadius({ body, color, detailSize }: { body: CelestialBody; color: string; detailSize: number }) {
  const placeholder = <PlaceholderBodyShape body={body} color={color} detailSize={detailSize} />

  if (body.modelUrl) {
    return (
      <ModelErrorBoundary key={body.modelUrl} url={body.modelUrl} fallback={placeholder}>
        <Suspense fallback={placeholder}>
          <LoadedBodyModel url={body.modelUrl} />
        </Suspense>
      </ModelErrorBoundary>
    )
  }

  if (body.textureUrl && TEXTURABLE_BODY_TYPES.has(body.type)) {
    return (
      <ModelErrorBoundary key={body.textureUrl} url={body.textureUrl} fallback={placeholder}>
        <Suspense fallback={placeholder}>
          <TexturedSphereBody body={body} color={color} textureUrl={body.textureUrl} detailSize={detailSize} />
        </Suspense>
      </ModelErrorBoundary>
    )
  }

  return placeholder
}

/**
 * The rendered shape for a body, in priority order:
 * 1. A real 3D model (CelestialBody.modelUrl — e.g. a real ISS model
 *    instead of the generic station torus), if set and it loads.
 * 2. A real surface texture wrapped around a sphere (CelestialBody.
 *    textureUrl), if set, it loads, and the body's type is one
 *    PlaceholderBodyShape would otherwise render as a plain sphere.
 * 3. The generic per-type placeholder (PlaceholderBodyShape) — the
 *    default for every body, and the fallback if 1 or 2 were set but
 *    failed to load.
 *
 * Every one of those is built at unit radius; `radius` is applied here as
 * a scale (see PlaceholderBodyShape for why).
 */
export function BodyShape({
  body,
  radius,
  color,
  detailSize,
}: {
  body: CelestialBody
  radius: number
  color: string
  detailSize: number
}) {
  return (
    <group scale={radius}>
      <BodyShapeAtUnitRadius body={body} color={color} detailSize={detailSize} />
    </group>
  )
}
