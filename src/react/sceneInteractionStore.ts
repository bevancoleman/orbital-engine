import { setsEqual } from './setUtils'

/**
 * The per-frame interaction state ProximitySelector computes — which body
 * is hovered, which bodies' dots render and which get a label — held in a
 * tiny external store instead of OrbitalSystemScene's React state.
 *
 * It used to be root state, and every change (the hover target can change
 * on any frame the pointer moves; the visible sets on any frame the camera
 * does) re-rendered the whole scene: every BodyMarker, every orbit line,
 * every label. With the store, each BodyMarker subscribes
 * to just its own three bits (see bodyInteractionFlags and
 * useBodyInteractionFlags) via useSyncExternalStore, so a hover change
 * re-renders the two bodies involved and nothing else. No new dependency —
 * this is the whole store.
 */
export interface SceneInteractionSnapshot {
  hoveredId: string | null
  visibleLabelIds: ReadonlySet<string>
  visibleBodyIds: ReadonlySet<string>
}

export interface SceneInteractionStore {
  getSnapshot(): SceneInteractionSnapshot
  subscribe(listener: () => void): () => void
  setHoveredId(id: string | null): void
  setVisibleLabelIds(ids: ReadonlySet<string>): void
  setVisibleBodyIds(ids: ReadonlySet<string>): void
  /** The body whose HTML label the pointer is directly over. Deliberately
   *  NOT part of the snapshot and doesn't notify: it's an input to
   *  ProximitySelector's next frame (see computeProximityFrame), which
   *  turns it into hoveredId — the label never sets hover itself. */
  getLabelHoverId(): string | null
  setLabelHoverId(id: string): void
  /** Clears the label hover only if it's still `id` — a mouseleave from
   *  one label can arrive after the mouseenter of the next. */
  clearLabelHoverId(id: string): void
  /** Back to empty — on a system switch, so nothing from the previous
   *  system's last frame (a hidden body, a stale hover) carries over. */
  reset(): void
}

const EMPTY: SceneInteractionSnapshot = { hoveredId: null, visibleLabelIds: new Set(), visibleBodyIds: new Set() }

export function createSceneInteractionStore(): SceneInteractionStore {
  let snapshot = EMPTY
  let labelHoverId: string | null = null
  const listeners = new Set<() => void>()

  function update(next: SceneInteractionSnapshot): void {
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setHoveredId(id) {
      if (id !== snapshot.hoveredId) update({ ...snapshot, hoveredId: id })
    },
    setVisibleLabelIds(ids) {
      if (!setsEqual(ids, snapshot.visibleLabelIds)) update({ ...snapshot, visibleLabelIds: ids })
    },
    setVisibleBodyIds(ids) {
      if (!setsEqual(ids, snapshot.visibleBodyIds)) update({ ...snapshot, visibleBodyIds: ids })
    },
    getLabelHoverId: () => labelHoverId,
    setLabelHoverId(id) {
      labelHoverId = id
    },
    clearLabelHoverId(id) {
      if (labelHoverId === id) labelHoverId = null
    },
    reset() {
      labelHoverId = null
      if (snapshot !== EMPTY) update(EMPTY)
    },
  }
}

export const BODY_FLAG_HOVERED = 1
export const BODY_FLAG_LABEL = 2
export const BODY_FLAG_VISIBLE = 4

/** One body's slice of the snapshot as a single number — a primitive, so
 *  useSyncExternalStore's equality check only re-renders a subscriber when
 *  one of ITS bits actually changed. */
export function bodyInteractionFlags(snapshot: SceneInteractionSnapshot, id: string): number {
  return (
    (snapshot.hoveredId === id ? BODY_FLAG_HOVERED : 0) |
    (snapshot.visibleLabelIds.has(id) ? BODY_FLAG_LABEL : 0) |
    (snapshot.visibleBodyIds.has(id) ? BODY_FLAG_VISIBLE : 0)
  )
}
