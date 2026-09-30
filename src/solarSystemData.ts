import type { StarSystemData } from './types'

const AU_KM = 149_597_870.7
const J2000 = '2000-01-01T12:00:00Z'

/**
 * Solar System reference data — mean orbital elements (J2000 epoch) and
 * physical radii, sourced from published NASA JPL / IAU constants. Used to
 * check the engine and this module's data contract against real astronomy
 * before anything else gets mapped into it.
 *
 * These are MEAN elements, not a precision ephemeris: real bodies perturb
 * each other and drift from these over time, and several moons here are
 * simplified to their inclination against the ecliptic rather than their
 * planet's true (and sometimes precessing) reference plane. Good enough to
 * check rendering/scale/LOD, not good enough for real astronomy — the
 * `note` field flags the less-precise entries.
 *
 * Every body's `color` is its documented apparent colour (Io's sulfur
 * yellow, Titan's hazy orange, Neptune's deep blue, etc.), not a picked UI
 * palette. Other datasets typically have no real colour source for
 * anything and leave `color` unset instead.
 */
export const SOLAR_SYSTEM: StarSystemData = {
  id: 'sol',
  name: 'Sol',
  bodies: [
    {
      id: 'sun',
      name: 'Sun',
      type: 'star',
      parentId: null,
      radiusKm: 696_340,
      orbit: null,
      fixedPosition: null,
      color: '#fde68a',
    },

    // ── Mercury ──────────────────────────────────────────────────────────
    {
      id: 'mercury',
      name: 'Mercury',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 2439.7,
      color: '#a1a1aa',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 0.38709927 * AU_KM,
        eccentricity: 0.20563593,
        inclinationDeg: 7.00497902,
        longitudeOfAscendingNodeDeg: 48.33076593,
        argumentOfPeriapsisDeg: 29.12703035,
        meanAnomalyAtEpochDeg: 174.79252722,
        orbitalPeriodDays: 87.9691,
        epoch: J2000,
      },
    },

    // ── Venus ────────────────────────────────────────────────────────────
    {
      id: 'venus',
      name: 'Venus',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 6051.8,
      color: '#e5c07b',
      atmosphereHeightKm: 250, // thick, hazy cloud tops visible from space
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 0.72333566 * AU_KM,
        eccentricity: 0.00677672,
        inclinationDeg: 3.39467605,
        longitudeOfAscendingNodeDeg: 76.67984255,
        argumentOfPeriapsisDeg: 54.92262463,
        meanAnomalyAtEpochDeg: 50.11477187,
        orbitalPeriodDays: 224.701,
        epoch: J2000,
      },
    },

    // ── Earth + Moon ─────────────────────────────────────────────────────
    {
      id: 'earth',
      name: 'Earth',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 6371.0,
      // The real, famous "Blue Marble" colour — ocean-dominant from orbit.
      color: '#3b82f6',
      atmosphereHeightKm: 100, // the Kármán line — conventional "edge of space"
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 1.00000261 * AU_KM,
        eccentricity: 0.01671123,
        inclinationDeg: 0.00001531,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 102.93768193,
        meanAnomalyAtEpochDeg: 357.52688973,
        orbitalPeriodDays: 365.256363,
        epoch: J2000,
      },
    },
    {
      id: 'moon',
      name: 'Moon',
      type: 'moon',
      parentId: 'earth',
      radiusKm: 1737.4,
      color: '#d4d4d8',
      note: 'Inclination simplified to ecliptic-relative; the Moon\'s true orbital plane precesses on an 18.6-year cycle.',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 384_399,
        eccentricity: 0.0549,
        inclinationDeg: 5.145,
        longitudeOfAscendingNodeDeg: 125.08,
        argumentOfPeriapsisDeg: 318.15,
        meanAnomalyAtEpochDeg: 135.27,
        orbitalPeriodDays: 27.321661,
        epoch: J2000,
      },
    },

    // ── Space stations/satellites — 'station' bodies orbiting a planet,
    // not the star, and on a wildly different scale/timescale (hours, not
    // years) from everything else here. Good stress-test for the engine:
    // near-circular, low-eccentricity, low-altitude orbits with a period so
    // short it visibly completes multiple laps per simulated day.
    {
      id: 'iss',
      name: 'ISS',
      type: 'station',
      parentId: 'earth',
      radiusKm: 0.055, // ~109m truss length treated as a nominal radius
      color: '#e5e7eb',
      note: 'Representative snapshot only — unlike natural bodies, ISS altitude/period genuinely drift day to day from atmospheric drag and reboosts, so this is not a stable "mean element" the way a planet\'s is.',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 6371 + 418, // ~418km mean altitude
        eccentricity: 0.0003,
        inclinationDeg: 51.64,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 92.68 / 1440,
        epoch: '2026-01-01T00:00:00Z',
      },
    },
    {
      id: 'hubble',
      name: 'Hubble Space Telescope',
      type: 'station',
      parentId: 'earth',
      radiusKm: 0.0064, // ~13m length
      // Real colour: gold Mylar thermal insulation over a white/silver hull
      // — not the pale blue this previously had (no real source for that).
      color: '#d4af7a',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 6371 + 535,
        eccentricity: 0.0003,
        inclinationDeg: 28.47,
        longitudeOfAscendingNodeDeg: 90,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 95.42 / 1440,
        epoch: '2026-01-01T00:00:00Z',
      },
    },

    // ── Mars + moons ─────────────────────────────────────────────────────
    {
      id: 'mars',
      name: 'Mars',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 3389.5,
      color: '#f87171',
      atmosphereHeightKm: 100,
      note: "Atmosphere reaches a comparable height to Earth's before thinning to nothing, but is only ~1% as dense at the surface — thin throughout, not just short.",
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 1.52371034 * AU_KM,
        eccentricity: 0.0933941,
        inclinationDeg: 1.84969142,
        longitudeOfAscendingNodeDeg: 49.55953891,
        argumentOfPeriapsisDeg: 286.5,
        meanAnomalyAtEpochDeg: 19.412,
        orbitalPeriodDays: 686.98,
        epoch: J2000,
      },
    },
    {
      id: 'phobos',
      name: 'Phobos',
      type: 'moon',
      parentId: 'mars',
      radiusKm: 11.267,
      color: '#a8a29e',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 9376,
        eccentricity: 0.0151,
        inclinationDeg: 1.093,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 0.31891,
        epoch: J2000,
      },
    },
    {
      id: 'deimos',
      name: 'Deimos',
      type: 'moon',
      parentId: 'mars',
      radiusKm: 6.2,
      color: '#a8a29e',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 23_463.2,
        eccentricity: 0.00033,
        inclinationDeg: 0.93,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 60,
        orbitalPeriodDays: 1.26244,
        epoch: J2000,
      },
    },

    // ── Jupiter + Galilean moons ─────────────────────────────────────────
    {
      id: 'jupiter',
      name: 'Jupiter',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 69_911,
      color: '#d97706',
      // Obliquity and ring radii: NASA NSSDCA Jupiter fact sheet and
      // Jupiter rings fact sheet. The rings are faint dust — halo, main
      // ring, and the two gossamer rings merged into one wide, faint band.
      axialTiltDeg: 3.13,
      rings: [
        { name: 'Halo', innerRadiusKm: 92_000, outerRadiusKm: 122_500, opacity: 0.05, color: '#b89a7a' },
        { name: 'Main', innerRadiusKm: 122_500, outerRadiusKm: 129_000, opacity: 0.14, color: '#b89a7a' },
        { name: 'Gossamer', innerRadiusKm: 129_000, outerRadiusKm: 226_000, opacity: 0.03, color: '#b89a7a' },
      ],
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 5.202887 * AU_KM,
        eccentricity: 0.04838624,
        inclinationDeg: 1.30439695,
        longitudeOfAscendingNodeDeg: 100.47390909,
        argumentOfPeriapsisDeg: 273.867,
        meanAnomalyAtEpochDeg: 20.020,
        orbitalPeriodDays: 4332.59,
        epoch: J2000,
      },
    },
    {
      id: 'io',
      name: 'Io',
      type: 'moon',
      parentId: 'jupiter',
      radiusKm: 1821.6,
      color: '#fde047',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 421_800,
        eccentricity: 0.0041,
        inclinationDeg: 0.05,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 1.769,
        epoch: J2000,
      },
    },
    {
      id: 'europa',
      name: 'Europa',
      type: 'moon',
      parentId: 'jupiter',
      radiusKm: 1560.8,
      color: '#e0e7ff',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 671_100,
        eccentricity: 0.009,
        inclinationDeg: 0.471,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 90,
        orbitalPeriodDays: 3.551,
        epoch: J2000,
      },
    },
    {
      id: 'ganymede',
      name: 'Ganymede',
      type: 'moon',
      parentId: 'jupiter',
      radiusKm: 2634.1,
      color: '#a8a29e',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 1_070_400,
        eccentricity: 0.0013,
        inclinationDeg: 0.204,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 180,
        orbitalPeriodDays: 7.1546,
        epoch: J2000,
      },
    },
    {
      id: 'callisto',
      name: 'Callisto',
      type: 'moon',
      parentId: 'jupiter',
      radiusKm: 2410.3,
      color: '#78716c',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 1_882_700,
        eccentricity: 0.0074,
        inclinationDeg: 0.205,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 270,
        orbitalPeriodDays: 16.689,
        epoch: J2000,
      },
    },

    // ── Saturn + major moons ─────────────────────────────────────────────
    {
      id: 'saturn',
      name: 'Saturn',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 58_232,
      color: '#eab308',
      // Obliquity and ring radii: NASA NSSDCA Saturn fact sheet and Saturn
      // rings fact sheet. The Cassini Division (117,580–122,170 km) is the
      // gap left between the B and A bands; the F ring's ~200 km width is a
      // representative figure (it varies from ~50 to ~500 km).
      axialTiltDeg: 26.73,
      rings: [
        { name: 'D', innerRadiusKm: 66_900, outerRadiusKm: 74_510, opacity: 0.08, color: '#cbbd9e' },
        { name: 'C', innerRadiusKm: 74_658, outerRadiusKm: 92_000, opacity: 0.25, color: '#cbbd9e' },
        { name: 'B', innerRadiusKm: 92_000, outerRadiusKm: 117_580, opacity: 0.7, color: '#efe3c4' },
        { name: 'A', innerRadiusKm: 122_170, outerRadiusKm: 136_775, opacity: 0.5, color: '#e3d6b6' },
        { name: 'F', innerRadiusKm: 140_080, outerRadiusKm: 140_280, opacity: 0.35, color: '#e3d6b6' },
      ],
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 9.53667594 * AU_KM,
        eccentricity: 0.05386179,
        inclinationDeg: 2.48599187,
        longitudeOfAscendingNodeDeg: 113.66242448,
        argumentOfPeriapsisDeg: 339.392,
        meanAnomalyAtEpochDeg: 317.020,
        orbitalPeriodDays: 10_759.22,
        epoch: J2000,
      },
    },
    {
      id: 'titan',
      name: 'Titan',
      type: 'moon',
      parentId: 'saturn',
      radiusKm: 2574.7,
      color: '#fbbf24',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 1_221_870,
        eccentricity: 0.0288,
        inclinationDeg: 0.348,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 15.945,
        epoch: J2000,
      },
    },
    {
      id: 'rhea',
      name: 'Rhea',
      type: 'moon',
      parentId: 'saturn',
      radiusKm: 763.8,
      color: '#d6d3d1',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 527_108,
        eccentricity: 0.001,
        inclinationDeg: 0.345,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 150,
        orbitalPeriodDays: 4.518,
        epoch: J2000,
      },
    },
    // Saturn's mid-sized moons: mean elements from JPL SSD (ssd.jpl.nasa.gov/sats/elem),
    // radii from the NASA planetary fact sheets. Inclinations are to Saturn's
    // equatorial (Laplace) plane, same convention as Rhea above.
    {
      id: 'enceladus',
      name: 'Enceladus',
      type: 'moon',
      parentId: 'saturn',
      radiusKm: 252.1,
      color: '#f8fafc',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 238_400,
        eccentricity: 0.005,
        inclinationDeg: 0.0,
        longitudeOfAscendingNodeDeg: 0.0,
        argumentOfPeriapsisDeg: 119.5,
        meanAnomalyAtEpochDeg: 57.0,
        orbitalPeriodDays: 1.370218,
        epoch: J2000,
      },
    },
    {
      id: 'tethys',
      name: 'Tethys',
      type: 'moon',
      parentId: 'saturn',
      radiusKm: 531.1,
      color: '#e7e5e4',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 295_000,
        eccentricity: 0.001,
        inclinationDeg: 1.1,
        longitudeOfAscendingNodeDeg: 273.0,
        argumentOfPeriapsisDeg: 335.3,
        meanAnomalyAtEpochDeg: 0.0,
        orbitalPeriodDays: 1.887802,
        epoch: J2000,
      },
    },
    {
      id: 'dione',
      name: 'Dione',
      type: 'moon',
      parentId: 'saturn',
      radiusKm: 561.4,
      color: '#d6d3d1',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 377_700,
        eccentricity: 0.002,
        inclinationDeg: 0.0,
        longitudeOfAscendingNodeDeg: 0.0,
        argumentOfPeriapsisDeg: 116.0,
        meanAnomalyAtEpochDeg: 212.0,
        orbitalPeriodDays: 2.736916,
        epoch: J2000,
      },
    },
    {
      id: 'iapetus',
      name: 'Iapetus',
      type: 'moon',
      parentId: 'saturn',
      radiusKm: 734.5,
      color: '#a8a29e',
      fixedPosition: null,
      orbit: {
      // Iapetus orbits far out, tilted ~15° to Saturn's equator — its orbit follows
      // a Laplace plane between Saturn's equator and its orbital plane.
        semiMajorAxisKm: 3_561_700,
        eccentricity: 0.028,
        inclinationDeg: 7.6,
        longitudeOfAscendingNodeDeg: 86.5,
        argumentOfPeriapsisDeg: 254.5,
        meanAnomalyAtEpochDeg: 74.8,
        orbitalPeriodDays: 79.331002,
        epoch: J2000,
      },
    },

    // ── Uranus + major moons ─────────────────────────────────────────────
    {
      id: 'uranus',
      name: 'Uranus',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 25_362,
      color: '#67e8f9',
      // Obliquity and ring radii: NASA NSSDCA Uranus fact sheet and Uranian
      // rings fact sheet. Thirteen narrow, dark rings, grouped here into the
      // inner set (6, 5, 4, α, β), the η–δ set, and the bright ε ring.
      axialTiltDeg: 97.77,
      rings: [
        { name: '6–β', innerRadiusKm: 41_800, outerRadiusKm: 45_700, opacity: 0.12, color: '#8c8c8c' },
        { name: 'η–δ', innerRadiusKm: 47_150, outerRadiusKm: 48_320, opacity: 0.14, color: '#8c8c8c' },
        { name: 'ε', innerRadiusKm: 51_100, outerRadiusKm: 51_200, opacity: 0.5, color: '#a3a3a3' },
      ],
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 19.18916464 * AU_KM,
        eccentricity: 0.04725744,
        inclinationDeg: 0.77263783,
        longitudeOfAscendingNodeDeg: 74.01692503,
        argumentOfPeriapsisDeg: 96.998857,
        meanAnomalyAtEpochDeg: 142.2386,
        orbitalPeriodDays: 30_688.5,
        epoch: J2000,
      },
    },
    {
      id: 'titania',
      name: 'Titania',
      type: 'moon',
      parentId: 'uranus',
      radiusKm: 788.4,
      color: '#a8a29e',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 436_300,
        eccentricity: 0.0011,
        // Uranus's axial tilt (~98°) means its moons' orbits are near-polar
        // relative to the ecliptic — a real, large value, not a data error.
        inclinationDeg: 97.9,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 8.706,
        epoch: J2000,
      },
    },
    // Uranus's other major moons: mean elements from JPL SSD, radii from the
    // NASA fact sheets. Inclination adds Uranus's ~97.8° axial tilt, same
    // convention as Titania above.
    {
      id: 'miranda',
      name: 'Miranda',
      type: 'moon',
      parentId: 'uranus',
      radiusKm: 235.8,
      color: '#a8a29e',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 129_846,
        eccentricity: 0.001,
        inclinationDeg: 102.2,
        longitudeOfAscendingNodeDeg: 100.9,
        argumentOfPeriapsisDeg: 154.8,
        meanAnomalyAtEpochDeg: 73.0,
        orbitalPeriodDays: 1.413479,
        epoch: J2000,
      },
    },
    {
      id: 'ariel',
      name: 'Ariel',
      type: 'moon',
      parentId: 'uranus',
      radiusKm: 578.9,
      color: '#c4c0bc',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 190_929,
        eccentricity: 0.001,
        inclinationDeg: 97.8,
        longitudeOfAscendingNodeDeg: 0.0,
        argumentOfPeriapsisDeg: 9.6,
        meanAnomalyAtEpochDeg: 193.5,
        orbitalPeriodDays: 2.520379,
        epoch: J2000,
      },
    },
    {
      id: 'umbriel',
      name: 'Umbriel',
      type: 'moon',
      parentId: 'uranus',
      radiusKm: 584.7,
      color: '#78716c',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 265_986,
        eccentricity: 0.004,
        inclinationDeg: 97.9,
        longitudeOfAscendingNodeDeg: 174.8,
        argumentOfPeriapsisDeg: 183.4,
        meanAnomalyAtEpochDeg: 253.0,
        orbitalPeriodDays: 4.144177,
        epoch: J2000,
      },
    },
    {
      id: 'oberon',
      name: 'Oberon',
      type: 'moon',
      parentId: 'uranus',
      radiusKm: 761.4,
      color: '#8a8580',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 583_511,
        eccentricity: 0.002,
        inclinationDeg: 97.9,
        longitudeOfAscendingNodeDeg: 76.8,
        argumentOfPeriapsisDeg: 132.2,
        meanAnomalyAtEpochDeg: 143.6,
        orbitalPeriodDays: 13.463237,
        epoch: J2000,
      },
    },

    // ── Neptune + Triton ─────────────────────────────────────────────────
    {
      id: 'neptune',
      name: 'Neptune',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 24_622,
      color: '#60a5fa',
      // Obliquity and ring radii: NASA NSSDCA Neptune fact sheet and
      // Neptunian rings fact sheet — faint dusty rings, with the narrow Le
      // Verrier and Adams rings the brightest.
      axialTiltDeg: 28.32,
      rings: [
        { name: 'Galle', innerRadiusKm: 40_900, outerRadiusKm: 42_900, opacity: 0.05, color: '#9a9a9a' },
        { name: 'Le Verrier', innerRadiusKm: 53_140, outerRadiusKm: 53_260, opacity: 0.25, color: '#9a9a9a' },
        { name: 'Lassell', innerRadiusKm: 53_260, outerRadiusKm: 57_200, opacity: 0.04, color: '#9a9a9a' },
        { name: 'Adams', innerRadiusKm: 62_900, outerRadiusKm: 62_960, opacity: 0.3, color: '#b0b0b0' },
      ],
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 30.06992276 * AU_KM,
        eccentricity: 0.00859048,
        inclinationDeg: 1.77004347,
        longitudeOfAscendingNodeDeg: 131.78422574,
        argumentOfPeriapsisDeg: 273.187,
        meanAnomalyAtEpochDeg: 259.91520804,
        orbitalPeriodDays: 60_182,
        epoch: J2000,
      },
    },
    {
      id: 'triton',
      name: 'Triton',
      type: 'moon',
      parentId: 'neptune',
      radiusKm: 1353.4,
      color: '#bae6fd',
      note: 'Retrograde orbit — inclination >90° is real, not a data error.',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 354_759,
        eccentricity: 0.000016,
        inclinationDeg: 156.885,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 5.877,
        epoch: J2000,
      },
    },

    // ── Dwarf planets ────────────────────────────────────────────────────
    {
      id: 'ceres',
      name: 'Ceres',
      type: 'dwarf_planet',
      parentId: 'sun',
      radiusKm: 469.7,
      color: '#d6d3d1',
      beltId: 'asteroid-belt',
      note: 'Largest asteroid-belt object — plotted individually alongside the belt\'s scattered population.',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 2.7675 * AU_KM,
        eccentricity: 0.0758,
        inclinationDeg: 10.59,
        longitudeOfAscendingNodeDeg: 80.31,
        argumentOfPeriapsisDeg: 73.6,
        meanAnomalyAtEpochDeg: 95.99,
        orbitalPeriodDays: 1682,
        epoch: J2000,
      },
    },

    // ── Named asteroids — discrete 'asteroid' bodies with their own tracked
    // orbit, distinct from the Asteroid Belt's scattered population below
    // (see belts). Elements from JPL SBDB (ssd-api.jpl.nasa.gov/sbdb.api),
    // epoch 2026-06-09 — verified against real Horizons position vectors at
    // that same epoch, all within ~1%.
    {
      id: 'vesta',
      name: '4 Vesta',
      type: 'asteroid',
      parentId: 'sun',
      radiusKm: 262.7,
      color: '#d4d4d8',
      beltId: 'asteroid-belt',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 2.36 * AU_KM,
        eccentricity: 0.0902,
        inclinationDeg: 7.14,
        longitudeOfAscendingNodeDeg: 104,
        argumentOfPeriapsisDeg: 151,
        meanAnomalyAtEpochDeg: 81.2,
        orbitalPeriodDays: 1330,
        epoch: '2026-06-09T00:00:00Z',
      },
    },
    {
      id: 'pallas',
      name: '2 Pallas',
      type: 'asteroid',
      parentId: 'sun',
      radiusKm: 256,
      color: '#a8a29e',
      beltId: 'asteroid-belt',
      note: 'Unusually high inclination (~35°) for a large main-belt asteroid.',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 2.77 * AU_KM,
        eccentricity: 0.231,
        inclinationDeg: 34.9,
        longitudeOfAscendingNodeDeg: 173,
        argumentOfPeriapsisDeg: 311,
        meanAnomalyAtEpochDeg: 254,
        orbitalPeriodDays: 1680,
        epoch: '2026-06-09T00:00:00Z',
      },
    },
    {
      id: 'hygiea',
      name: '10 Hygiea',
      type: 'asteroid',
      parentId: 'sun',
      radiusKm: 216.5,
      color: '#78716c',
      beltId: 'asteroid-belt',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 3.15 * AU_KM,
        eccentricity: 0.107,
        inclinationDeg: 3.83,
        longitudeOfAscendingNodeDeg: 283,
        argumentOfPeriapsisDeg: 312,
        meanAnomalyAtEpochDeg: 252,
        orbitalPeriodDays: 2040,
        epoch: '2026-06-09T00:00:00Z',
      },
    },
    // Small bodies visited by spacecraft — osculating elements from JPL's
    // Small-Body Database (ssd-api.jpl.nasa.gov/sbdb.api), radius as the
    // mean of the published diameter.
    {
      id: 'eros',
      name: '433 Eros',
      type: 'asteroid',
      parentId: 'sun',
      radiusKm: 8.42,
      color: '#a8906c',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 1.458244 * AU_KM,
        eccentricity: 0.222878,
        inclinationDeg: 10.8285,
        longitudeOfAscendingNodeDeg: 304.268,
        argumentOfPeriapsisDeg: 178.918,
        meanAnomalyAtEpochDeg: 62.5115,
        orbitalPeriodDays: 643.196,
        epoch: '2026-06-09T00:00:00Z',
      },
      note: 'Near-Earth asteroid, 34 × 11 × 11 km — visited by NEAR Shoemaker (2000–01).',
    },
    {
      id: 'bennu',
      name: '101955 Bennu',
      type: 'asteroid',
      parentId: 'sun',
      radiusKm: 0.2422,
      color: '#57534e',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 1.126391 * AU_KM,
        eccentricity: 0.203745,
        inclinationDeg: 6.03494,
        longitudeOfAscendingNodeDeg: 2.06087,
        argumentOfPeriapsisDeg: 66.2231,
        meanAnomalyAtEpochDeg: 101.704,
        orbitalPeriodDays: 436.649,
        epoch: '2011-01-01T00:00:00Z',
      },
      note: 'Near-Earth asteroid, ~490 m across — sampled by OSIRIS-REx (2020).',
    },
    {
      id: 'arrokoth',
      name: '486958 Arrokoth',
      type: 'asteroid',
      parentId: 'sun',
      radiusKm: 9,
      color: '#b45309',
      beltId: 'kuiper-belt',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 44.052578 * AU_KM,
        eccentricity: 0.035557,
        inclinationDeg: 2.45061,
        longitudeOfAscendingNodeDeg: 159.038,
        argumentOfPeriapsisDeg: 188.851,
        meanAnomalyAtEpochDeg: 310.984,
        orbitalPeriodDays: 106796.1,
        epoch: '2026-06-09T00:00:00Z',
      },
      note: 'Kuiper belt contact binary, 36 × 20 × 10 km — flown past by New Horizons (2019). Radius is volume-equivalent.',
    },
    {
      id: 'pluto',
      name: 'Pluto',
      type: 'dwarf_planet',
      parentId: 'sun',
      radiusKm: 1188.3,
      // Real colour: ruddy tan/brown from tholins, not pink — no real
      // source supported the previous pink.
      color: '#c99b7a',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 39.48211675 * AU_KM,
        eccentricity: 0.2488,
        inclinationDeg: 17.16,
        longitudeOfAscendingNodeDeg: 110.29713889,
        argumentOfPeriapsisDeg: 113.834,
        meanAnomalyAtEpochDeg: 14.53,
        orbitalPeriodDays: 90_560,
        epoch: J2000,
      },
    },
    {
      id: 'charon',
      name: 'Charon',
      type: 'moon',
      parentId: 'pluto',
      radiusKm: 606,
      color: '#e7e5e4',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 19_591,
        eccentricity: 0.0002,
        inclinationDeg: 0.08,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 6.387,
        epoch: J2000,
      },
    },
    {
      id: 'eris',
      name: 'Eris',
      type: 'dwarf_planet',
      parentId: 'sun',
      radiusKm: 1163,
      // Real colour: one of the most reflective objects in the Solar
      // System, near-white like fresh snow — not pink, which had no real
      // source behind it.
      color: '#f1f5f9',
      note: 'Scattered-disc object well outside the Kuiper belt proper.',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 67.78 * AU_KM,
        eccentricity: 0.43607,
        inclinationDeg: 44.04,
        longitudeOfAscendingNodeDeg: 35.95,
        argumentOfPeriapsisDeg: 151.28,
        meanAnomalyAtEpochDeg: 205.99,
        orbitalPeriodDays: 203_830,
        epoch: J2000,
      },
    },

    // ── A comet, for a highly eccentric reference case ──────────────────
    {
      id: 'halley',
      name: "Halley's Comet",
      type: 'comet',
      parentId: 'sun',
      radiusKm: 5.5,
      color: '#a5f3fc',
      note: 'Nucleus radius only (no coma/tail modelled). Retrograde, e≈0.97.',
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 17.834 * AU_KM,
        eccentricity: 0.96658,
        inclinationDeg: 162.26,
        longitudeOfAscendingNodeDeg: 58.42,
        argumentOfPeriapsisDeg: 111.33,
        // Perihelion passage was 1986-02-09.97 TDB (JPL SBDB: tp=JD 2446469.974)
        // — essentially exactly this epoch, so mean anomaly here is ~0, not a
        // guessed value (an earlier version of this file had 38.4, which is wrong).
        meanAnomalyAtEpochDeg: 0.007,
        orbitalPeriodDays: 27_740,
        epoch: '1986-02-09T00:00:00Z',
      },
    },
  ],

  belts: [
    {
      id: 'asteroid-belt',
      name: 'Asteroid Belt',
      type: 'belt',
      parentId: 'sun',
      innerRadiusKm: 2.2 * AU_KM,
      outerRadiusKm: 3.2 * AU_KM,
      inclinationSpreadDeg: 20,
      particleCount: 4000,
      color: '#a8a29e',
      // The Kirkwood gaps — orbits cleared by resonance with Jupiter, named
      // by the ratio of the asteroid's orbital period to Jupiter's. Centred
      // on the semi-major axes of the 3:1 (2.50 AU), 5:2 (2.82 AU) and 7:3
      // (2.95 AU) resonances, ±0.03 AU. (The 2:1 gap at 3.27 AU lies past
      // this belt's outer edge.)
      gaps: [
        { name: '3:1', innerRadiusKm: 2.47 * AU_KM, outerRadiusKm: 2.53 * AU_KM },
        { name: '5:2', innerRadiusKm: 2.79 * AU_KM, outerRadiusKm: 2.85 * AU_KM },
        { name: '7:3', innerRadiusKm: 2.92 * AU_KM, outerRadiusKm: 2.98 * AU_KM },
      ],
    },
    {
      id: 'kuiper-belt',
      name: 'Kuiper Belt',
      type: 'belt',
      parentId: 'sun',
      innerRadiusKm: 30 * AU_KM,
      outerRadiusKm: 50 * AU_KM,
      inclinationSpreadDeg: 30,
      particleCount: 5000,
      color: '#93c5fd',
    },
    {
      id: 'oort-cloud',
      name: 'Oort Cloud',
      type: 'cloud',
      parentId: 'sun',
      innerRadiusKm: 2_000 * AU_KM,
      outerRadiusKm: 100_000 * AU_KM,
      inclinationSpreadDeg: 90,
      particleCount: 3000,
      color: '#e0f2fe',
      note: 'Scale is illustrative — the Oort Cloud\'s real outer edge is roughly a light-year out, far beyond where this engine\'s distance compression stays legible.',
    },

    // ── Jupiter Trojans — a real, distinct population from the main belt:
    // asteroids sharing Jupiter's own orbit (parentId 'sun', same as the
    // main belt), gravitationally locked into two clusters 60° ahead of
    // and behind Jupiter rather than spread around the whole circle. See
    // BeltRegion.coOrbital — orbits the Sun at roughly Jupiter's own
    // distance, but the reference angle for "where" is Jupiter's current
    // position, so these visibly travel with Jupiter as time advances.
    {
      id: 'jupiter-trojans-l4',
      name: 'Jupiter Trojans (L4, "Greeks")',
      type: 'belt',
      parentId: 'sun',
      innerRadiusKm: 4.9 * AU_KM,
      outerRadiusKm: 5.4 * AU_KM,
      inclinationSpreadDeg: 25,
      particleCount: 2200,
      color: '#fda4af',
      coOrbital: { bodyId: 'jupiter', leadAngleDeg: 60, angularSpreadDeg: 35 },
      note: 'Real libration zones are a complex "tadpole" shape around the exact L4 point — approximated here as a simple angular band.',
    },
    {
      id: 'jupiter-trojans-l5',
      name: 'Jupiter Trojans (L5)',
      type: 'belt',
      parentId: 'sun',
      innerRadiusKm: 4.9 * AU_KM,
      outerRadiusKm: 5.4 * AU_KM,
      inclinationSpreadDeg: 25,
      particleCount: 2200,
      color: '#f0abfc',
      coOrbital: { bodyId: 'jupiter', leadAngleDeg: -60, angularSpreadDeg: 35 },
      note: 'L5 (trailing Jupiter) — the smaller of the two swarms in reality; roughly equal counts here for legibility, not a real population ratio.',
    },
  ],
}
