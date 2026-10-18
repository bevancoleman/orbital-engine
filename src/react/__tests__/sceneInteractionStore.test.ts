import { jest } from '@jest/globals'
import {
  BODY_FLAG_HOVERED,
  BODY_FLAG_LABEL,
  BODY_FLAG_VISIBLE,
  bodyInteractionFlags,
  createSceneInteractionStore,
} from '../sceneInteractionStore'

describe('createSceneInteractionStore', () => {
  it('starts empty', () => {
    const store = createSceneInteractionStore()
    const snap = store.getSnapshot()
    expect(snap.hoveredId).toBeNull()
    expect(snap.visibleLabelIds.size).toBe(0)
    expect(snap.visibleBodyIds.size).toBe(0)
    expect(store.getLabelHoverId()).toBeNull()
  })

  it('notifies subscribers and replaces the snapshot only on a real change', () => {
    const store = createSceneInteractionStore()
    const listener = jest.fn()
    store.subscribe(listener)
    const before = store.getSnapshot()

    store.setHoveredId(null)
    store.setVisibleBodyIds(new Set())
    store.setVisibleLabelIds(new Set())
    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toBe(before)

    store.setHoveredId('earth')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot().hoveredId).toBe('earth')

    store.setVisibleBodyIds(new Set(['earth', 'moon']))
    store.setVisibleBodyIds(new Set(['moon', 'earth']))
    expect(listener).toHaveBeenCalledTimes(2)

    store.setVisibleLabelIds(new Set(['earth']))
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('unsubscribes', () => {
    const store = createSceneInteractionStore()
    const listener = jest.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.setHoveredId('x')
    expect(listener).not.toHaveBeenCalled()
  })

  it('tracks a label hover without notifying (ProximitySelector reads it next frame)', () => {
    const store = createSceneInteractionStore()
    const listener = jest.fn()
    store.subscribe(listener)
    store.setLabelHoverId('mars')
    expect(store.getLabelHoverId()).toBe('mars')
    // Leaving a different label must not clear the current one.
    store.clearLabelHoverId('venus')
    expect(store.getLabelHoverId()).toBe('mars')
    store.clearLabelHoverId('mars')
    expect(store.getLabelHoverId()).toBeNull()
    expect(listener).not.toHaveBeenCalled()
  })

  it('reset clears everything, including the visible-body set and the label hover', () => {
    const store = createSceneInteractionStore()
    store.setHoveredId('a')
    store.setVisibleBodyIds(new Set(['a']))
    store.setVisibleLabelIds(new Set(['a']))
    store.setLabelHoverId('a')
    const listener = jest.fn()
    store.subscribe(listener)
    store.reset()
    expect(store.getSnapshot()).toEqual({ hoveredId: null, visibleBodyIds: new Set(), visibleLabelIds: new Set() })
    expect(store.getLabelHoverId()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
    store.reset()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('bodyInteractionFlags', () => {
  it('packs one body’s hovered/label/visible state into a primitive, so a per-body subscription only re-renders that body', () => {
    const snap = { hoveredId: 'a', visibleLabelIds: new Set(['a', 'b']), visibleBodyIds: new Set(['a', 'c']) }
    expect(bodyInteractionFlags(snap, 'a')).toBe(BODY_FLAG_HOVERED | BODY_FLAG_LABEL | BODY_FLAG_VISIBLE)
    expect(bodyInteractionFlags(snap, 'b')).toBe(BODY_FLAG_LABEL)
    expect(bodyInteractionFlags(snap, 'c')).toBe(BODY_FLAG_VISIBLE)
    expect(bodyInteractionFlags(snap, 'z')).toBe(0)
  })
})
