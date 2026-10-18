import { computeProximityFrame, pointerPresenceAfter, type ProximityFrameInput } from '../proximityFrame'
import type { ScreenCandidate } from '../../labelDeclutter'

function input(overrides: Partial<ProximityFrameInput>): ProximityFrameInput {
  return {
    projected: { onScreen: [], offScreenIds: [] },
    pointerPx: null,
    labelHoverId: null,
    alwaysVisibleIds: new Set(),
    selectedId: null,
    ...overrides,
  }
}

const c = (id: string, x: number, y: number, priority = 1): ScreenCandidate => ({ id, x, y, priority })

describe('computeProximityFrame — hover', () => {
  it('hovers the nearest on-screen candidate within the snap radius', () => {
    const result = computeProximityFrame(
      input({ projected: { onScreen: [c('a', 100, 100), c('b', 120, 100)], offScreenIds: [] }, pointerPx: { x: 118, y: 100 } })
    )
    expect(result.hoverId).toBe('b')
  })

  it('hovers nothing when the pointer is off the canvas (null), even if a body sits where the stale pointer was', () => {
    const result = computeProximityFrame(input({ projected: { onScreen: [c('a', 400, 300)], offScreenIds: [] }, pointerPx: null }))
    expect(result.hoverId).toBeNull()
  })

  it('hovers nothing in empty space', () => {
    const result = computeProximityFrame(
      input({ projected: { onScreen: [c('a', 100, 100)], offScreenIds: [] }, pointerPx: { x: 500, y: 500 } })
    )
    expect(result.hoverId).toBeNull()
  })

  it('never hovers an off-screen (e.g. behind-camera) body', () => {
    const result = computeProximityFrame(
      input({ projected: { onScreen: [], offScreenIds: ['sun'] }, pointerPx: { x: 400, y: 300 } })
    )
    expect(result.hoverId).toBeNull()
  })

  it('a hovered label wins over proximity, so the highlight and what a click selects always agree', () => {
    const result = computeProximityFrame(
      input({
        projected: { onScreen: [c('a', 100, 100), c('b', 300, 300)], offScreenIds: [] },
        pointerPx: { x: 100, y: 100 },
        labelHoverId: 'b',
      })
    )
    expect(result.hoverId).toBe('b')
  })

  it('ignores a label hover for a body that is no longer an on-screen candidate', () => {
    const result = computeProximityFrame(
      input({ projected: { onScreen: [c('a', 100, 100)], offScreenIds: ['gone'] }, pointerPx: { x: 100, y: 100 }, labelHoverId: 'gone' })
    )
    expect(result.hoverId).toBe('a')
  })
})

describe('computeProximityFrame — body and label visibility', () => {
  it('thins crowded secondary dots by priority but never thins always-visible ones', () => {
    const result = computeProximityFrame(
      input({
        projected: { onScreen: [c('planet', 100, 100, 1), c('moon', 105, 100, 2), c('star', 102, 100, 0)], offScreenIds: [] },
        alwaysVisibleIds: new Set(['planet']),
      })
    )
    // planet exempt; star (priority 0) beats moon in the thinning pass.
    expect(result.visibleBodyIds).toEqual(new Set(['planet', 'star']))
  })

  it('keeps off-screen bodies visible — they crowd nothing on screen, and must already exist when they come into view', () => {
    const result = computeProximityFrame(input({ projected: { onScreen: [c('a', 100, 100)], offScreenIds: ['behind'] } }))
    expect(result.visibleBodyIds).toEqual(new Set(['a', 'behind']))
    expect(result.visibleLabelIds).toEqual(new Set(['a']))
  })

  it('never shows a label for a body whose dot was thinned out', () => {
    // moon's dot loses to the star at 14 px; its label must not draw on its own.
    const result = computeProximityFrame(
      input({ projected: { onScreen: [c('star', 100, 100, 0), c('moon', 110, 100, 2), c('far', 400, 400, 2)], offScreenIds: [] } })
    )
    expect(result.visibleBodyIds.has('moon')).toBe(false)
    expect(result.visibleLabelIds.has('moon')).toBe(false)
    expect(result.visibleLabelIds).toEqual(new Set(['star', 'far']))
  })

  it('selected and hovered bodies win both thinning passes over structurally shallower neighbours', () => {
    const projected = { onScreen: [c('star', 100, 100, 0), c('moon', 110, 100, 2), c('sat', 300, 300, 3), c('planet', 305, 300, 1)], offScreenIds: [] }
    const result = computeProximityFrame(input({ projected, selectedId: 'moon', pointerPx: { x: 300, y: 300 } }))
    expect(result.hoverId).toBe('sat')
    expect(result.visibleBodyIds.has('moon')).toBe(true)
    expect(result.visibleBodyIds.has('star')).toBe(false)
    expect(result.visibleBodyIds.has('sat')).toBe(true)
    expect(result.visibleBodyIds.has('planet')).toBe(false)
    expect(result.visibleLabelIds).toEqual(new Set(['moon', 'sat']))
  })
})

describe('pointerPresenceAfter', () => {
  it('enters on pointerenter/pointermove/pointerdown', () => {
    expect(pointerPresenceAfter({ type: 'pointerenter', pointerType: 'mouse' }, false)).toBe(true)
    expect(pointerPresenceAfter({ type: 'pointermove', pointerType: 'mouse' }, false)).toBe(true)
    expect(pointerPresenceAfter({ type: 'pointerdown', pointerType: 'touch' }, false)).toBe(true)
  })

  it('leaves on a mouse pointerleave', () => {
    expect(pointerPresenceAfter({ type: 'pointerleave', pointerType: 'mouse' }, true)).toBe(false)
  })

  it('stays put on a touch/pen pointerleave — a tap ends with pointerleave BEFORE its click, which must still select', () => {
    expect(pointerPresenceAfter({ type: 'pointerleave', pointerType: 'touch' }, true)).toBe(true)
    expect(pointerPresenceAfter({ type: 'pointerleave', pointerType: 'pen' }, true)).toBe(true)
  })

  it('ignores unrelated events', () => {
    expect(pointerPresenceAfter({ type: 'wheel', pointerType: '' }, true)).toBe(true)
    expect(pointerPresenceAfter({ type: 'wheel', pointerType: '' }, false)).toBe(false)
  })
})
