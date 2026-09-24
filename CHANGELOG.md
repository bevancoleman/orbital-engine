# orbital-engine

## 1.2.0

### Minor Changes

- 2c921d4: Cap playback speed to a realistic range the camera can actually render smoothly, and make flights/tracking follow a moving destination's real trajectory instead of a single fixed point.
  
  - **Behavior change**: `MAX_DAYS_PER_SECOND` is now capped at `MAX_HOURS_PER_SECOND` (6 simulated hours per real second, down from ~146h/s), anchored to Phobos/ISS orbital periods — a fast, close orbiter's flight used to develop genuine curvature spikes past this speed that no amount of smoothing could fix. `DEFAULT_DAYS_PER_SECOND` is lowered to match (1h/s, was 24h/s). A new `clampPlaybackSpeed(daysPerSecond)` export clamps any requested speed into the supported range — `OrbitalSystemScene`'s own `initialDaysPerSecond` prop is now routed through it.
  - A fly-to now tracks a moving destination's real predicted trajectory throughout the flight (not just its fixed endpoint), and live tracking of a body whose own parent is also moving is smoothed to avoid inheriting that epicycle's full frame-to-frame jitter — both fall back to the previous exact behavior whenever that would risk losing framing on a close/fast body.
  - Fixes a real discontinuity at the seam between a flight and the tracking phase that follows it, for any flight begun while time is playing.
  
  No public API removed or renamed; existing integrations continue to work, but anything that assumed the old (much higher) max speed will see it clamped lower.

## 1.1.0

### Minor Changes

- Smoother, more predictable camera flights and new consumer controls:
  
  - Fly-to camera transitions now avoid passing too close through/behind large bodies along the way, and use a proper eased flight path (own tween, not delegated to `camera-controls`' transition system) so true-scale bodies close together (e.g. the ISS and Hubble) always animate instead of sometimes silently snapping.
  - Arriving at a body now reliably keeps its parent in frame (raised the look-bias default so the parent lands on screen, not just nudged toward it), and a shared "context body" (e.g. Earth, when flying between two of its satellites) stays framed mid-flight without the camera swinging wide or clipping through it.
  - Fixed a late-flight "whiplash" — the camera's final approach could swing tens of degrees in a single frame right before settling; it now decelerates smoothly into the landing.
  - Simulated time now defaults to paused, with `initialPlaying` and `initialDaysPerSecond` props to configure the starting playback state, and a widened, more sensibly-scaled speed range (real-time up to ~1 year/60s).
  - Added an action log: pass `onAction` to `OrbitalSystemScene` to receive a structured, exportable record of camera/selection/playback actions (via the new `formatActionLog`/`formatActionLogEntry` helpers and `ActionLogEntry` type) for exact bug reproduction — recording only, no built-in replay.

## 1.0.0

### Major Changes

- b260de0: **Breaking:** `CelestialBody.fixedPosition` is now required (but nullable — `FixedPosition | null`), matching `orbit`'s own already-required-but-nullable shape. A TypeScript caller constructing a `CelestialBody` must now write an explicit `fixedPosition: null` for a body with none, rather than omitting the key — omitting it used to type-check even though `orbit: null` + no `fixedPosition` silently placed the body at the system's origin with no error. Update any `CelestialBody` object literals you construct directly (JSON/plain-JS data is unaffected — this is a type-level change only, runtime behavior for existing data is unchanged).
  
  Also adds `validateSystemData(system)`, a combined data-contract/rendering-legibility check a host app (or its own tests) can run against a loaded system, covering:
  - `missing-position` — a body with `orbit: null` and `fixedPosition: null` (would silently render at the origin).
  - `unrecognized-type` — a `type` value that isn't a real `BodyType`, reachable from plain-JS/JSON data even though the TS type is a closed union.
  - `embedded-in-parent` — a body rendering inside its own immediate parent's sphere (`findBodiesInsideParent`, exported individually too).
  - `embedded-in-sibling` — two bodies sharing a parent that render inside each other's spheres (`findBodiesInsideSiblings`, exported individually too; scoped to each parent's own children, not a full system-wide O(n²) scan).
  
  None of these are data-correctness checks against upstream source data (that's a data pipeline's own job) — they're signals that a body's data, while possibly entirely correct, either relies on an implicit default or will render occluded/overlapping. Wired into `OrbitalSystemScene`'s `devMode` overlay as a combined "⚠ DATA WARNINGS" section.
  
  **New `BodyType`: `'surface_installation'`** — a structure genuinely built on a parent body's own surface (a landing-zone city, a ground-based prison, a mining outpost), as opposed to `'station'`, which orbits or floats free. Rendered as a small platform+beacon marker instead of a floating torus, so it doesn't visually read as an orbiting structure it isn't. `findBodiesInsideParent`/`findBodiesInsideSiblings` both exempt it: sitting at/near its own parent's real surface (or close to another installation at the same real site) is the *definition* of correct for this type, not a containment problem.

## 0.2.0

### Minor Changes

- 65fe86f: Add an opt-in `devMode` prop to `OrbitalSystemScene` that renders a dev-only performance overlay: FPS/frame time, draw calls, triangle/point/line counts, compiled shader program count, GPU-resident geometry/texture counts, JS heap usage where the browser exposes it, and object counts (total vs. currently-visible/culled bodies, shown labels, belt points, and the selected/hovered body's current LOD tier).
