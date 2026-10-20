# orbital-engine

## 1.5.0

### Minor Changes

- 931d05a: Flying to a body now frames the body itself: its diameter fills about 40% of the view (`BODY_VIEW_FILL`), with rings kept in frame, instead of fitting its whole moon system — planets no longer arrive as small dots. Clicking the selected body again flies out to its moon-system view and back. New `arrivalFraming` prop on `OrbitalSystemScene` (`'body'`, the default, or `'system'` for the previous behaviour) and a `data-framing` attribute on its root. `computeFocusForBody` takes an optional `BodyFraming` (`'body'` by default; `computeFocusForSystem` is unchanged), and the new `distanceToFillView` and `RING_VIEW_FILL` are exported. When the close-up body would hide its parent from the look-back angle a fly-to ends on, the view turns just far enough to show it (`FocusTarget.lookBiasClearanceDeg`). Satellites below the precision floor (ISS, Hubble) arrive at the same distance as before.
- e7fe55c: Core math and data fixes from review:
  
  - **Kepler solver** no longer silently diverges on very eccentric orbits (e ≳ 0.98): seeded at π above e = 0.8 and safeguarded with bisection. `solveEccentricAnomaly` is now exported.
  - **Rings and moons share one equator.** New optional `CelestialBody.pole` (spin axis) and `OrbitalElements.referencePlanePole` (the plane an orbit's elements are quoted against), plus `poleFromEquatorialJ2000`, `bodyPoleVector`, `orbitNormal`, `planeBasis`, `equatorialNodeOffsetDeg` and `ringPlaneQuaternion`. Rings are now drawn with `ringPlaneQuaternion`, fixing a sign error that put a moon at the planet's own tilt twice that tilt off the ring plane. `ringTiltRadians` is deprecated.
  - **Solar System data:** moons use JPL's satellite mean elements in their real Laplace/equatorial planes and ringed planets carry IAU spin poles — Saturn's moons now sit in its ring plane, Uranus's moons are coplanar and prograde, Triton is retrograde ~23° off Neptune's equator, Charon orbits in Pluto's equator, and the ISS/Hubble inclinations are to Earth's equator. Halley's and the rounded asteroid periods now follow from their semi-major axes. The Oort cloud is a full spherical shell.
  - **Validation:** `validateSystemData` adds `unknown-parent`, `parent-cycle`, `invalid-orbit` (including epochs with no time zone), `invalid-radius` and `periapsis-inside-parent` warnings, and `missing-position` now catches omitted keys from plain JSON. Rings on a zero-radius body are flagged instead of drawing at Infinity.
  - **Robustness:** position resolution no longer overflows the stack on a parent cycle; an offset-less epoch date-time is read as UTC instead of local time; `orbitPath` clamps bad segment counts; level-of-detail pickers fall back to the lowest level for NaN/negative sizes; `clampPlaybackSpeed(NaN)` returns the default speed.
  - **Belts:** `inclinationSpreadDeg` is documented as the full thickness (±half); shells now sample uniformly by volume and solid angle.
  - **Performance:** cached id index for parent lookups, cached epoch parsing and orbit orientation, a shared arc-length table for `orbitPath`, a spatial grid for `thinByScreenProximity`, and `coOrbitalReferenceAngle` accepts precomputed positions.
  - **Types:** `BODY_TYPES` runtime array (`BodyType` is derived from it), `PoleDirection`, `Vec3Km` moved to the data contract; belt site/real positions use `FixedPosition`.
- 931d05a: More zoom for small bodies: the ISS and Hubble now arrive framed like any other body, filling about 40% of the view, and the camera can get much closer still. The scene is drawn camera-relative and normalized by the viewing distance (the "floating origin" — positions, the camera and camera-controls stay in world coordinates; only the draw call is rebased), which removes the GPU depth-precision limit behind the old floor. `ABSOLUTE_MIN_CAMERA_DISTANCE` drops from `1e-6` to `1e-10`; the camera's near clip plane now follows the viewing distance every frame. Flights that span the deeper zoom take longer, so the default `flightPacing.maxMs` is now 5000 (was 4000), and a flight's duration also allows for its fastest mid-flight turn, not just the turn between its ends.
- 931d05a: Star lighting and comet tails. With `lightFromStar`, planets, moons, asteroids (including the small ones drawn instanced), ring discs and atmospheres are now shaded from the star's true direction, with analytic eclipse shadows (umbra and penumbra, a moon's on its planet and a planet's on its moons) and ring shadows (a planet's on its rings and theirs on it). These are computed in float64 from true km positions, so they are correct at every zoom under the floating origin. Atmosphere rims are brighter on the day side, and a fly-to settles on the body's day side, the Sun 30–50° off the view, instead of looking back past it at its night side. The new `starLighting` prop sets `nightSideBrightness` (default 0.04), `ringShadows` and `eclipseShadows` (default true). Comets orbiting the star get a real ion tail and a curved dust tail that grow towards perihelion and vanish beyond ~5 AU (new `cometTails` prop, default true). The new `initialDate` prop starts the clock at a chosen date. New core exports: `resolveAllTruePositionsKm`, `trueOffsetKm`, `sphereShadowFactor`, `ringShadowTransmission`, `discOverlapFraction`, `rankShadowCasters`, `cometTailGeometry`, `cometActivity`, `ionTailDirection`, `ionTailLengthKm`, `ionTailAberration`; and from `orbital-engine/react`, `DEFAULT_STAR_LIGHTING` and `StarLightingSettings`.
- 931d05a: Large systems stay fast. Orbit lines and fixed bodies' reference rings are drawn on the GPU, all of them in one instanced draw call per level-of-detail tier, with the same look (1px, the body's colour, evenly spaced points); the selected body's orbit is now drawn brighter. Each orbit's detail now follows its own distance from the camera rather than the camera's distance to its target, and an orbit framed from right beside it (the ISS's, at the ISS) stays on its body instead of sagging off it between points, sometimes off the screen. Small placeholder bodies (no model, texture, rings or atmosphere, and small on screen) are drawn as one instanced mesh per shape, and switch back to their own marker when selected, hovered or large on screen. Labels, hover, selection and the visibility fade work as before.
  
  On a 2,000-body synthetic system this takes the scene from ~1,050 draw calls and ~3,000 per-frame callbacks to 8 draw calls and ~40 callbacks, and a zoom step's re-render from ~36ms to ~1.5ms. Body positions are resolved each frame with ~10x less garbage.
- 931d05a: Fly-tos now read as smooth, deliberate travel instead of a 900ms lunge. The camera follows van Wijk & Nuij's optimal zoom-and-pan path — zooming out until the start and the destination are both in view, panning, then zooming in — eased in and out so it starts and ends at rest, with the view's turn spread over the whole flight. Each flight's duration is proportional to that path's length (constant perceived speed), clamped to 1.2–4s, and a moving destination's arrival is predicted for that same duration. New optional `flightPacing` prop on `OrbitalSystemScene` (`{ speed?, minMs?, maxMs? }`; also exported as the `FlightPacing` type, with `DEFAULT_FLIGHT_PACING`) tunes the pace. The shared-parent context bulge now fades in and out with zero slope, so a flight bulged out to keep Earth in frame no longer zooms into its close-up at full speed on its last frame.

### Patch Changes

- e7fe55c: Camera fixes: settled tracking now anchors on the live body (no permanent drift after a flight), keeps manual orbit/dolly damping while following a moving body, and applies writes the same frame; the context bulge, slerp and adaptive tracking smoothing are continuous; the zoom slider mid-flight re-anchors on the destination; collider exclusions survive mid-flight retargets and are released once the camera is clear (including after a deselect); guards for zero trajectory samples and NaN radii.
- e7fe55c: `OrbitalSystemScene`'s root element now carries read-only data attributes describing what the scene is doing, so browser tests (and consumers) can wait on real state instead of fixed sleeps: `data-camera-state` (`flying`, `tracking` or `idle`), `data-flight-count` (fly-tos started since mount, only ever increases), `data-focused-id` (the selected body or belt id, absent when nothing is selected) and `data-sim-playing` (`true`/`false`). Also fixes a fast-orbiting body (e.g. the ISS while time plays) flashing off-centre for a frame or more right as a fly-to lands: the landing frame now anchors on the body's live position, and tracking smoothing no longer reads a camera distance that still lags the flight.
- e7fe55c: Packaging fixes:
  
  - `orbital-engine/react` no longer bundles its own copy of the core — both entry points share one chunk, so apps importing both ship it once. `"use client"` stays the first directive of the react entry (ESM and CJS).
  - `exports` now resolve per condition: `require` gets `.d.cts` declarations, `import` gets `.d.ts`. Added `typesVersions` so `moduleResolution: "node"` finds `orbital-engine/react` types, and exposed `./package.json`.
  - Peer dependency ranges are now bounded to what the code actually supports: `three >=0.152.0 <1.0.0` (was `>=0.150` — r150/r151 lack `Texture.colorSpace`, so textures got the wrong colour space), `@react-three/fiber ^8.13.0 || ^9.0.0` (was `>=8`), `@react-three/drei ^9.56.5 || ^10.0.0` (was `>=9` — `CameraControls` first shipped in 9.54, but only 9.56.5+ bundles camera-controls 2.x, whose `getPosition`/`getTarget(out, false)` and `smoothTime` the camera relies on), `react ^18.0.0 || ^19.0.0` (was `>=18`), and `react-dom ^18.0.0 || ^19.0.0` is now listed (drei's `Html` and fiber's `Canvas` already required it). Setups below the new minimums didn't actually work before; the new upper bounds mean a future fiber 10 / drei 11 / React 20 will report a peer conflict until it's verified.
  - README: the "Build your own system" sample now typechecks (`fixedPosition: null` is required), and the data contract, peer requirements and `OrbitalSystemScene` description (it renders its own `<Canvas>`) are corrected.
- e7fe55c: React layer fixes: bodies behind the camera no longer cause phantom hovers or hide labels, and nothing is hovered while the pointer is off the canvas. Label hover, highlight and click now always agree, and a label is never drawn for a body whose dot was thinned out. Labels are centred over their body and offset by its on-screen size. Geometry is no longer rebuilt on every zoom step. Belt and particle buffers stay parent-relative and are only re-uploaded when they change. Ring and belt textures no longer leak, the action log's debounce timers are cleared on unmount, and dropdown ids containing ":" now work. The scene's controls have better accessibility. The public `orbital-engine/react` exports are unchanged.
- 931d05a: A selected body's label no longer goes missing for a few frames around a fly-to's landing. Labels are now plain DOM elements BodyLabel creates and positions itself, instead of drei `<Html>` elements, whose content was rendered through a separately scheduled React root and could appear several frames late.
  
  Hovering or clicking a body that's drawn larger than the 28px snap radius now hits it anywhere inside its projected disc (the nearest disc to the camera wins where they overlap; a small body in front of a disc still snaps), so the edge of a body framed to fill the view is selectable.
  
  Playback is smooth: the simulated time is advanced, and every body's position resolved, on every frame — bodies, orbit lines, belts (a co-orbital belt now rotates rather than rebuilding its buffer), route lines, the star light, the tracking camera and hover all move per frame, instead of in the ~100ms steps of the React `simDate` state, which now only drives UI text. A new flight's arrival prediction starts from that per-frame time too.

## 1.4.0

### Minor Changes

- d36dcf9: Add planet ring systems as part of the body (`CelestialBody.rings`, drawn in the body's equatorial plane via the new `axialTiltDeg`), and belt shapes, gaps and in-belt sites (`BeltRegion.shape`/`gaps`/`sites`). Belt scatter is now seeded (stable across loads) and area-uniform, and the glow disc's clear centre is sized from compressed radii. Saturn's rings move from a belt onto Saturn itself, Jupiter, Uranus and Neptune gain their ring systems, and the asteroid belt gains its Kirkwood gaps. `validateSystemData` now also reports `invalid-ring` and `invalid-belt` warnings.
  
  `SOLAR_SYSTEM` gains Enceladus, Tethys, Dione and Iapetus (Saturn), Miranda, Ariel, Umbriel and Oberon (Uranus), and the spacecraft-visited asteroids 433 Eros, 101955 Bennu and 486958 Arrokoth, with JPL orbital elements. The with-models example now ships spacecraft shape models for Halley, Vesta, Ceres, Eros, Bennu and Arrokoth, a true-colour Blue Marble Earth, an LRO Moon, and maps of Mercury and the new moons — each sourced and rebuildable (see `examples/with-models/ASSETS.md`).

## 1.3.0

### Minor Changes

- 8cf52d2: Add optional `wikiSummary`/`wikiUrl` fields to `CelestialBody` and `BeltRegion`, rendered in the selected-body/belt info panel below the existing provenance `note` when present. Both fields are consumer-supplied free text/links — the engine has no opinion on where they came from.

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
