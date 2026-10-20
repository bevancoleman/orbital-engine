---
"orbital-engine": patch
---

Packaging fixes:

- `orbital-engine/react` no longer bundles its own copy of the core — both entry points share one chunk, so apps importing both ship it once. `"use client"` stays the first directive of the react entry (ESM and CJS).
- `exports` now resolve per condition: `require` gets `.d.cts` declarations, `import` gets `.d.ts`. Added `typesVersions` so `moduleResolution: "node"` finds `orbital-engine/react` types, and exposed `./package.json`.
- Peer dependency ranges are now bounded to what the code actually supports: `three >=0.152.0 <1.0.0` (was `>=0.150` — r150/r151 lack `Texture.colorSpace`, so textures got the wrong colour space), `@react-three/fiber ^8.13.0 || ^9.0.0` (was `>=8`), `@react-three/drei ^9.56.5 || ^10.0.0` (was `>=9` — `CameraControls` first shipped in 9.54, but only 9.56.5+ bundles camera-controls 2.x, whose `getPosition`/`getTarget(out, false)` and `smoothTime` the camera relies on), `react ^18.0.0 || ^19.0.0` (was `>=18`), and `react-dom ^18.0.0 || ^19.0.0` is now listed (drei's `Html` and fiber's `Canvas` already required it). Setups below the new minimums didn't actually work before; the new upper bounds mean a future fiber 10 / drei 11 / React 20 will report a peer conflict until it's verified.
- README: the "Build your own system" sample now typechecks (`fixedPosition: null` is required), and the data contract, peer requirements and `OrbitalSystemScene` description (it renders its own `<Canvas>`) are corrected.
