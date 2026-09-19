# Architecture

A map of how the pieces fit together — read this before making a non-trivial change. Each module's own doc comments explain *why* it works the way it does; this doc is about how a click becomes a rendered, labeled, selectable body, and which file owns which step.

## The pipeline, in order

A body's journey from data to pixel goes through roughly this sequence every frame:

1. **Position** — `kepler.ts` (`positionAtTime`/`orbitPath`) turns `OrbitalElements` into a real km position via standard Keplerian propagation. `resolve.ts`/`render.ts` (`resolveWorldPosition`/`resolveAllWorldPositions`) walk the parent chain to turn that into an absolute position, composing each parent→child step independently rather than summing real offsets first.
2. **Scale** — `scale.ts` (`compressDistance`/`trueRadius`) maps real km into this engine's compressed render-space units — logarithmic for distance (so a whole solar system and a body's own true radius can share one coordinate space), linear for radius (so nothing catastrophically distorts shape).
3. **Visibility floor** — `pixelFloor.ts` (`renderRadius`/`minVisibleWorldRadius`) floors a body's rendered radius so a true-scale-tiny body (the ISS is a fraction of a pixel at Earth-orbit scale) still reads as a visible dot, without lying about its actual position.
4. **Level of detail** — `levelOfDetail.ts` (`apparentSize` + the `*DetailFor` functions) picks polygon/segment counts from how much of the view a body actually fills right now, not a fixed per-type constant.
5. **Which bodies render at all** — `visibility.ts` (`computeVisibleBodyIds`) ranks every secondary body (moons, stations, asteroids, ...) by prominence and caps the total, so a sparse system shows everything while a crowded one thins down to something readable. `isAlwaysVisible` is the shared "never hide this" rule (primaries, the current selection, its children) — used both here and by the screen-space pass below, from one definition.
6. **Screen-space thinning** — `labelDeclutter.ts` (`thinByScreenProximity`, and `computeVisibleLabels` as its label-specific wrapper) is the shared greedy algorithm for "too many things landed too close together on screen this frame" — applied both to whether a body's TEXT LABEL draws and, separately, to whether its own DOT renders at all, on top of whatever step 5 already decided.
7. **Selection** — `proximitySelection.ts` (`findNearestCandidate`) is bubble-cursor hit-testing: snap to the nearest visible body within a screen-space radius, since raycasting fails once a body's on-screen size drops under a pixel.
8. **Camera framing** — `camera.ts` computes where a fly-to should end up (`computeFocusForBody`/`computeFocusForSystem`/`computeFocusForBelt`, `distanceToFit`) and the per-selection near-plane/min-distance floor (`nearPlaneForRadius`/`minCameraDistanceForRadius`) that lets the camera get arbitrarily close to something true-scale-tiny without a one-size-fits-all floor holding it at arm's length.
9. **The zoom slider's mapping** — `zoomSlider.ts` (`sliderPositionToDistance`/`distanceToSliderPosition`) is a small, isolated log-scale conversion, kept separate because getting the direction/curve wrong here is exactly the kind of thing worth unit-testing in isolation from the rest of the camera rig.

Steps 1–9 are all pure functions in `src/*.ts` — no React, no three.js scene graph, 100% unit-tested. Nothing here needs a real renderer to verify.

## The rendering layer (`src/react/`)

`OrbitalSystemScene` (in `OrbitalSystemScene.tsx`) is the public component — it owns top-level state (selection, camera focus, simulated date, the zoom slider's ref) and the toolbar UI, and composes everything else:

| File | Owns |
| --- | --- |
| `OrbitalSystemScene.tsx` | Top-level state, the toolbar/info-panel UI, `<Canvas>` setup, `TimeDriver` (advances `simDate`) |
| `SceneContent.tsx` | Per-frame composition: resolves every body's position, decides what's eligible via `visibility.ts`, renders bodies/orbits/belts/route preview |
| `CameraRig.tsx` | Owns `OrbitControls`, the fly-to animation, and live-tracking a moving selected body so the camera doesn't drift off it mid-flight |
| `ProximitySelector.tsx` | The R3F-side wiring for `proximitySelection.ts`/`labelDeclutter.ts` — one per-frame screen-space projection pass driving hover, label visibility, and body-dot visibility together |
| `BodyMarker.tsx` | One body's rendered group — shape + label + the grow/shrink fade animation when a body crosses in/out of the visible set |
| `BodyShapes.tsx` | The actual geometry per body type (`PlaceholderBodyShape`), the real-model/real-texture loading paths and their fallbacks, `AtmosphereRim` |
| `OrbitLines.tsx` | `OrbitPathLine` (real Kepler orbit), `ReferenceOrbitRing` (a `fixedPosition` body's flat reference circle), `RoutePreviewLine` |
| `BeltRendering.tsx` | Belt/ring glow disc and particle scatter |
| `theme.ts`, `bodyTypeStyles.ts`, `textures.ts` | Small, dependency-free constants and canvas-texture helpers shared across the above |

**A load-bearing detail**: every line-drawing component (`OrbitLines.tsx`) keeps its own vertex data *parent-relative* (small numbers) and applies the parent's own (potentially large) world offset via a wrapping `<group position={...}>`, never by baking that offset into the vertices themselves. Three.js composes `Object3D` transforms in double precision (regular JS numbers) all the way through matrix multiplication, converting to float32 only at the final GPU upload — baking a large absolute offset directly into a `Float32Array`-backed geometry instead wastes most of float32's ~7 significant digits on the shared offset, which showed up as visible jittering for a tight orbit (the ISS) around a body far from the origin (Earth's own compressed distance from the star is ~31 world units). If you add a new line/point-cloud component, follow the same pattern.

## Two-tier testing, deliberately

`src/*.ts` (steps 1–9 above) is 100% unit-tested — plain functions, no rendering, fast and precise. `src/react/*` cannot be meaningfully unit-tested the same way: Jest's jsdom environment has no real WebGL context, so nothing about actual rendering, camera behavior, or visual output can be verified there. Its correctness is instead covered by the Playwright e2e suite (`e2e/*.spec.ts`), which drives both example apps in a real browser — see `CONTRIBUTING.md`'s "End-to-end tests" section before adding a feature that touches rendering behavior.

## Reference data (`solarSystemData.ts`)

The one data file of meaningful size (~700 lines) — deliberately not code-golfed shorter, since every body's entry is meant to be independently checkable against its cited real source (NASA JPL, IAU, USGS). Size here reflects the size of the real solar system, not a code-organization problem.
