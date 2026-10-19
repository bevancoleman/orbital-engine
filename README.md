# orbital-engine

[![CI](https://github.com/bevancoleman/orbital-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/bevancoleman/orbital-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

An orbital mechanics rendering engine for [react-three-fiber](https://github.com/pmndrs/react-three-fiber), built around true physical scale. Bodies are sized and positioned at their actual real-world proportions, and a Kepler orbit or a single fixed position both render through the same component.

## Comparison

Almost every three.js solar system project on GitHub is a standalone demo: one hardcoded scene, no published package, and scale exaggerated because true scale makes most of a solar system invisible at any one zoom level.

[spacekit.js](https://github.com/typpo/spacekit) is the exception — a real library, combining Kepler orbits and fixed-position objects in one engine years before this one. It's vanilla three.js rather than a React component, defaults to artistic scale, and hasn't had a release in a while.

This library solves the same true-scale problem spacekit.js didn't attempt, and ships it as an R3F component with selection, labels, and camera handling included.

## Features

- **True physical scale.** Radius and orbital distance are both the real figures, log-compressed for distance and floored at a minimum pixel size for radius (`compressDistance`/`trueRadius`, `minVisibleWorldRadius`/`renderRadius`) — a body like the ISS stays visible next to Earth even though its actual size is a fraction of a pixel at that distance.
- **Two position models, one contract.** A body carries either [`OrbitalElements`](./src/types.ts) (animates over time via Kepler propagation) or a single [`FixedPosition`](./src/types.ts) snapshot (for data with no known orbit — a game world, a one-time survey). Both render through the same `<OrbitalSystemScene>`.
- **Proximity selection and label decluttering.** Clicking snaps to the nearest body within a screen-space radius rather than raycasting, which fails once a body's on-screen size drops below a pixel. Labels that would overlap hide the structurally deeper one (a moon yields to its planet, a planet to its star).
- **Rings and belts.** A planet's own rings are part of the planet — drawn in its equatorial plane (from its spin pole), moving and selected with it. Belts (round a star, or local clusters) are objects of their own: either plotted from real per-object positions or scattered synthetically within a radius range, with gaps, named sites inside them, and co-orbital clusters that track a reference body's current angle.
- **Camera fly-to.** Animates to a selected body along a smooth zoom-out, pan, zoom-in path, and keeps tracking it afterward if it's still moving.
- **Distance-adjusted level of detail.** Polygon count follows how much of the view a body actually fills, not raw camera distance.
- **Real 3D models and textures, opt-in per body.** `CelestialBody.modelUrl` loads a real glTF model; `textureUrl` wraps a real surface photo around the built-in sphere instead. Both fall back to the placeholder shape if unset or if loading fails. See [`examples/with-models`](./examples/with-models), built entirely from NASA's public-domain 3D Resources collection.
- **Optional real day/night shading.** `<OrbitalSystemScene lightFromStar>` lights the scene from the system's actual star position instead of a fixed direction — every other body gets a real lit/dark hemisphere split, correct for wherever it currently sits relative to the star. Off by default (a fixed light is simpler and works even for a system with no real star body).

## Install

```bash
npm install orbital-engine three @react-three/fiber @react-three/drei react react-dom
```

`three` (r152+), `@react-three/fiber` (8.13+ or 9), `@react-three/drei` (9.56.5+ or 10), `react` and `react-dom` (18 or 19) are peer dependencies — see `peerDependencies` in [`package.json`](./package.json) for the exact ranges. Pair fiber 8 / drei 9 with React 18, fiber 9 / drei 10 with React 19.

## Quickstart

```tsx
import { OrbitalSystemScene } from 'orbital-engine/react'
import { SOLAR_SYSTEM } from 'orbital-engine'

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <OrbitalSystemScene system={SOLAR_SYSTEM} />
    </div>
  )
}
```

`SOLAR_SYSTEM` is a reference dataset sourced from NASA JPL/IAU published elements (see [`src/solarSystemData.ts`](./src/solarSystemData.ts)), used to check the engine against real astronomy and to double as a working example.

[`examples/basic`](./examples/basic) is a runnable demo, including a fictional system built entirely from `fixedPosition` bodies. [`examples/with-models`](./examples/with-models) demonstrates `modelUrl`/`textureUrl` against real NASA assets, toggled against the plain placeholder shapes.

## Build your own system

`SOLAR_SYSTEM` is just data shaped like `StarSystemData` — nothing about `<OrbitalSystemScene>` requires it. This is the smallest system that actually works: one star, one real orbiting planet (Kepler elements), and one moon with only a single known position (no orbit data at all, so it stays put rather than animating on a fabricated one).

```tsx
import { OrbitalSystemScene } from 'orbital-engine/react'
import type { StarSystemData } from 'orbital-engine'

const MY_SYSTEM: StarSystemData = {
  id: 'my-system',
  name: 'My System',
  bodies: [
    {
      id: 'star',
      name: 'My Star',
      type: 'star',
      parentId: null,       // null only for the system's star
      radiusKm: 700_000,
      orbit: null,          // the star itself sets neither orbit nor fixedPosition
      fixedPosition: null,
      color: '#fde68a',
    },
    {
      id: 'planet-1',
      name: 'My Planet',
      type: 'planet',
      parentId: 'star',
      radiusKm: 6_371,
      orbit: {
        semiMajorAxisKm: 149_600_000,
        eccentricity: 0.02,
        inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 365,
        epoch: '2000-01-01T00:00:00Z',
      },
      fixedPosition: null,  // both keys are required — set the unused one to null
      color: '#3b82f6',
    },
    {
      id: 'moon-1',
      name: 'My Moon',
      type: 'moon',
      parentId: 'planet-1', // relative to its parent, not the star
      radiusKm: 1_737,
      orbit: null,
      fixedPosition: { xKm: 400_000, yKm: 0, zKm: 0 },
      color: '#94a3b8',
    },
  ],
}

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <OrbitalSystemScene system={MY_SYSTEM} />
    </div>
  )
}
```

Copy-paste runnable as-is — the moon renders as a static point next to the planet while the planet actually orbits the star over time. Swap `fixedPosition` for a real `orbit` (or vice versa) freely; both render through the exact same component and support selection, labels, and camera fly-to identically. See [`examples/basic/src/fictionalSystem.ts`](./examples/basic/src/fictionalSystem.ts) for a larger example using only `fixedPosition`, including a station and a jump point.

## Data contract

```ts
interface CelestialBody {
  id: string
  name: string
  type: BodyType
  parentId: string | null         // null only for the system's star
  radiusKm: number
  orbit: OrbitalElements | null          // Kepler elements — animates over time
  fixedPosition: FixedPosition | null    // or a single known snapshot — stays put
  coOrbitalWithParent?: boolean   // see below
  rotationPeriodHours?: number    // spin only, independent of orbital motion; negative = retrograde
  color?: string
  modelUrl?: string                // optional 3D model; falls back to a placeholder shape
  textureUrl?: string              // optional real surface texture on the placeholder sphere
  note?: string                    // free-text provenance/precision note
  wikiSummary?: string             // optional descriptive blurb shown in the info panel
  wikiUrl?: string                 // optional further-reading link shown with it
  beltId?: string                  // see below — links to a BeltRegion.id this body is a member of
  atmosphereHeightKm?: number      // draws a translucent atmosphere rim at this height
  pole?: PoleDirection             // spin axis — defines the equator rings are drawn in
  axialTiltDeg?: number            // obliquity — ring-plane fallback when `pole` is unset
  rings?: RingBand[]               // see below — the body's own ring system
}

interface StarSystemData {
  id: string
  name: string
  bodies: CelestialBody[]
  belts?: BeltRegion[]
}
```

Both keys are required. A body sets exactly one of `orbit` or `fixedPosition` and the other to `null` (the system's star sets both to `null`). Rendering, selection, camera framing, and label decluttering all work the same regardless of which one it has.

**`BodyType`**: `'star' | 'planet' | 'dwarf_planet' | 'moon' | 'station' | 'surface_installation' | 'jump_point' | 'nav_point' | 'asteroid' | 'comet'`. Each has its own placeholder shape/color and default rendering behavior — `jump_point` renders as a hole between systems rather than a structure, `nav_point` as a bare labelled point with no physical shape, `station` as a hab-torus, `surface_installation` as a small platform-and-beacon structure on its parent, and the rest as spheres/faceted rocks. See [`src/types.ts`](./src/types.ts) for the full reasoning behind each.

**`OrbitalElements`** — the 6 standard classical (Keplerian) elements any astronomy source (NASA JPL, IAU, Wikipedia infoboxes) publishes for a real orbit, relative to the parent and measured against the system's reference plane unless `referencePlanePole` says otherwise:

```ts
interface OrbitalElements {
  semiMajorAxisKm: number
  eccentricity: number                    // 0 = circular, →1 = highly elongated (e.g. a comet)
  inclinationDeg: number                  // >90° signals retrograde motion
  longitudeOfAscendingNodeDeg: number
  argumentOfPeriapsisDeg: number
  meanAnomalyAtEpochDeg: number           // position along the orbit at `epoch`, 0 = periapsis
  orbitalPeriodDays: number
  epoch: string                           // ISO 8601 date meanAnomalyAtEpochDeg is measured from
  referencePlanePole?: PoleDirection      // pole of the plane the angles are quoted against
}
```

`epoch` should carry a `Z` or an explicit offset (`2000-01-01T12:00:00Z`), or be a bare date (`2000-01-01`, UTC by ISO's definition). A date-time with no offset is read as UTC — not the viewer's local time, as `Date` would — and also flagged by `validateSystemData` (an `invalid-orbit` warning, `epoch-without-offset`).

**`PoleDirection`** — `{ longitudeDeg, latitudeDeg }`, a direction in the system's reference frame (for `SOLAR_SYSTEM`, the J2000 ecliptic). A body's `pole` is its spin axis (right-hand rule, so a retrograde rotator's is the opposite end from the IAU's "north" pole); it sets the plane its rings are drawn in and takes precedence over `axialTiltDeg`. An orbit's `referencePlanePole` is the pole of the plane its inclination/node/periapsis are quoted against — typically the parent's `pole`, for moon elements published against the planet's equator; a ringed planet's moons only line up with its rings when the two match. The IAU publishes poles as right ascension/declination; convert them with `poleFromEquatorialJ2000`:

```ts
import { poleFromEquatorialJ2000 } from 'orbital-engine'

const saturnPole = poleFromEquatorialJ2000(40.589, 83.537) // IAU RA/Dec, degrees
```

**`FixedPosition`** — a single km-space snapshot relative to the parent, for a body with no known orbit (game-extracted data, a one-time survey) rather than inventing elements to force it into the Keplerian shape:

```ts
interface FixedPosition {
  xKm: number
  yKm: number
  zKm: number
}
```

**`coOrbitalWithParent`**: true only for the rare case of a body grouped under a parent for labelling (e.g. a Lagrange-point station listed under its reference planet) that doesn't actually orbit that parent locally — it independently orbits the star at a different point along the parent's own orbit. Doesn't affect position math, only camera framing (so selecting the planet doesn't also try to fit an interplanetary-distance companion into view). Leave unset for every ordinary child (a real moon, a station that really does orbit its planet).

**`rings`**: a body's own ring system, as a list of bands — part of the body, not a separate object. Each `RingBand` has `innerRadiusKm`/`outerRadiusKm` (real km from the body's centre), an optional `name`, `color`, `opacity`, and a `style`: `'disc'` (the default — a smooth translucent band, for dust and ice rings like Saturn's) or `'particles'` (a scatter of individual rocks, for a ring of asteroids round a moon). Gaps between rings (Saturn's Cassini Division) are simply the space between bands. The rings lie in the body's equatorial plane (from `pole`, or `axialTiltDeg` if no pole is set), and scale with the body as it's rendered, so they stay in proportion even while the pixel floor inflates a small body. Camera framing takes in the whole ring system.

**`BeltRegion`** (asteroid belts, Oort-cloud-style clouds, local asteroid clusters) is a separate top-level array on `StarSystemData`, not a `CelestialBody` — a population in its own right, selectable as a belt. Its `shape` is `'ring'` (full circle between the two radii, drawn with a soft glow disc — the default for `type: 'belt'`), `'shell'` (all directions — the default for `type: 'cloud'`) or `'cluster'` (local patches only, drawn from real positions or sites, with no glow disc). Other fields: `innerRadiusKm`/`outerRadiusKm`, `inclinationSpreadDeg` (the full angular thickness, centred on the reference plane — the band spans ±half of it; 180 makes a `'shell'` a complete sphere), `particleCount`, optional real `realPositions`, `gaps` the scatter keeps clear of (the asteroid belt's Kirkwood gaps), `sites` (named sets of positions inside the belt, drawn as distinct markers — e.g. mining stations scattered through it), and `coOrbital` for Trojan-style leading/trailing clusters. The synthetic scatter is seeded from the belt's id, so it's identical on every load. See [`src/types.ts`](./src/types.ts).

**`beltId`**: links a body to a `BeltRegion.id` it's physically a member of — e.g. a named main-belt asteroid (Ceres, Vesta) that's also plotted as its own tracked body, on top of the belt's own scattered population. Purely a visibility-system hint (see `computeVisibleBodyIds`, below): every body sharing the same `beltId` shares a single secondary-object visibility slot instead of each competing individually, since the belt itself already reads as "there's a population here."

## Visibility

At any zoom, primary bodies (star, planet) always render. Everything else (moons, stations, asteroids, ...) is ranked by how much of the view it actually fills right now (`apparentSize` — the same metric the geometry-detail system uses) and capped at `MAX_VISIBLE_SECONDARY` (20 by default). Bodies sharing a `beltId` rank and reveal as one group rather than competing individually. On top of that, a per-frame screen-space pass (`thinByScreenProximity`, the same algorithm label decluttering uses) drops anything still landing too close to a higher-priority body actually on screen right now. The currently-selected body and its direct children are always exempt from both passes. A body's dot smoothly grows/shrinks in as it crosses the visible boundary rather than popping.

This replaces an earlier fixed distance-ratio cutoff that could hide a body entirely on a trivial zoom change regardless of how much empty screen space was actually available — see [`src/visibility.ts`](./src/visibility.ts).

## Validation

`validateSystemData(system)` returns every data-contract and legibility warning for a system as a `SystemDataWarning[]`, each tagged with a `kind`: `missing-position`, `unrecognized-type`, `unknown-parent`, `parent-cycle`, `invalid-orbit` (non-positive axis or period, eccentricity out of range, non-finite angle, unparseable or offset-less epoch), `invalid-radius`, `periapsis-inside-parent`, `embedded-in-parent`, `embedded-in-sibling`, `invalid-ring`, `invalid-belt`. Malformed data still renders — an unknown parent or a cycle anchors at the system origin — so these are signals, not errors. `<OrbitalSystemScene devMode>` lists them in its dev overlay. `unknown-parent`, `parent-cycle`, `invalid-orbit`, `invalid-radius` and `periapsis-inside-parent` were added in 1.5.0 — a consumer with an exhaustive `switch` over `kind` must add cases for them.

## Arrival framing

A fly-to a body arrives framing the body itself: its diameter fills about 40% of the view's height (`BODY_VIEW_FILL`), so its surface (and a real texture, if it has one) is actually visible, with a ring system kept in frame. Clicking the already-selected body again flies out to its whole local moon/station system, and clicking it once more flies back in. `arrivalFraming="system"` makes the moon-system view the one a selection arrives at instead:

```tsx
<OrbitalSystemScene system={SOLAR_SYSTEM} arrivalFraming="system" />
```

A satellite far smaller than the camera's precision floor (the ISS, Hubble) can't fill that much of the view; it arrives as close as the floor allows. When the body would hide its parent from the "look back toward the parent" angle a fly-to ends on (Earth behind the Moon), the view is turned just far enough to show the parent beside it. The root element's `data-framing` (`body` / `system`) says which framing the selected body is in.

## Fly-to pacing

Selecting a body flies the camera along van Wijk & Nuij's optimal zoom-and-pan path ("Smooth and efficient zooming and panning", 2003): it zooms out until the start and the destination are both comfortably in view, pans, then zooms in, eased in and out so it starts and ends at rest. A flight's duration is proportional to the length of that path — how much the view really changes — so a hop between neighbouring stations is quick and a dive from a planet to a station across the system takes longer, at the same perceived speed. `flightPacing` tunes it:

```tsx
<OrbitalSystemScene system={SOLAR_SYSTEM} flightPacing={{ speed: 1.5, minMs: 1000, maxMs: 3000 }} />
```

| Field | Default | Meaning |
| --- | --- | --- |
| `speed` | `1` | Multiplier on the default pace — `2` flies twice as fast, `0.5` half as fast. |
| `minMs` | `1200` | Shortest a flight may take. |
| `maxMs` | `4000` | Longest a flight may take. |

Every field is optional; an invalid value falls back to its default. The scene's root element exposes `data-camera-state` (`flying` / `tracking` / `idle`) if you need to wait for a flight to land.

## API

Types, math, and reference data are exported from the package root (`orbital-engine`) — see [`src/index.ts`](./src/index.ts) for the full list. The R3F component is a separate entry point, `orbital-engine/react` (see [`src/react/index.ts`](./src/react/index.ts)), because it needs a `'use client'` directive for Next.js/RSC bundlers and the plain-data exports don't.

| Export | Entry point | What it's for |
| --- | --- | --- |
| `OrbitalSystemScene` | `orbital-engine/react` | The whole scene, UI overlays included — it renders its own R3F `<Canvas>`, so place it in a sized container, not inside another `<Canvas>`. |
| `ExternalFocusRequest` | `orbital-engine/react` | Type for the `externalFocus` prop — flies the camera to a body id from outside the component (see [`examples/basic`](./examples/basic)'s "Fly to" buttons). |
| `RoutePreview` | `orbital-engine/react` | Type for the `routePreview` prop — draws a line through an ordered chain of body ids. |
| `FlightPacing` | `orbital-engine/react`, `orbital-engine` | Type for the `flightPacing` prop — see Fly-to pacing, above. |
| `BodyFraming` | `orbital-engine/react`, `orbital-engine` | Type for the `arrivalFraming` prop (`'body'` / `'system'`) — see Arrival framing, above. |
| `positionAtTime`, `orbitPath` | `orbital-engine` | Kepler propagation, given `OrbitalElements` and a `Date`. |
| `resolveAllWorldPositions` | `orbital-engine` | Every body's current world position (orbit or fixed), respecting parent hierarchy. |
| `poleFromEquatorialJ2000` | `orbital-engine` | IAU pole right ascension/declination → a `PoleDirection` in the J2000 ecliptic frame. |
| `validateSystemData` | `orbital-engine` | Every data warning for a system — see Validation, above. |
| `compressDistance`, `trueRadius` | `orbital-engine` | The scale math — km in, render-space units out. |
| `computeFocusForBody`, `computeFocusForSystem` | `orbital-engine` | Camera framing targets for a fly-to (`computeFocusForBody` takes a `BodyFraming`). |
| `distanceToFillView`, `BODY_VIEW_FILL`, `RING_VIEW_FILL` | `orbital-engine` | The camera distance at which a sphere fills a given share of the view, and the shares arrival framing uses. |
| `findNearestCandidate` | `orbital-engine` | Proximity selection, given screen-space candidates. |
| `computeVisibleLabels`, `computeOrbitalDepth`, `thinByScreenProximity` | `orbital-engine` | Label/body declutter, prioritized by structural depth. |
| `computeVisibleBodyIds`, `MAX_VISIBLE_SECONDARY` | `orbital-engine` | Which bodies render at all at the current zoom — see Visibility, above. |
| `SOLAR_SYSTEM` | `orbital-engine` | The reference dataset. |

Generated API reference, every export with parameters: **[bevancoleman.github.io/orbital-engine/docs](https://bevancoleman.github.io/orbital-engine/docs/)**. Live example: [bevancoleman.github.io/orbital-engine](https://bevancoleman.github.io/orbital-engine/).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how these pieces fit together — the pipeline from a body's data to what's actually rendered, and how the `src/react/` rendering layer is organized.

## Development

```bash
npm install
npm test        # the unit suite, including the reference data checked against ephemeris positions
npm run test:coverage  # same, with the coverage gate CI enforces on the core (src/*.ts)
npm run typecheck
npm run lint
npm run build    # tsup — emits ESM + CJS + .d.ts to dist/
npm run docs     # typedoc — generates the API reference site into docs-site/
```

End-to-end tests exercise both example apps against a real browser (real 3D model/texture loading, mode switching, camera controls, and the ErrorBoundary fallback when an asset fails to load):

```bash
npm run build
npm ci --prefix examples/basic
npm ci --prefix examples/with-models
npx playwright install chromium
npx playwright test
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports and feature requests: [open an issue](https://github.com/bevancoleman/orbital-engine/issues). This project follows a [Code of Conduct](./CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](./SECURITY.md), please don't open a public issue for those.

## License

MIT © Bevan Coleman
