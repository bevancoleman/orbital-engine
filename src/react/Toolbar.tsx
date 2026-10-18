import { memo } from 'react'
import type { StarSystemData } from '../types'
import { selectionValue, type Selection } from './selectionNavigation'
import { buttonStyle, uiStyles } from './theme'

export interface ToolbarProps {
  system: StarSystemData
  selection: Selection
  canGoUp: boolean
  canGoDown: boolean
  /** The zoom slider's position, [0, 1] — derived from the live camera
   *  distance, so it always reflects reality regardless of whether the
   *  camera got there by flying to a selection, a mouse-wheel scroll, or
   *  the slider itself. */
  zoomSliderPosition: number
  onSelectValue: (value: string) => void
  onUp: () => void
  onDown: () => void
  onRecenter: () => void
  onReset: () => void
  onZoomSliderChange: (sliderPosition: number) => void
}

/**
 * The object dropdown, hierarchy navigation and zoom slider above the
 * canvas. Memoized: with stable callbacks from OrbitalSystemScene it only
 * re-renders when the selection, available navigation or zoom changes —
 * not on every simulation tick.
 *
 * The button text (glyph included) is each button's accessible name, and
 * the e2e suite selects buttons by exactly those names — change them in
 * step with e2e/*.spec.ts.
 */
export const Toolbar = memo(function Toolbar({
  system,
  selection,
  canGoUp,
  canGoDown,
  zoomSliderPosition,
  onSelectValue,
  onUp,
  onDown,
  onRecenter,
  onReset,
  onZoomSliderChange,
}: ToolbarProps) {
  return (
    <div style={uiStyles.toolbar}>
      <select
        aria-label="Select an object"
        value={selectionValue(selection)}
        onChange={(e) => onSelectValue(e.target.value)}
        style={uiStyles.select}
      >
        <option value="">— select an object —</option>
        <optgroup label="Bodies">
          {system.bodies.map((b) => (
            <option key={b.id} value={selectionValue({ kind: 'body', id: b.id })}>
              {b.name}
            </option>
          ))}
        </optgroup>
        {system.belts && system.belts.length > 0 && (
          <optgroup label="Belts / clusters">
            {system.belts.map((b) => (
              <option key={b.id} value={selectionValue({ kind: 'belt', id: b.id })}>
                {b.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <button onClick={onUp} disabled={!canGoUp} title="Zoom out to the parent body" style={buttonStyle(!canGoUp)}>
        ↑ Up
      </button>
      <button onClick={onDown} disabled={!canGoDown} title="Zoom in to the first orbiting object" style={buttonStyle(!canGoDown)}>
        ↓ Down
      </button>
      <button
        onClick={onRecenter}
        disabled={!selection}
        title="Snap back to the correct zoom for the selected object"
        style={buttonStyle(!selection)}
      >
        ⟲ Recenter
      </button>
      <button onClick={onReset} title="Clear selection and return to the whole-system overview" style={buttonStyle()}>
        Reset
      </button>

      <label style={uiStyles.zoomLabel}>
        Zoom
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={zoomSliderPosition * 1000}
          onChange={(e) => onZoomSliderChange(Number(e.target.value) / 1000)}
          title="Zoom in/out directly — logarithmic, so a small drag near either end reaches a true-scale object or the whole system just as fast as the middle of the slider does"
          style={uiStyles.zoomSlider}
        />
      </label>
    </div>
  )
})
