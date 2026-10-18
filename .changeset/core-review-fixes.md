---
"orbital-engine": minor
---

Core math and data fixes from review:

- **Kepler solver** no longer silently diverges on very eccentric orbits (e ≳ 0.98): seeded at π above e = 0.8 and safeguarded with bisection. `solveEccentricAnomaly` is now exported.
- **Rings and moons share one equator.** New optional `CelestialBody.pole` (spin axis) and `OrbitalElements.referencePlanePole` (the plane an orbit's elements are quoted against), plus `poleFromEquatorialJ2000`, `bodyPoleVector`, `orbitNormal`, `planeBasis`, `equatorialNodeOffsetDeg` and `ringPlaneQuaternion`. Rings are now drawn with `ringPlaneQuaternion`, fixing a sign error that put a moon at the planet's own tilt twice that tilt off the ring plane. `ringTiltRadians` is deprecated.
- **Solar System data:** moons use JPL's satellite mean elements in their real Laplace/equatorial planes and ringed planets carry IAU spin poles — Saturn's moons now sit in its ring plane, Uranus's moons are coplanar and prograde, Triton is retrograde ~23° off Neptune's equator, Charon orbits in Pluto's equator, and the ISS/Hubble inclinations are to Earth's equator. Halley's and the rounded asteroid periods now follow from their semi-major axes. The Oort cloud is a full spherical shell.
- **Validation:** `validateSystemData` adds `unknown-parent`, `parent-cycle`, `invalid-orbit` (including epochs with no time zone), `invalid-radius` and `periapsis-inside-parent` warnings, and `missing-position` now catches omitted keys from plain JSON. Rings on a zero-radius body are flagged instead of drawing at Infinity.
- **Robustness:** position resolution no longer overflows the stack on a parent cycle; an offset-less epoch date-time is read as UTC instead of local time; `orbitPath` clamps bad segment counts; level-of-detail pickers fall back to the lowest level for NaN/negative sizes; `clampPlaybackSpeed(NaN)` returns the default speed.
- **Belts:** `inclinationSpreadDeg` is documented as the full thickness (±half); shells now sample uniformly by volume and solid angle.
- **Performance:** cached id index for parent lookups, cached epoch parsing and orbit orientation, a shared arc-length table for `orbitPath`, a spatial grid for `thinByScreenProximity`, and `coOrbitalReferenceAngle` accepts precomputed positions.
- **Types:** `BODY_TYPES` runtime array (`BodyType` is derived from it), `PoleDirection`, `Vec3Km` moved to the data contract; belt site/real positions use `FixedPosition`.
