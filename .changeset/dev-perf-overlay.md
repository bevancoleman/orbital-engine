---
"orbital-engine": minor
---

Add an opt-in `devMode` prop to `OrbitalSystemScene` that renders a dev-only performance overlay: FPS/frame time, draw calls, triangle/point/line counts, compiled shader program count, GPU-resident geometry/texture counts, JS heap usage where the browser exposes it, and object counts (total vs. currently-visible/culled bodies, shown labels, belt points, and the selected/hovered body's current LOD tier).
