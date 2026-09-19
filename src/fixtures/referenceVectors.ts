/**
 * Ground-truth position vectors from NASA JPL's Horizons System
 * (https://ssd.jpl.nasa.gov/horizons/) — the actual, perturbation-corrected
 * ephemeris JPL publishes, as opposed to the mean/approximate elements this
 * engine propagates. Used to check the engine's output against reality, not
 * just against itself.
 *
 * Fetched via the Horizons text API, e.g. for Earth at J2000 epoch:
 *   https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='399'
 *     &OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='VECTORS'&CENTER='500@10'
 *     &START_TIME='2000-01-01 12:00'&STOP_TIME='2000-01-01 12:01'
 *     &STEP_SIZE='1d'&VEC_TABLE='1'
 * (CENTER '500@10' = Sun body centre for heliocentric vectors; '500@399' =
 * Earth body centre for the Moon's geocentric vector.) Named asteroids use
 * COMMAND=%27<number>;%27 (the small-body designation form, e.g. '4;' for
 * Vesta) instead of a planet's body ID. Output frame is "Ecliptic of
 * J2000.0", the same frame this engine's orbital elements are defined
 * against, so no extra rotation is needed to compare them directly.
 * Retrieved 2026-09-17/18.
 */

export interface RefVector {
  bodyId: string
  /** ISO date the vector is for */
  date: string
  /** km, ecliptic J2000 frame, relative to the body's actual parent (Sun
   *  for planets, Earth for the Moon) */
  x: number
  y: number
  z: number
}

/** All 8 planets, heliocentric, at the J2000.0 epoch itself (2000-01-01
 *  12:00 TDB) — the same epoch this engine's mean elements are referenced
 *  to, so this checks the elements/epoch handling more than propagation. */
export const PLANETS_AT_J2000: RefVector[] = [
  { bodyId: 'mercury', date: '2000-01-01T12:00:00Z', x: -1.946172635585372e7, y: -6.6913275263524e7, z: -3.679854343749542e6 },
  { bodyId: 'venus', date: '2000-01-01T12:00:00Z', x: -1.074564940521906e8, y: -4.885014975872536e6, z: 6.135634299718402e6 },
  { bodyId: 'earth', date: '2000-01-01T12:00:00Z', x: -2.64990336774305e7, y: 1.446972967925493e8, z: -611.1494259536266 },
  { bodyId: 'mars', date: '2000-01-01T12:00:00Z', x: 2.08048140641842e8, y: -2.007052628025221e6, z: -5.156288959268022e6 },
  { bodyId: 'jupiter', date: '2000-01-01T12:00:00Z', x: 5.985676246570644e8, y: 4.396046799481729e8, z: -1.522686167298746e7 },
  { bodyId: 'saturn', date: '2000-01-01T12:00:00Z', x: 9.583853589157217e8, y: 9.828562829593281e8, z: -5.521297969875515e7 },
  { bodyId: 'uranus', date: '2000-01-01T12:00:00Z', x: 2.158974819528798e9, y: -2.054625536468218e9, z: -3.562550131686962e7 },
  { bodyId: 'neptune', date: '2000-01-01T12:00:00Z', x: 2.515046523944309e9, y: -3.738714567646374e9, z: 1.903221685677218e7 },
]

/** Earth, Mars, and Jupiter 10 years after epoch (2010-01-01 12:00 TDB) —
 *  checks the actual Kepler-equation propagation math over a real time
 *  span, not just the epoch values. */
export const PLANETS_AT_2010: RefVector[] = [
  { bodyId: 'earth', date: '2010-01-01T12:00:00Z', x: -2.761730272809177e7, y: 1.444833783392449e8, z: -3211.649782203138 },
  { bodyId: 'jupiter', date: '2010-01-01T12:00:00Z', x: 6.747837464216131e8, y: -3.235649908196778e8, z: -1.375699559658919e7 },
  { bodyId: 'mars', date: '2010-01-01T12:00:00Z', x: -1.100522192299629e8, y: 2.171756957105753e8, z: 7.252986943266422e6 },
]

/** The Moon, geocentric (relative to Earth, not the Sun), at J2000 epoch. */
export const MOON_AT_J2000: RefVector = {
  bodyId: 'moon',
  date: '2000-01-01T12:00:00Z',
  x: -2.916083841877129e5,
  y: -2.749797416731504e5,
  z: 3.627119662699287e4,
}

/** Vesta, Pallas, and Hygiea, heliocentric, at their SBDB elements' own
 *  epoch (2026-06-09 00:00 TDB) — fetched the same way as the planets
 *  above, via COMMAND='<number>;' (the small-body designation form). */
export const ASTEROIDS_AT_EPOCH: RefVector[] = [
  { bodyId: 'vesta', date: '2026-06-09T00:00:00Z', x: 3.394417794091746e8, y: -8.138897624746057e7, z: -3.891717419691554e7 },
  { bodyId: 'pallas', date: '2026-06-09T00:00:00Z', x: 4.56370217585664e8, y: -4.208378450726724e7, z: -1.030504002107676e7 },
  { bodyId: 'hygiea', date: '2026-06-09T00:00:00Z', x: -2.18876107820125e8, y: 4.400004129019004e8, z: -7.583186755716294e6 },
]
