/**
 * Placement and styling for a body's HTML text label (see BodyMarker) —
 * pure, so it's unit-testable without a renderer.
 */

/** Gap between the top of a body's projected disc and its label's centre. */
export const LABEL_BASE_OFFSET_PX = 14

/** The most a body's own projected size can push its label upward — past
 *  this, a body close enough to fill the view would push its own label off
 *  the top of the screen. */
export const LABEL_MAX_RADIUS_OFFSET_PX = 220

/**
 * On-screen radius (CSS px) of a sphere of world radius `worldRadius` seen
 * from `distance` through a perspective camera with the given vertical
 * FOV, rendered into a viewport `viewportHeightPx` tall.
 */
export function projectedRadiusPx(worldRadius: number, distance: number, verticalFovDeg: number, viewportHeightPx: number): number {
  if (worldRadius <= 0) return 0
  if (distance <= 0) return Infinity
  const halfFov = (verticalFovDeg * Math.PI) / 360
  return (worldRadius / (distance * Math.tan(halfFov))) * (viewportHeightPx / 2)
}

/**
 * How far above a body's centre its label sits, in px. This used to be
 * `radius * 8 + 14` — a world-space radius multiplied straight into a
 * pixel offset, which only looked right at one zoom level: a body the
 * camera was close to got its label printed over its own disc, while a
 * pixel-floored dot got a label floating away from it at others. Working
 * from the PROJECTED radius keeps the label just clear of the body at any
 * zoom.
 */
export function labelOffsetPx(projectedRadius: number): number {
  if (Number.isNaN(projectedRadius)) return LABEL_BASE_OFFSET_PX
  return LABEL_BASE_OFFSET_PX + Math.min(Math.max(projectedRadius, 0), LABEL_MAX_RADIUS_OFFSET_PX)
}

/** The top of the z-index range labels are stacked in — the same range
 *  drei's <Html> used (labels were <Html> elements before BodyLabel drew
 *  its own), so nothing else on a consumer's page changes stacking. */
export const LABEL_Z_INDEX_MAX = 16777271

/** Nearer labels stack above farther ones: linear in camera distance
 *  across the near→far depth range, LABEL_Z_INDEX_MAX at the near plane
 *  down to 0 at the far plane. */
export function labelZIndex(distance: number, near: number, far: number): number {
  if (!(far > near)) return 0
  const clamped = Math.min(far, Math.max(near, distance))
  return Math.round((LABEL_Z_INDEX_MAX * (far - clamped)) / (far - near))
}

// Selection/hover highlighting is a LABEL-only signal — the body's own
// shape always renders its real colour, never overridden to white on
// selection. Label text deliberately does NOT use the body's own render
// colour by default either — a neutral, always-legible grey, reserving
// colour changes for actual state (selected/hovered) so "the text changes
// colour on mouseover/select" reads as a clear signal, not lost among
// labels that were already all different colours.
const LABEL_COLOR = { selected: '#ffffff', hovered: '#22d3ee', idle: '#cbd5e1' } as const

/** CSS declarations (property name → value), applied straight to the
 *  label's DOM element with style.setProperty — see BodyLabel for why the
 *  label isn't a React-rendered element any more. */
export type LabelCss = Readonly<Record<string, string>>

const LABEL_BASE_STYLE: LabelCss = {
  'font-size': '11px',
  'white-space': 'nowrap',
  'text-shadow': '0 1px 2px rgba(0,0,0,0.9)',
  cursor: 'pointer',
  'pointer-events': 'auto',
  // This label exists purely as a click/hover target for body selection
  // (backed up by bubble-cursor proximity selection — see
  // ProximitySelector) — it was never meant to be readable, copyable body
  // text. Without this, clicking or dragging near it could start the
  // browser's native text-selection gesture instead of registering as a
  // body-select click, which is what "hovering the text stops me selecting
  // it" actually was: the two interactions competing for the same
  // mouse-down.
  'user-select': 'none',
  '-webkit-user-select': 'none',
}

// One frozen object per state, so BodyLabel can tell "same state" by
// identity and skip re-applying it.
const LABEL_STYLES = {
  selected: { ...LABEL_BASE_STYLE, color: LABEL_COLOR.selected, 'font-weight': '700' },
  hovered: { ...LABEL_BASE_STYLE, color: LABEL_COLOR.hovered, 'font-weight': '700' },
  idle: { ...LABEL_BASE_STYLE, color: LABEL_COLOR.idle, 'font-weight': '400' },
} as const satisfies Record<string, LabelCss>

export function bodyLabelStyle(selected: boolean, hovered: boolean): LabelCss {
  return selected ? LABEL_STYLES.selected : hovered ? LABEL_STYLES.hovered : LABEL_STYLES.idle
}
