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

/**
 * Every real BodyType value, as a runtime array — the single source of
 * truth `BodyType` itself is derived from, so the runtime check in
 * dataContractWarnings.ts (findBodiesWithUnrecognizedType) can't drift out
 * of step with the type the way a hand-copied list could. What each value
 * means is documented on `BodyType` below.
 */
export const BODY_TYPES = [
  'star',
  'planet',
  'dwarf_planet',
  'moon',
  'station',
  'surface_installation',
  'jump_point',
  'nav_point',
  'asteroid',
  'comet',
] as const

/**
 * What kind of thing a body is. Most values are self-explanatory; the
 * three that aren't:
 *
 * - `'surface_installation'`: a structure genuinely built on a parent
 *   body's own surface (a landing-zone city, a ground-based prison, a
 *   mining outpost) — as opposed to `'station'`, which orbits or floats
 *   free. This matters for more than labelling: sitting at/near the
 *   parent's own real radius is the DEFINITION of correct for this type,
 *   not a containment problem — findBodiesInsideParent/
 *   findBodiesInsideSiblings both exclude it for exactly that reason (see
 *   their own comments). Rendered as a small surface marker, not a
 *   floating torus, so it doesn't visually read as an orbiting structure
 *   it isn't.
 * - `'jump_point'`: a travel gateway between systems — e.g. a wormhole or
 *   a game's fast-travel jump point. Rendered distinctly from an ordinary
 *   station: it's a hole between systems, not a structure.
 * - `'nav_point'`: a named navigation marker with no physical structure of
 *   its own — visually the least substantial type, since it isn't a
 *   "thing" at all, just a labelled point in space.
 */
export type BodyType = (typeof BODY_TYPES)[number]

/** A real km vector — x/y in the system's reference plane, z out of it
 *  (orbital convention, before render.ts remaps it into three.js's Y-up
 *  world). Lives here, with the rest of the data contract; still
 *  re-exported from kepler.ts, where it used to be declared. */
export interface Vec3Km {
  x: number
  y: number
  z: number
}

/**
 * A direction in the system's own reference frame, as a longitude in the
 * reference plane (degrees from +x, counter-clockwise seen from +z) and a
 * latitude out of it (degrees, +90 = straight up +z). For the bundled
 * Solar System that frame is the J2000 ecliptic, so this is ecliptic
 * longitude/latitude; see poleFromEquatorialJ2000 (orientation.ts) for
 * converting the IAU's published right ascension/declination into it.
 */
export interface PoleDirection {
  longitudeDeg: number
  latitudeDeg: number
}

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
  /**
   * ISO 8601 date meanAnomalyAtEpochDeg is measured from. Give a UTC `Z`
   * or an explicit offset (`2000-01-01T12:00:00Z`) or a bare date
   * (`2000-01-01`, which ISO defines as UTC). A date-time with no offset is
   * read as UTC by this engine — JavaScript's own `Date` would read it as
   * the viewer's LOCAL time, putting every body somewhere slightly
   * different per time zone — and is flagged by validateSystemData as an
   * `invalid-orbit` warning (`epoch-without-offset`), since the author
   * probably didn't mean either reading on purpose.
   */
  epoch: string
  /**
   * Pole of the plane `inclinationDeg`/`longitudeOfAscendingNodeDeg`/
   * `argumentOfPeriapsisDeg` are measured against, in the system's
   * reference frame (see PoleDirection). Unset means the reference plane
   * itself. That plane's own x-axis (where the ascending node is measured
   * from) is its ascending node on the reference plane — see
   * orientation.ts's planeBasis. Typically the parent's own `pole` (moon
   * elements quoted against the planet's equator) or a moon's local
   * Laplace pole; a ringed planet's moons only line up with its rings when
   * this matches the planet's `pole`.
   */
  referencePlanePole?: PoleDirection
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
  /** A short, human-readable summary of what this body actually IS —
   *  distinct from `note`, which documents this body's own numeric
   *  provenance (e.g. "radius sourced from X"), not what the place is like.
   *  Consumer-supplied content (the engine has no opinion on where it came
   *  from); optional, and only rendered alongside `wikiUrl` when present. */
  wikiSummary?: string
  /** A link to further reading about this body — shown alongside
   *  `wikiSummary` when both are present. Rendered as a plain link with no
   *  assumption about the target site. */
  wikiUrl?: string
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
  /**
   * Obliquity, degrees — the tilt of this body's equator against its own
   * orbit (Saturn 26.7°, Uranus a near-sideways 97.8°). On its own it says
   * how FAR the equator tilts but not which WAY, so it's only a fallback
   * for the ring plane when `pole` isn't set: the equator is then taken as
   * tilted by this much with its ascending node on the reference frame's
   * +x axis — the same convention as an orbit's inclination, so a moon with
   * `inclinationDeg` equal to this and `longitudeOfAscendingNodeDeg` 0 lies
   * exactly in the ring plane. Unset (and no `pole`) means 0.
   */
  axialTiltDeg?: number
  /**
   * Direction of the body's spin axis — the pole its rotation turns
   * anticlockwise about (the right-hand rule), in the system's reference
   * frame (see PoleDirection). Defines the equatorial plane its `rings`
   * are drawn in, and it's what a moon's `orbit.referencePlanePole` should
   * match when its elements are quoted against this body's equator. For a
   * retrograde rotator (Uranus, Pluto) this is the opposite end from the
   * IAU's "north" pole for planets. Takes precedence over `axialTiltDeg`.
   */
  pole?: PoleDirection
  /**
   * The body's own ring system — part of the body, not a separate object:
   * drawn with it, moving with it, selected and framed with it, in its
   * equatorial plane (see `pole`, or `axialTiltDeg` as a fallback). Radii are real km from the
   * body's centre and scale with the body as it's rendered, so a ring stays
   * in proportion even while a small body is floored to a minimum on-screen
   * size (see pixelFloor.ts). For a population that surrounds a star, or a
   * large belt a planet merely sits inside, use a `BeltRegion` instead —
   * those are objects in their own right.
   */
  rings?: RingBand[]
}

/**
 * One band of a body's ring system (see CelestialBody.rings) — e.g.
 * Saturn's A, B and C rings are three bands, with the Cassini Division as
 * the gap left between B and A.
 */
export interface RingBand {
  name?: string
  innerRadiusKm: number
  outerRadiusKm: number
  /**
   * 'disc' (the default): a smooth, translucent band — dust and ice rings
   * like Saturn's, too fine to show as individual particles. 'particles': a
   * scatter of individual points — a ring of actual rocks, like an asteroid
   * belt around a moon.
   */
  style?: 'disc' | 'particles'
  color?: string
  /** 0–1; how solid a 'disc' band reads. Defaults to a faint 0.35. */
  opacity?: number
  /** How many points a 'particles' band draws. Defaults to 600. */
  particleCount?: number
}

/**
 * The overall shape of a belt's population:
 * - 'ring': spread round the whole circle between the two radii (the
 *   asteroid belt, the Kuiper belt) — drawn with a soft glow disc under
 *   its points.
 * - 'shell': spread in every direction (the Oort cloud) — points only.
 * - 'cluster': concentrated in one or more local patches rather than round
 *   the whole circle (e.g. asteroid clusters at a Lagrange point) — points
 *   only, since a full-circle glow disc would draw a belt that isn't there.
 */
export type BeltShape = 'ring' | 'shell' | 'cluster'

/**
 * A named set of sites inside a belt — e.g. mining stations scattered
 * through an asteroid belt. Part of the belt (drawn with it, as distinct
 * markers), not a separate belt stacked on top of it.
 */
export interface BeltSite {
  name: string
  /** Real positions, km, relative to the belt's own `parentId`. */
  positions: FixedPosition[]
  color?: string
  note?: string
  wikiSummary?: string
  wikiUrl?: string
}

/**
 * A population spread across a region rather than one tracked body: a belt
 * round a star (the asteroid belt, the Kuiper belt), a shell (the Oort
 * cloud), or local clusters (a Lagrange point's asteroids). These are
 * objects in their own right — selectable and framed as belts. A planet's
 * own ring system is not a belt: it's part of the planet (see
 * CelestialBody.rings).
 */
export interface BeltRegion {
  id: string
  name: string
  type: 'belt' | 'cloud'
  /**
   * The population's shape (see BeltShape). Defaults from `type`: 'belt' →
   * 'ring', 'cloud' → 'shell'. Set 'cluster' for a population that isn't
   * spread round the whole circle.
   */
  shape?: BeltShape
  /** id of the body this surrounds or clusters round — usually the star. */
  parentId: string
  innerRadiusKm: number
  outerRadiusKm: number
  /**
   * Degrees — the full angular THICKNESS of the population, centred on the
   * reference plane: particles scatter up to half of this above it and
   * half below (the asteroid belt's 20 is ±10°). For a 'shell', 180 is a
   * complete sphere; anything less is a shell with its polar caps left
   * empty. A few degrees for a thin ring, tens of degrees for the asteroid
   * belt.
   */
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
  realPositions?: FixedPosition[]
  /**
   * Radius ranges the scattered population keeps clear of — e.g. the
   * asteroid belt's Kirkwood gaps, cleared by resonance with Jupiter. Only
   * affects the statistical scatter; ignored when `realPositions` is set.
   */
  gaps?: { name?: string; innerRadiusKm: number; outerRadiusKm: number }[]
  /** Named sites inside this belt (see BeltSite), drawn as distinct
   *  markers among its population. */
  sites?: BeltSite[]
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
  /** See CelestialBody's own wikiSummary/wikiUrl — same meaning here. */
  wikiSummary?: string
  wikiUrl?: string
}

export interface StarSystemData {
  id: string
  name: string
  bodies: CelestialBody[]
  belts?: BeltRegion[]
}
