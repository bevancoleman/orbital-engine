import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import type { WorldVec } from '../render'

/**
 * Per-frame callbacks that move scene objects to this frame's positions
 * run here: after drei's CameraControls (-1) has placed the camera, and
 * BEFORE the default-priority (0) readers that project objects' world
 * positions — BodyLabel above all. At the same priority, R3F runs
 * callbacks in subscription order, which puts a child's (the label's)
 * before its parent's (the body group's): the label would have been
 * placed from last frame's body position.
 */
export const FOLLOW_PRIORITY = -0.5

/**
 * Keeps `ref`'s object at `position` — a live array (see
 * framePositions.ts) that's updated in place every frame — by copying it
 * across every frame, instead of through a React prop (which only changes
 * when React re-renders; see framePositions.ts for why that isn't every
 * frame).
 */
export function useFollowPosition(ref: { readonly current: THREE.Object3D | null }, position: WorldVec): void {
  useFrame(() => {
    ref.current?.position.set(position[0], position[1], position[2])
  }, FOLLOW_PRIORITY)
}
