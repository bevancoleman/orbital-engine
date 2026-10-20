import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type * as THREE from 'three'
import type { StarLightingStore } from './starLighting'
import { applyBodyLight, createLitAtmosphereMaterial, createLitRingMaterial, createLitSurfaceMaterial } from './starLitMaterials'

/**
 * A mesh drawn with one of the star-lit materials: registers its body
 * with the lighting store for as long as it's mounted (so the store
 * computes that body's light every frame) and refreshes the material's
 * uniforms from it in onBeforeRender — the one moment the mesh's
 * matrixWorld is the one actually being drawn (RenderPass's rebased one).
 */
function StarLitMesh({
  store,
  bodyId,
  material,
  children,
  rotation,
}: {
  store: StarLightingStore
  bodyId: string
  material: THREE.ShaderMaterial
  children: ReactNode
  rotation?: [number, number, number]
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  useEffect(() => {
    store.acquire(bodyId)
    return () => store.release(bodyId)
  }, [store, bodyId])
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.onBeforeRender = (_renderer, _scene, camera) => applyBodyLight(material, store, bodyId, mesh, camera)
    return () => {
      mesh.onBeforeRender = () => {}
    }
  }, [store, bodyId, material])
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh ref={meshRef} material={material} rotation={rotation}>
      {children}
    </mesh>
  )
}

/** A body's sphere, lit from its star — the placeholder colour or a real
 *  surface texture. Unit radius, like every shape (see BodyShapes). */
export function StarLitSphere({
  store,
  bodyId,
  color,
  map = null,
  widthSegments,
  heightSegments,
}: {
  store: StarLightingStore
  bodyId: string
  color: string
  map?: THREE.Texture | null
  widthSegments: number
  heightSegments: number
}) {
  const material = useMemo(() => createLitSurfaceMaterial(color, map), [color, map])
  return (
    <StarLitMesh store={store} bodyId={bodyId} material={material}>
      <sphereGeometry args={[1, widthSegments, heightSegments]} />
    </StarLitMesh>
  )
}

/** AtmosphereRim's star-lit version: the same shell, its glow brighter on
 *  the day side. */
export function StarLitAtmosphere({
  store,
  bodyId,
  color,
  ratio,
  widthSegments,
  heightSegments,
}: {
  store: StarLightingStore
  bodyId: string
  color: string
  ratio: number
  widthSegments: number
  heightSegments: number
}) {
  // Peak day-side opacity a little above the unlit rim's flat 0.12, since
  // the night side now drops towards nothing.
  const material = useMemo(() => createLitAtmosphereMaterial(color, 0.16), [color])
  return (
    <StarLitMesh store={store} bodyId={bodyId} material={material}>
      <sphereGeometry args={[ratio, widthSegments, heightSegments]} />
    </StarLitMesh>
  )
}

/** A ring disc band lit by the star and shadowed by its planet (see
 *  BodyRings' RingDisc for the geometry). */
export function StarLitRingDisc({
  store,
  bodyId,
  color,
  map,
  opacity,
  inner,
  outer,
}: {
  store: StarLightingStore
  bodyId: string
  color: string
  map: THREE.Texture
  opacity: number
  inner: number
  outer: number
}) {
  const material = useMemo(() => createLitRingMaterial(color, map, opacity), [color, map, opacity])
  return (
    <StarLitMesh store={store} bodyId={bodyId} material={material} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[inner, outer, 128, 1]} />
    </StarLitMesh>
  )
}
