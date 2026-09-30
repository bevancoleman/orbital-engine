---
"orbital-engine": minor
---

Add planet ring systems as part of the body (`CelestialBody.rings`, drawn in the body's equatorial plane via the new `axialTiltDeg`), and belt shapes, gaps and in-belt sites (`BeltRegion.shape`/`gaps`/`sites`). Belt scatter is now seeded (stable across loads) and area-uniform, and the glow disc's clear centre is sized from compressed radii. Saturn's rings move from a belt onto Saturn itself, Jupiter, Uranus and Neptune gain their ring systems, and the asteroid belt gains its Kirkwood gaps. `validateSystemData` now also reports `invalid-ring` and `invalid-belt` warnings.

`SOLAR_SYSTEM` gains Enceladus, Tethys, Dione and Iapetus (Saturn), Miranda, Ariel, Umbriel and Oberon (Uranus), and the spacecraft-visited asteroids 433 Eros, 101955 Bennu and 486958 Arrokoth, with JPL orbital elements. The with-models example now ships spacecraft shape models for Halley, Vesta, Ceres, Eros, Bennu and Arrokoth, a true-colour Blue Marble Earth, an LRO Moon, and maps of Mercury and the new moons — each sourced and rebuildable (see `examples/with-models/ASSETS.md`).
