import {
  LABEL_BASE_OFFSET_PX,
  LABEL_MAX_RADIUS_OFFSET_PX,
  bodyLabelStyle,
  labelOffsetPx,
  projectedRadiusPx,
} from '../labelLayout'

describe('projectedRadiusPx', () => {
  it('is the on-screen radius of a sphere at the given distance', () => {
    // 90° vertical FOV → tan(45°) = 1, so at distance 10 the half-height
    // of the view spans 10 world units over 300 px.
    expect(projectedRadiusPx(1, 10, 90, 600)).toBeCloseTo(30)
    expect(projectedRadiusPx(2, 10, 90, 600)).toBeCloseTo(60)
    expect(projectedRadiusPx(1, 20, 90, 600)).toBeCloseTo(15)
  })

  it('is unbounded (Infinity) at zero distance and 0 for non-positive radii', () => {
    expect(projectedRadiusPx(1, 0, 50, 600)).toBe(Infinity)
    expect(projectedRadiusPx(0, 10, 50, 600)).toBe(0)
  })
})

describe('labelOffsetPx', () => {
  it('sits a fixed gap above a dot-sized body', () => {
    expect(labelOffsetPx(0)).toBe(LABEL_BASE_OFFSET_PX)
    expect(labelOffsetPx(3)).toBe(LABEL_BASE_OFFSET_PX + 3)
  })

  it('clears the projected disc of a larger body, capped so a body filling the view keeps its label on screen', () => {
    expect(labelOffsetPx(80)).toBe(LABEL_BASE_OFFSET_PX + 80)
    expect(labelOffsetPx(5000)).toBe(LABEL_BASE_OFFSET_PX + LABEL_MAX_RADIUS_OFFSET_PX)
    expect(labelOffsetPx(Infinity)).toBe(LABEL_BASE_OFFSET_PX + LABEL_MAX_RADIUS_OFFSET_PX)
  })

  it('treats NaN as a dot', () => {
    expect(labelOffsetPx(Number.NaN)).toBe(LABEL_BASE_OFFSET_PX)
  })
})

describe('bodyLabelStyle', () => {
  it('returns the same object for the same state (so drei <Html> content stays referentially stable)', () => {
    expect(bodyLabelStyle(false, false)).toBe(bodyLabelStyle(false, false))
    expect(bodyLabelStyle(true, false)).toBe(bodyLabelStyle(true, true))
  })

  it('reserves colour and weight changes for selected/hovered', () => {
    expect(bodyLabelStyle(false, false)).toMatchObject({ color: '#cbd5e1', fontWeight: 400 })
    expect(bodyLabelStyle(false, true)).toMatchObject({ color: '#22d3ee', fontWeight: 700 })
    expect(bodyLabelStyle(true, false)).toMatchObject({ color: '#ffffff', fontWeight: 700 })
  })

  it('is never text-selectable and always clickable', () => {
    for (const style of [bodyLabelStyle(false, false), bodyLabelStyle(true, false), bodyLabelStyle(false, true)]) {
      expect(style).toMatchObject({ userSelect: 'none', pointerEvents: 'auto', cursor: 'pointer' })
    }
  })
})
