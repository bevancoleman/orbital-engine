import { useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'

/**
 * A plain THREE.Points over a fixed vertex buffer — the replacement for
 * drei's <Points> in this engine's belts and particle rings. drei's
 * version is built for buffers that change every frame: it flags the
 * position attribute for re-upload on every frame whether or not anything
 * changed, so every belt's whole buffer (thousands of points for a real
 * asteroid field) was being re-sent to the GPU at 60 fps. Here the
 * geometry is built once per `positions` array and only ever re-uploaded
 * by handing in a new array, which callers only do when the points have
 * genuinely moved (a co-orbital belt following its reference body).
 *
 * The previous geometry is disposed when replaced or unmounted, and the
 * bounding sphere is computed up front so frustum culling stays correct
 * after a swap.
 */
export function PointCloud({ positions, children }: { positions: Float32Array; children: ReactNode }) {
  const geometry = useMemo(() => {
    const built = new THREE.BufferGeometry()
    built.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    built.computeBoundingSphere()
    return built
  }, [positions])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <points geometry={geometry}>{children}</points>
}
