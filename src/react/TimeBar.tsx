import { MAX_DAYS_PER_SECOND, REAL_TIME_DAYS_PER_SECOND, formatPlaybackSpeed } from '../timeScale'
import { distanceToSliderPosition, sliderPositionToDistance } from '../zoomSlider'
import { uiStyles } from './theme'

export interface TimeBarProps {
  simDate: Date
  playing: boolean
  daysPerSecond: number
  onTogglePlaying: () => void
  onSpeedChange: (daysPerSecond: number) => void
}

/**
 * Play/Pause, the playback-speed slider and the simulated date, along the
 * bottom of the canvas. Only shown for a system with real orbital motion
 * (see OrbitalSystemScene). The Speed slider's accessible name comes from
 * its wrapping <label> ("Speed …") — the e2e suite finds it by that.
 */
export function TimeBar({ simDate, playing, daysPerSecond, onTogglePlaying, onSpeedChange }: TimeBarProps) {
  return (
    <div style={uiStyles.timeBar}>
      <button onClick={onTogglePlaying} style={uiStyles.button}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <label style={uiStyles.speedLabel}>
        Speed
        {/* Reuses the zoom slider's own generic log-mapping (see
            zoomSlider.ts) — same underlying problem (a value from a
            MIN/MAX range off a linear [0, 1] slider position), just for
            playback speed instead of camera distance; see timeScale.ts for
            why this range specifically needs it. */}
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={distanceToSliderPosition(daysPerSecond, REAL_TIME_DAYS_PER_SECOND, MAX_DAYS_PER_SECOND) * 1000}
          onChange={(e) =>
            onSpeedChange(sliderPositionToDistance(Number(e.target.value) / 1000, REAL_TIME_DAYS_PER_SECOND, MAX_DAYS_PER_SECOND))
          }
          title={`Playback speed — logarithmic, from real-time up to ${MAX_DAYS_PER_SECOND * 24} simulated hours per second`}
        />
        <span style={uiStyles.speedValue}>{formatPlaybackSpeed(daysPerSecond)}</span>
      </label>
      <span style={uiStyles.simDate}>{simDate.toISOString().slice(0, 10)}</span>
    </div>
  )
}
