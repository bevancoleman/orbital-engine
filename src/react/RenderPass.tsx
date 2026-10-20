import { useMemo, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { CameraPose } from '../camera'
import { RENDER_FRAME_PRIORITY, updateRenderFrame, type RenderFrame } from './floatingOrigin'

/**
 * Takes over drawing the frame (a positive useFrame priority does that in
 * R3F, after every other per-frame callback) to render camera-relative and
 * distance-normalized — see floatingOrigin.ts for why. For the draw call
 * only: `root` (everything rendered that moves with the world) is scaled
 * and offset, the camera moved to the origin with its clip planes scaled
 * to match, and both are put back afterwards, so every other per-frame
 * callback (camera-controls, CameraRig, labels, the proximity pass) only
 * ever sees world coordinates.
 *
 * `cameraPose` (CameraRig's live camera position and target) gives the
 * viewing distance the scene is normalized by. The transform is computed
 * once, into `renderFrame`, a step before the draw
 * (RENDER_FRAME_PRIORITY) — the batched small bodies and orbit lines,
 * which sit outside `root` and write their own camera-relative buffers,
 * read it in between (CAMERA_RELATIVE_PRIORITY), so they're drawn with
 * exactly the transform everything else is.
 */
export function RenderPass({
  root,
  cameraPose,
  renderFrame,
}: {
  root: RefObject<THREE.Group | null>
  cameraPose: RefObject<CameraPose | null>
  renderFrame: RenderFrame
}) {
  const saved = useMemo(() => ({ position: new THREE.Vector3(), near: 0, far: 0 }), [])
  useFrame(({ camera }) => {
    updateRenderFrame(renderFrame, camera.position, cameraPose.current)
  }, RENDER_FRAME_PRIORITY)
  useFrame(({ gl, scene, camera }) => {
    const group = root.current
    if (!group) {
      gl.render(scene, camera)
      return
    }
    const { origin, scale } = renderFrame
    const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null

    saved.position.copy(camera.position)
    group.scale.setScalar(scale)
    group.position.set(-origin[0] * scale, -origin[1] * scale, -origin[2] * scale)
    camera.position.set(0, 0, 0)
    if (perspective) {
      saved.near = perspective.near
      saved.far = perspective.far
      perspective.near *= scale
      perspective.far *= scale
      perspective.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()

    gl.render(scene, camera)

    group.scale.setScalar(1)
    group.position.set(0, 0, 0)
    camera.position.copy(saved.position)
    if (perspective) {
      perspective.near = saved.near
      perspective.far = saved.far
      perspective.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
    // Objects under `root` keep render-space matrixWorlds until the next
    // updateWorldMatrix/updateMatrixWorld — every world-space reader in
    // the scene (BodyLabel's getWorldPosition) updates its parents first.
  }, 1)
  return null
}
