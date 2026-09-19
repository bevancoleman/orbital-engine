# orbital-engine

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

## Data contract

```ts
interface CelestialBody {
  id: string
  name: string
  type: BodyType // 'star' | 'planet' | 'moon' | 'station' | 'jump_point' | ...
  parentId: string | null
  radiusKm: number
  orbit: OrbitalElements | null   // Kepler elements — animates over time
  fixedPosition?: FixedPosition   // or a single known snapshot — stays put
  color?: string
  modelUrl?: string                // optional 3D model; falls back to a placeholder shape
  textureUrl?: string              // optional real surface texture on the placeholder sphere
}

interface StarSystemData {
  id: string
  name: string
  bodies: CelestialBody[]
  belts?: BeltRegion[]
}
```

A body sets exactly one of `orbit` or `fixedPosition` (the system's star sets neither). Rendering, selection, camera framing, and label decluttering all work the same regardless of which one it has.

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
| `computeVisibleLabels`, `computeOrbitalDepth` | `orbital-engine` | Label decluttering, prioritized by structural depth. |
| `SOLAR_SYSTEM` | `orbital-engine` | The reference dataset. |

Generated API reference, every export with parameters: **[bevancoleman.github.io/orbital-engine/docs](https://bevancoleman.github.io/orbital-engine/docs/)**. Live example: [bevancoleman.github.io/orbital-engine](https://bevancoleman.github.io/orbital-engine/).

## Development

```bash
npm install
npm test        # 218 tests, including the reference data checked against ephemeris positions
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

## License

MIT © Bevan Coleman
