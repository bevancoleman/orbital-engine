import {
  LABEL_BASE_OFFSET_PX,
  LABEL_MAX_RADIUS_OFFSET_PX,
  bodyLabelStyle,
  labelOffsetPx,
  labelZIndex,
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
  it('returns the same object for the same state (so applying it can skip unchanged states)', () => {
    expect(bodyLabelStyle(false, false)).toBe(bodyLabelStyle(false, false))
    expect(bodyLabelStyle(true, false)).toBe(bodyLabelStyle(true, true))
  })

  it('reserves colour and weight changes for selected/hovered', () => {
    expect(bodyLabelStyle(false, false)).toMatchObject({ color: '#cbd5e1', 'font-weight': '400' })
    expect(bodyLabelStyle(false, true)).toMatchObject({ color: '#22d3ee', 'font-weight': '700' })
    expect(bodyLabelStyle(true, false)).toMatchObject({ color: '#ffffff', 'font-weight': '700' })
  })

  it('is never text-selectable and always clickable', () => {
    for (const style of [bodyLabelStyle(false, false), bodyLabelStyle(true, false), bodyLabelStyle(false, true)]) {
      expect(style).toMatchObject({ 'user-select': 'none', 'pointer-events': 'auto', cursor: 'pointer' })
    }
  })

  it('uses only CSS property names and string values, so it can be applied with style.setProperty', () => {
    for (const [name, value] of Object.entries(bodyLabelStyle(false, false))) {
      expect(name).toMatch(/^-?[a-z-]+$/)
      expect(typeof value).toBe('string')
    }
  })
})

describe('labelZIndex', () => {
  it('stacks nearer labels above farther ones, within [0, LABEL_Z_INDEX_MAX]', () => {
    const near = labelZIndex(1, 0.01, 1000)
    const far = labelZIndex(500, 0.01, 1000)
    expect(near).toBeGreaterThan(far)
    expect(labelZIndex(0.01, 0.01, 1000)).toBeLessThanOrEqual(16777271)
    expect(labelZIndex(1000, 0.01, 1000)).toBe(0)
  })

  it('clamps distances outside the depth range and survives a degenerate range', () => {
    expect(labelZIndex(5000, 0.01, 1000)).toBe(0)
    expect(labelZIndex(-1, 0.01, 1000)).toBe(labelZIndex(0.01, 0.01, 1000))
    expect(labelZIndex(1, 1, 1)).toBe(0)
  })
})
