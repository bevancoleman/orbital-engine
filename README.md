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
- **Belts and rings.** Either plotted from real per-object positions (a field where every object's position is known) or scattered synthetically within a radius range, including co-orbital clusters that track a reference body's current angle.
- **Camera fly-to.** Animates to a selected body and keeps tracking it afterward if it's still moving.
- **Distance-adjusted level of detail.** Polygon count follows how much of the view a body actually fills, not raw camera distance.
- **Real 3D models and textures, opt-in per body.** `CelestialBody.modelUrl` loads a real glTF model; `textureUrl` wraps a real surface photo around the built-in sphere instead. Both fall back to the placeholder shape if unset or if loading fails. See [`examples/with-models`](./examples/with-models), built entirely from NASA's public-domain 3D Resources collection.
- **Optional real day/night shading.** `<OrbitalSystemScene lightFromStar>` lights the scene from the system's actual star position instead of a fixed direction — every other body gets a real lit/dark hemisphere split, correct for wherever it currently sits relative to the star. Off by default (a fixed light is simpler and works even for a system with no real star body).

## Install

```bash
npm install orbital-engine three @react-three/fiber @react-three/drei react react-dom
```

`three`, `@react-three/fiber`, `@react-three/drei`, `react`, and `react-dom` are peer dependencies.

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
  orbit: OrbitalElements | null   // Kepler elements — animates over time
  fixedPosition?: FixedPosition   // or a single known snapshot — stays put
  coOrbitalWithParent?: boolean   // see below
  rotationPeriodHours?: number    // spin only, independent of orbital motion; negative = retrograde
  color?: string
  modelUrl?: string                // optional 3D model; falls back to a placeholder shape
  textureUrl?: string              // optional real surface texture on the placeholder sphere
  note?: string                    // free-text provenance/precision note
  beltId?: string                  // see below — links to a BeltRegion.id this body is a member of
}

interface StarSystemData {
  id: string
  name: string
  bodies: CelestialBody[]
  belts?: BeltRegion[]
}
```

A body sets exactly one of `orbit` or `fixedPosition` (the system's star sets neither). Rendering, selection, camera framing, and label decluttering all work the same regardless of which one it has.

**`BodyType`**: `'star' | 'planet' | 'dwarf_planet' | 'moon' | 'station' | 'jump_point' | 'nav_point' | 'asteroid' | 'comet'`. Each has its own placeholder shape/color and default rendering behavior — `jump_point` renders as a hole between systems rather than a structure, `nav_point` as a bare labelled point with no physical shape, `station` as a hab-torus, and the rest as spheres/facted rocks. See [`src/types.ts`](./src/types.ts) for the full reasoning behind each.

**`OrbitalElements`** — the 6 standard classical (Keplerian) elements any astronomy source (NASA JPL, IAU, Wikipedia infoboxes) publishes for a real orbit, all relative to the parent's own reference plane:

```ts
interface OrbitalElements {
  semiMajorAxisKm: number
  eccentricity: number                    // 0 = circular, →1 = highly elongated (e.g. a comet)
  inclinationDeg: number                  // >90° signals retrograde motion
  longitudeOfAscendingNodeDeg: number
  argumentOfPeriapsisDeg: number
  meanAnomalyAtEpochDeg: number           // position along the orbit at `epoch`, 0 = periapsis
  orbitalPeriodDays: number
  epoch: string                           // ISO date meanAnomalyAtEpochDeg is measured from
}
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

**`BeltRegion`** (asteroid belts, rings, Oort-cloud-style clouds) is a separate top-level array on `StarSystemData`, not a `CelestialBody` — see [`src/types.ts`](./src/types.ts) for its fields (`innerRadiusKm`/`outerRadiusKm`, `particleCount`, optional real `realPositions`, and `coOrbital` for Trojan-style leading/trailing clusters).

**`beltId`**: links a body to a `BeltRegion.id` it's physically a member of — e.g. a named main-belt asteroid (Ceres, Vesta) that's also plotted as its own tracked body, on top of the belt's own scattered population. Purely a visibility-system hint (see `computeVisibleBodyIds`, below): every body sharing the same `beltId` shares a single secondary-object visibility slot instead of each competing individually, since the belt itself already reads as "there's a population here."

## Visibility

At any zoom, primary bodies (star, planet) always render. Everything else (moons, stations, asteroids, ...) is ranked by how much of the view it actually fills right now (`apparentSize` — the same metric the geometry-detail system uses) and capped at `MAX_VISIBLE_SECONDARY` (20 by default). Bodies sharing a `beltId` rank and reveal as one group rather than competing individually. On top of that, a per-frame screen-space pass (`thinByScreenProximity`, the same algorithm label decluttering uses) drops anything still landing too close to a higher-priority body actually on screen right now. The currently-selected body and its direct children are always exempt from both passes. A body's dot smoothly grows/shrinks in as it crosses the visible boundary rather than popping.

This replaces an earlier fixed distance-ratio cutoff that could hide a body entirely on a trivial zoom change regardless of how much empty screen space was actually available — see [`src/visibility.ts`](./src/visibility.ts).

## API

Types, math, and reference data are exported from the package root (`orbital-engine`) — see [`src/index.ts`](./src/index.ts) for the full list. The R3F component is a separate entry point, `orbital-engine/react` (see [`src/react/index.ts`](./src/react/index.ts)), because it needs a `'use client'` directive for Next.js/RSC bundlers and the plain-data exports don't.

| Export | Entry point | What it's for |
| --- | --- | --- |
| `OrbitalSystemScene` | `orbital-engine/react` | The R3F component — drop it in a `<Canvas>`-capable tree. |
| `ExternalFocusRequest` | `orbital-engine/react` | Type for the `externalFocus` prop — flies the camera to a body id from outside the component (see [`examples/basic`](./examples/basic)'s "Fly to" buttons). |
| `RoutePreview` | `orbital-engine/react` | Type for the `routePreview` prop — draws a line through an ordered chain of body ids. |
| `positionAtTime`, `orbitPath` | `orbital-engine` | Kepler propagation, given `OrbitalElements` and a `Date`. |
| `resolveAllWorldPositions` | `orbital-engine` | Every body's current world position (orbit or fixed), respecting parent hierarchy. |
| `compressDistance`, `trueRadius` | `orbital-engine` | The scale math — km in, render-space units out. |
| `computeFocusForBody`, `computeFocusForSystem` | `orbital-engine` | Camera framing targets for a fly-to. |
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
npm run typecheck
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
