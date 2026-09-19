# orbital-engine

A true-scale orbital mechanics rendering engine for [react-three-fiber](https://github.com/pmndrs/react-three-fiber). Real Keplerian orbits and single-snapshot "fixed position" data share one component and one data contract, so a real solar system and a fictional universe can be rendered by the same code.

## Why this exists

Most three.js solar system projects on GitHub are one-off demos: a hardcoded scene, artistic/exaggerated scale (because true scale makes almost everything invisible), and no importable API. The one real prior art in this space, [spacekit.js](https://github.com/typpo/spacekit), proved that combining real orbital data with fixed-position objects in one engine is worth doing — but it's vanilla three.js (no React/R3F component model), defaults to artistic scale, and has been dormant for years.

`orbital-engine` is narrower and more specific: it's the true-to-scale problem, solved, as a reusable R3F component, plus the UX layer (selection, labels, camera) that turns real orbital math into something a person can actually click around in.

## What it does

- **True physical scale** — real radius *and* real orbital distance, not artistic exaggeration. A pixel-floor system (`minVisibleWorldRadius`/`renderRadius`) keeps a true-to-scale tiny body (the ISS next to Earth, say) visible as a point even when its actual projected size is sub-pixel.
- **One data contract, two position models** — a body either has real Keplerian [`OrbitalElements`](./src/types.ts) (and actually animates over time) or a single-snapshot [`FixedPosition`](./src/types.ts) (for a dataset where only one real position is known — a game world, a satellite catalog at epoch, anything that isn't the validated Solar System). Both render in the same `<OrbitalSystemScene>`.
- **Bubble-cursor selection + label decluttering** — the pointer snaps to the nearest visible body within a screen-space radius (not a raycast hit-test, which fails for anything sub-pixel), and labels avoid overlapping by yielding to whichever body is structurally shallower (star > planet > moon).
- **Belts and rings** — either real per-object positions (an asteroid field where every rock's position is known) or synthetic scattered particles within a radius range, including co-orbital populations (Trojan-style clusters that track a reference body's current position).
- **Camera fly-to with live tracking** — flies to a selection with an eased animation, then keeps tracking it if it's still moving (a real orbital body doesn't stop moving just because the camera arrived).
- **Level of detail tied to apparent size** — polygon budgets scale with how much of the view a body actually fills, not just raw camera distance.

## Install

```bash
npm install orbital-engine three @react-three/fiber @react-three/drei react react-dom
```

`three`, `@react-three/fiber`, `@react-three/drei`, `react`, and `react-dom` are peer dependencies — bring your own versions.

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

`SOLAR_SYSTEM` is a real, NASA/JPL-sourced reference dataset (see [`src/solarSystemData.ts`](./src/solarSystemData.ts)) — it exists primarily to validate the engine against real astronomy, and doubles as a working example.

See [`examples/`](./examples) for a runnable demo, including a fictional (non-Solar-System) dataset using `fixedPosition` bodies.

## Data contract

```ts
interface CelestialBody {
  id: string
  name: string
  type: BodyType // 'star' | 'planet' | 'moon' | 'station' | 'jump_point' | ...
  parentId: string | null
  radiusKm: number
  orbit: OrbitalElements | null   // real Kepler elements — animates over time
  fixedPosition?: FixedPosition   // OR a single known snapshot — stays put
  color?: string
  modelUrl?: string               // optional real 3D model; falls back to a placeholder shape
}

interface StarSystemData {
  id: string
  name: string
  bodies: CelestialBody[]
  belts?: BeltRegion[]
}
```

A body has *exactly one* of `orbit` or `fixedPosition` (neither, for the system's star). Everything else — rendering, selection, camera framing, label decluttering — works identically regardless of which one a body has.

## API

The engine — types, math, and reference data — is exported from the package root (`orbital-engine`); see [`src/index.ts`](./src/index.ts) for the exact list. The R3F component is a separate entry point, `orbital-engine/react` (see [`src/react/index.ts`](./src/react/index.ts)) — it carries a `'use client'` directive for Next.js/RSC-aware bundlers, so it's kept out of the main entry to avoid pulling a client boundary into server-safe code. The main pieces:

| Export | Entry point | What it's for |
| --- | --- | --- |
| `OrbitalSystemScene` | `orbital-engine/react` | The R3F component — drop it in a `<Canvas>`-capable tree. |
| `ExternalFocusRequest` | `orbital-engine/react` | The type for `<OrbitalSystemScene>`'s `externalFocus` prop — flies the camera to a body id from outside the component (see [`examples/basic`](./examples/basic)'s "Fly to" buttons). |
| `RoutePreview` | `orbital-engine/react` | The type for the `routePreview` prop — draws a line through an ordered chain of body ids, e.g. a planned route. |
| `positionAtTime`, `orbitPath` | `orbital-engine` | Real Keplerian propagation, given `OrbitalElements` and a `Date`. |
| `resolveAllWorldPositions` | `orbital-engine` | Resolves every body's current world position (orbit or fixed), respecting parent hierarchy. |
| `compressDistance`, `trueRadius` | `orbital-engine` | The true-scale compression math — real km in, render-space units out. |
| `computeFocusForBody`, `computeFocusForSystem` | `orbital-engine` | Camera framing targets for a fly-to. |
| `findNearestCandidate` | `orbital-engine` | Bubble-cursor proximity selection, given screen-space candidates. |
| `computeVisibleLabels`, `computeOrbitalDepth` | `orbital-engine` | Label decluttering, prioritized by structural depth. |
| `SOLAR_SYSTEM` | `orbital-engine` | The real reference dataset. |

Full generated API reference (every export, with parameters and the same doc comments as the source): **[bevancoleman.github.io/orbital-engine/docs](https://bevancoleman.github.io/orbital-engine/docs/)**. The live example itself is at [bevancoleman.github.io/orbital-engine](https://bevancoleman.github.io/orbital-engine/).

## Development

```bash
npm install
npm test        # 218 tests — the Solar System reference data is checked against real ephemeris positions
npm run typecheck
npm run build    # tsup — emits ESM + CJS + .d.ts to dist/
npm run docs     # typedoc — generates the API reference site into docs-site/
```

## License

MIT © Bevan Coleman
