/**
 * Data contract for the orbital rendering engine.
 *
 * This is deliberately generic astronomy, not data from any particular game
 * or fictional setting — the whole point of this module is to validate the
 * engine (and this contract) against real, independently-verifiable
 * reference bodies (our actual Solar System) before any fictional or
 * game-sourced data gets mapped into it. See solarSystemData.ts.
 *
 * Orbital elements are the standard 6 classical (Keplerian) elements used
 * throughout astronomy/aerospace — any source that publishes a body's orbit
 * (NASA JPL, IAU, Wikipedia infoboxes, etc.) publishes these same 6 numbers,
 * which is exactly what makes this contract checkable against reference
 * material rather than invented to fit whatever data happens to be handy.
 */

export type BodyType =
  | 'star'
  | 'planet'
  | 'dwarf_planet'
  | 'moon'
  | 'station'
  /** A travel gateway between systems — e.g. a wormhole or a game's fast-
   *  travel jump point. Rendered distinctly from an ordinary station: it's
   *  a hole between systems, not a structure. */
  | 'jump_point'
  /** A named navigation marker with no physical structure of its own —
   *  visually the least substantial type, since it isn't a "thing" at all,
   *  just a labelled point in space. */
  | 'nav_point'
  | 'asteroid'
  | 'comet'

/**
 * Classical orbital elements, all relative to the parent body's own
 * reference plane (for a planet, the ecliptic; for a moon, conventionally
 * its planet's equatorial or Laplace plane — kept simple here as "whatever
 * plane the source publishes the inclination against", which is the same
 * simplification every casual orbital diagram makes).
 */
export interface OrbitalElements {
  /** Semi-major axis, km */
  semiMajorAxisKm: number
  /** 0 = circular, approaching 1 = highly elongated ellipse (e.g. a comet) */
  eccentricity: number
  /** Tilt of the orbital plane, degrees. >90° signals retrograde motion
   *  (e.g. Triton) — direction is derived from this, not a separate flag. */
  inclinationDeg: number
  /** Rotation of the orbit's ellipse around the parent's polar axis, degrees */
  longitudeOfAscendingNodeDeg: number
  /** Rotation of the ellipse within its own plane, degrees */
  argumentOfPeriapsisDeg: number
  /** Position along the orbit at `epoch`, degrees (0 = periapsis) */
  meanAnomalyAtEpochDeg: number
  /** Orbital period, days */
  orbitalPeriodDays: number
  /** ISO date meanAnomalyAtEpochDeg is measured from */
  epoch: string
}

/**
 * A position snapshot, relative to the parent, that does NOT animate with
 * time — the whole point of the 6 classical elements is that they let
 * position be *computed* at any date, which needs either a real ephemeris
 * or enough independent observations to fit an orbit. A data source that
 * only publishes one x/y/z per body, not a time series, can't support
 * that. Rather than inventing fictitious elements to force a body into the
 * Keplerian shape, a fixed body just stays where it was captured. See
 * CelestialBody.orbit/fixedPosition.
 */
export interface FixedPosition {
  xKm: number
  yKm: number
  zKm: number
}

export interface CelestialBody {
  id: string
  name: string
  type: BodyType
  /** id of the body this orbits; null only for the system's star */
  parentId: string | null
  /** Physical radius, km — rendering scale only, no bearing on orbital math */
  radiusKm: number
  /**
   * Exactly one of these is set for a non-star body (neither for the star
   * itself): `orbit` when real Keplerian elements are known (the Solar
   * System validation set — see solarSystemData.ts) and the body should
   * actually move over time; `fixedPosition` when only a single real
   * position snapshot is known (e.g. data extracted from a game's files, or
   * any other source that gives a single point-in-time position rather than
   * orbital elements) and the body should stay put rather than animate on a
   * fabricated orbit.
   *
   * Both keys are REQUIRED (not optional) specifically so a caller must
   * write an explicit `null` for whichever one doesn't apply, rather than
   * omitting it — omitting `fixedPosition` used to type-check even though
   * it meant something real (render.ts's own resolveWorldPosition silently
   * places a body with neither set at the system's origin, [0,0,0], with
   * no error or warning). That silent default is exactly the class of bug
   * validateSystemData (dataContractWarnings.ts) now catches at runtime —
   * this required-but-nullable shape is the equivalent guard at the type
   * level, for a TypeScript caller.
   */
  orbit: OrbitalElements | null
  fixedPosition: FixedPosition | null
  /**
   * True when `parentId` is a labelling/grouping convenience only — this
   * body doesn't actually orbit that body locally, it shares that body's
   * OWN orbit around the star at a different point along it. The concrete
   * real case this exists for: a Lagrange-point station (e.g. a station at
   * a planet's L4/L5 point) is grouped under its reference planet for
   * labelling/routing, exactly like a real orbiting station would be, but
   * it genuinely orbits the star independently, 60°/180° around from the
   * planet — real millions-of-km away from it, not a nearby local
   * satellite. Left unset (false) for every ordinary
   * child (a real moon, a station that really does orbit its planet).
   * Doesn't affect position math (fixedPosition/orbit already carry the
   * body's real position regardless) — only camera framing (see
   * computeFocusForBody in camera.ts), which needs to know "actually
   * nearby" from "grouped under, but not nearby" to frame a selected
   * planet without also trying to fit its interplanetary-distance
   * co-orbital companions into view.
   */
  coOrbitalWithParent?: boolean
  /**
   * Rotation period on the body's own axis, hours — negative for retrograde
   * spin (e.g. Venus). Separate from orbital motion entirely: even a
   * `fixedPosition` body (no orbital motion, because we only have one
   * position snapshot for it) can still spin in place — this is what
   * produces a day/night cycle for a fictional or game-sourced body despite
   * it not actually orbiting in this engine. Optional; not yet used by the
   * Solar System validation set.
   */
  rotationPeriodHours?: number
  /** Real, documented average colour, when one is actually known (e.g. the
   *  Solar System's planets/major moons) — used as-is instead of the
   *  generic per-type placeholder colour (see BODY_TYPE_COLOR_FALLBACK in
   *  OrbitalSystemScene.tsx). Left unset for anything with no real colour
   *  data (e.g. fictional or game-sourced bodies with no published
   *  colour source). */
  color?: string
  /**
   * An optional real 3D model to render instead of this engine's generic
   * per-type placeholder shape (see BodyShape in OrbitalSystemScene.tsx) —
   * e.g. a real ISS model for Earth's ISS entry, instead of the generic
   * station torus. A path to a .glb/.gltf file served from this app's own
   * public/ directory (or any same-origin/CORS-enabled URL); unset for
   * every body by default, so the placeholder shapes remain the norm, not
   * the exception, until a real model is actually supplied for a specific
   * body. Falls back to the placeholder shape if the model fails to load.
   */
  modelUrl?: string
  /**
   * An optional real surface texture (an equirectangular JPG/PNG) to wrap
   * around this engine's placeholder sphere, for a 'planet' | 'dwarf_planet'
   * | 'moon' body with no full 3D model available — real imagery instead
   * of a flat colour, without claiming actual surface geometry the way
   * `modelUrl` does. Ignored for every other body type, and ignored
   * whenever `modelUrl` is also set (a full model always wins). Falls back
   * to the flat-colour placeholder if the texture fails to load.
   */
  textureUrl?: string
  /** Free-text provenance note — where this body's numbers came from and
   *  how precise they're meant to be (mean orbital elements are inherently
   *  approximate/epoch-dependent; this keeps that honest in the data itself
   *  rather than presenting it as more precise than it is). */
  note?: string
  /**
   * id of a BeltRegion (see StarSystemData.belts) this body is physically a
   * member of — e.g. a named main-belt asteroid (Ceres, Vesta) that's ALSO
   * plotted as its own tracked body, on top of the belt's own scattered
   * population. Purely a visibility-system hint (see computeVisibleBodyIds
   * in visibility.ts): a belt-linked body doesn't compete individually for
   * a secondary-object slot against unrelated bodies elsewhere in the
   * system — every body sharing the same beltId shares one slot instead,
   * since the belt itself already reads as "there's a population here."
   * Doesn't affect position math or the belt's own particle-cloud
   * rendering at all, only this ranking. Unset for anything not
   * belt-associated.
   */
  beltId?: string
  /**
   * Real height (km) of this body's visible atmosphere above its surface —
   * e.g. Earth's ~100km (the Kármán line, the conventional "edge of
   * space"), Venus's ~250km (thick, hazy cloud tops visible from space).
   * Drives the translucent atmosphere rim's real size relative to the
   * body's own radius (see BodyShape/PlaceholderBodyShape in
   * OrbitalSystemScene.tsx) rather than an arbitrary fixed ratio applied to
   * every planet regardless of whether it actually has an atmosphere.
   * Unset (no rim rendered) for anything with no real, substantial
   * atmosphere — Mercury, the Moon, and the dwarf planets in this
   * dataset all genuinely have none/negligible. Deliberately not set for
   * the gas/ice giants either: they have no real surface/atmosphere
   * boundary to draw a rim around at all, so one wouldn't represent
   * anything real about them.
   */
  atmosphereHeightKm?: number
}

/**
 * A belt or cloud isn't a single orbiting body — it's a population spread
 * across a radius range (asteroid belt, Kuiper belt) or a very wide
 * inclination spread (Oort cloud), or a physically thin ring around a
 * planet (Saturn's rings — same shape, different parent/scale). Rendered as
 * a scattered point cloud rather than a discrete tracked position.
 */
export interface BeltRegion {
  id: string
  name: string
  type: 'belt' | 'cloud'
  /** id of the body this surrounds — usually the star, but a ring system
   *  (e.g. Saturn's) surrounds a planet instead. */
  parentId: string
  innerRadiusKm: number
  outerRadiusKm: number
  /** Degrees — how far particles scatter above/below the reference plane.
   *  A few degrees for a planetary ring, tens of degrees for the asteroid
   *  belt, effectively all directions (~90°+) for a cloud like Oort's. */
  inclinationSpreadDeg: number
  /** How many particles to render. When `realPositions` is set, this is
   *  just its length (the real count); otherwise it's a rendering/
   *  legibility choice, not a real population count (a real belt like the
   *  asteroid belt holds millions+ of objects, far more than would ever be
   *  rendered as individual points). */
  particleCount: number
  /**
   * Real individual positions (km, relative to `parentId`), when they're
   * actually known — e.g. a game's asteroid fields, where the source data
   * enumerates every real rock's exact position, unlike the Solar
   * System's asteroid belt (millions of real objects, none individually
   * catalogued here). When set, rendering uses these exact points instead
   * of statistically scattering `particleCount` points across
   * [innerRadiusKm, outerRadiusKm] — real data over an invented
   * distribution, whenever real data actually exists.
   */
  realPositions?: { xKm: number; yKm: number; zKm: number }[]
  /**
   * When set, this population isn't spread uniformly around the full
   * circle — it clusters in a libration zone leading or trailing a specific
   * body's current orbital position by a fixed angle, and rotates together
   * with that body over time. This is the real shape of Jupiter's Trojan
   * asteroids: gravitationally locked to Jupiter's L4/L5 points (60° ahead
   * of and behind it), not spread around the Sun the way the main asteroid
   * belt is — a genuinely different population shape, not a rendering
   * variation of the same one.
   */
  coOrbital?: {
    /** The body this population leads/trails — its current position
     *  (around `parentId`) sets the cluster's centre angle each moment. */
    bodyId: string
    /** +60° = L4 (leading), -60° = L5 (trailing) */
    leadAngleDeg: number
    /** Degrees — how wide the population spreads around that leading/
     *  trailing point (real libration zones are a complex "tadpole" shape;
     *  a simple angular band is a legibility simplification, same spirit
     *  as the radius-range/inclination-spread simplification everywhere
     *  else in this type). */
    angularSpreadDeg: number
  }
  color?: string
  note?: string
}

export interface StarSystemData {
  id: string
  name: string
  bodies: CelestialBody[]
  belts?: BeltRegion[]
}
