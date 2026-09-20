---
"orbital-engine": minor
---

Add `findBodiesInsideParent`, a pure utility that flags any body rendering inside its own immediate parent's sphere — a rendering-legibility signal (the body's real position/data may be entirely correct; a generic placeholder radius can just be too big for a real body's true scale), not a data-correctness check. Wired into `OrbitalSystemScene`'s `devMode` overlay as an "⚠ EMBEDDED" section listing every affected body.
