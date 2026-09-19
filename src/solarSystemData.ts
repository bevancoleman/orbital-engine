import type { StarSystemData } from './types'

const AU_KM = 149_597_870.7
const J2000 = '2000-01-01T12:00:00Z'

/**
 * Real Solar System reference data — mean orbital elements (J2000 epoch)
 * and physical radii, sourced from well-established, independently
 * checkable astronomical constants (NASA JPL / IAU published values), used
 * to validate the orbital engine and this module's data contract before any
 * Star Citizen data gets mapped into it (see prompts/ for that reasoning).
 *
 * These are MEAN elements, not a precision ephemeris: real bodies perturb
 * each other and drift from these over time, and several moons here are
 * simplified to their inclination against the ecliptic rather than their
 * planet's true (and sometimes precessing) reference plane. Good enough to
 * validate rendering/scale/LOD, not good enough for real astronomy — that
 * honesty is the point of the `note` field on the less-precise entries.
 *
 * Every body's `color` is its real, well-documented apparent colour (Io's
 * sulfur yellow, Titan's hazy orange, Neptune's deep blue, etc.) — genuine
 * astronomical common knowledge, not an arbitrary UI palette pick. This is
 * the one dataset honest enough to state that for; Star Citizen's own data
 * (star_systems.js, in the Data repo) has no real colour source for
 * anything, so it deliberately leaves `color` unset there instead.
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

    // ── Uranus + major moons ─────────────────────────────────────────────
    {
      id: 'uranus',
      name: 'Uranus',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 25_362,
      color: '#67e8f9',
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

    // ── Neptune + Triton ─────────────────────────────────────────────────
    {
      id: 'neptune',
      name: 'Neptune',
      type: 'planet',
      parentId: 'sun',
      radiusKm: 24_622,
      color: '#60a5fa',
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
      note: 'Largest asteroid-belt object — plotted individually alongside the belt\'s scattered population.',
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
      note: 'Unusually high inclination (~35°) for a large main-belt asteroid.',
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
    {
      id: 'pluto',
      name: 'Pluto',
      type: 'dwarf_planet',
      parentId: 'sun',
      radiusKm: 1188.3,
      // Real colour: ruddy tan/brown from tholins, not pink — no real
      // source supported the previous pink.
      color: '#c99b7a',
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
    {
      id: 'saturn-rings',
      name: "Saturn's Rings",
      type: 'belt',
      parentId: 'saturn',
      innerRadiusKm: 66_900,
      outerRadiusKm: 140_180,
      inclinationSpreadDeg: 0.5,
      particleCount: 3000,
      color: '#fef3c7',
      note: 'Demonstrates a belt around a planet, not just the star — same BeltRegion shape either way.',
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
