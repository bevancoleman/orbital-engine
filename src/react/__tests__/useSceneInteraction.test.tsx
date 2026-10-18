import { act, renderHook } from '../__test-utils__/render'
import { BODY_FLAG_HOVERED, BODY_FLAG_VISIBLE, createSceneInteractionStore } from '../sceneInteractionStore'
import { useBodyInteractionFlags, useSceneInteractionSnapshot } from '../useSceneInteraction'

describe('useBodyInteractionFlags', () => {
  it('re-renders only when this body’s own bits change', () => {
    const store = createSceneInteractionStore()
    let renders = 0
    const hook = renderHook(() => {
      renders++
      return useBodyInteractionFlags(store, 'earth')
    })
    expect(hook.current).toBe(0)
    const baseline = renders

    act(() => store.setHoveredId('mars'))
    expect(renders).toBe(baseline)

    act(() => store.setHoveredId('earth'))
    expect(hook.current).toBe(BODY_FLAG_HOVERED)
    expect(renders).toBe(baseline + 1)

    act(() => store.setVisibleBodyIds(new Set(['earth'])))
    expect(hook.current).toBe(BODY_FLAG_HOVERED | BODY_FLAG_VISIBLE)
    hook.unmount()
  })
})

describe('useSceneInteractionSnapshot', () => {
  it('returns the latest snapshot', () => {
    const store = createSceneInteractionStore()
    const hook = renderHook(() => useSceneInteractionSnapshot(store))
    act(() => store.setVisibleLabelIds(new Set(['a', 'b'])))
    expect(hook.current.visibleLabelIds.size).toBe(2)
    hook.unmount()
  })
})
