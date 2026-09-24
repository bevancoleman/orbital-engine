---
"orbital-engine": minor
---

Cap playback speed to a realistic range the camera can actually render smoothly, and make flights/tracking follow a moving destination's real trajectory instead of a single fixed point.

- **Behavior change**: `MAX_DAYS_PER_SECOND` is now capped at `MAX_HOURS_PER_SECOND` (6 simulated hours per real second, down from ~146h/s), anchored to Phobos/ISS orbital periods — a fast, close orbiter's flight used to develop genuine curvature spikes past this speed that no amount of smoothing could fix. `DEFAULT_DAYS_PER_SECOND` is lowered to match (1h/s, was 24h/s). A new `clampPlaybackSpeed(daysPerSecond)` export clamps any requested speed into the supported range — `OrbitalSystemScene`'s own `initialDaysPerSecond` prop is now routed through it.
- A fly-to now tracks a moving destination's real predicted trajectory throughout the flight (not just its fixed endpoint), and live tracking of a body whose own parent is also moving is smoothed to avoid inheriting that epicycle's full frame-to-frame jitter — both fall back to the previous exact behavior whenever that would risk losing framing on a close/fast body.
- Fixes a real discontinuity at the seam between a flight and the tracking phase that follows it, for any flight begun while time is playing.

No public API removed or renamed; existing integrations continue to work, but anything that assumed the old (much higher) max speed will see it clamped lower.
