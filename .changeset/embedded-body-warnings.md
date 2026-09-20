---
"orbital-engine": major
---

**Breaking:** `CelestialBody.fixedPosition` is now required (but nullable — `FixedPosition | null`), matching `orbit`'s own already-required-but-nullable shape. A TypeScript caller constructing a `CelestialBody` must now write an explicit `fixedPosition: null` for a body with none, rather than omitting the key — omitting it used to type-check even though `orbit: null` + no `fixedPosition` silently placed the body at the system's origin with no error. Update any `CelestialBody` object literals you construct directly (JSON/plain-JS data is unaffected — this is a type-level change only, runtime behavior for existing data is unchanged).

Also adds `validateSystemData(system)`, a combined data-contract/rendering-legibility check a host app (or its own tests) can run against a loaded system, covering:
- `missing-position` — a body with `orbit: null` and `fixedPosition: null` (would silently render at the origin).
- `unrecognized-type` — a `type` value that isn't a real `BodyType`, reachable from plain-JS/JSON data even though the TS type is a closed union.
- `embedded-in-parent` — a body rendering inside its own immediate parent's sphere (`findBodiesInsideParent`, exported individually too).
- `embedded-in-sibling` — two bodies sharing a parent that render inside each other's spheres (`findBodiesInsideSiblings`, exported individually too; scoped to each parent's own children, not a full system-wide O(n²) scan).

None of these are data-correctness checks against upstream source data (that's a data pipeline's own job) — they're signals that a body's data, while possibly entirely correct, either relies on an implicit default or will render occluded/overlapping. Wired into `OrbitalSystemScene`'s `devMode` overlay as a combined "⚠ DATA WARNINGS" section.

**New `BodyType`: `'surface_installation'`** — a structure genuinely built on a parent body's own surface (a landing-zone city, a ground-based prison, a mining outpost), as opposed to `'station'`, which orbits or floats free. Rendered as a small platform+beacon marker instead of a floating torus, so it doesn't visually read as an orbiting structure it isn't. `findBodiesInsideParent`/`findBodiesInsideSiblings` both exempt it: sitting at/near its own parent's real surface (or close to another installation at the same real site) is the *definition* of correct for this type, not a containment problem.
