import type { RefVector } from './referenceVectors'

/**
 * Planet-centred J2000 position vectors for every moon whose elements come
 * from JPL's satellite mean-element table (see solarSystemData.ts's
 * jplSatelliteOrbit), from JPL Horizons — same API and frame (ecliptic
 * J2000) as referenceVectors.ts, with CENTER set to the planet's body
 * centre, e.g. for Titan:
 *   https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='606'
 *     &CENTER='500@699'&EPHEM_TYPE='VECTORS'&START_TIME='2000-01-01 12:00'
 *     &STOP_TIME='2000-01-01 13:00'&STEP_SIZE='1 h'&REF_PLANE='ECLIPTIC'
 *     &REF_SYSTEM='J2000'&VEC_TABLE='1'&OUT_UNITS='KM-S'
 * Retrieved 2026-10-18. These are what pin each moon's orbital PLANE (and
 * so its frame conversion) to reality.
 */
export const MOONS_AT_J2000: RefVector[] = [
  { bodyId: 'phobos', date: '2000-01-01T12:00:00Z', x: -1988.977928515696, y: -9287.523660834324, z: 558.1614280277313 },
  { bodyId: 'deimos', date: '2000-01-01T12:00:00Z', x: 10366.44028857383, y: -19995.33907222152, z: -6530.543992997214 },
  { bodyId: 'io', date: '2000-01-01T12:00:00Z', x: 399714.236329573, y: 129266.6509466162, z: 10663.25607327993 },
  { bodyId: 'europa', date: '2000-01-01T12:00:00Z', x: -561244.4737473305, y: -356013.0586113582, z: -17954.09763917836 },
  { bodyId: 'ganymede', date: '2000-01-01T12:00:00Z', x: -821345.0948603005, y: -685388.8243299203, z: -34557.73734835535 },
  { bodyId: 'callisto', date: '2000-01-01T12:00:00Z', x: 325079.7306331359, y: 1852260.033701718, z: 64754.7663980982 },
  { bodyId: 'enceladus', date: '2000-01-01T12:00:00Z', x: 161710.097341096, y: -159324.8131268961, z: 67786.57338079537 },
  { bodyId: 'tethys', date: '2000-01-01T12:00:00Z', x: 217033.7614667597, y: -186441.0864280699, z: 70590.99785668746 },
  { bodyId: 'dione', date: '2000-01-01T12:00:00Z', x: 228548.6335990705, y: -273815.5473331758, z: 121141.7443204962 },
  { bodyId: 'rhea', date: '2000-01-01T12:00:00Z', x: -524762.3777200788, y: -1484.48332811442, z: 54641.07997565647 },
  { bodyId: 'titan', date: '2000-01-01T12:00:00Z', x: -946802.9384488795, y: 766868.0317005697, z: -302959.9876766361 },
  { bodyId: 'iapetus', date: '2000-01-01T12:00:00Z', x: -2853773.238772294, y: -2019928.31852764, z: 1050756.913128282 },
  { bodyId: 'miranda', date: '2000-01-01T12:00:00Z', x: -104329.5322347591, y: 4597.697372444254, z: -77052.50984837848 },
  { bodyId: 'ariel', date: '2000-01-01T12:00:00Z', x: 175677.935523673, y: -46703.81793678207, z: -59273.44826004158 },
  { bodyId: 'umbriel', date: '2000-01-01T12:00:00Z', x: 100010.3237187744, y: -55025.28645077557, z: -240255.0678962594 },
  { bodyId: 'titania', date: '2000-01-01T12:00:00Z', x: -63107.0017574001, y: -46441.09442004217, z: -428906.4648943231 },
  { bodyId: 'oberon', date: '2000-01-01T12:00:00Z', x: -560569.9599050765, y: 104036.8966132448, z: -124464.167114476 },
  { bodyId: 'triton', date: '2000-01-01T12:00:00Z', x: -205696.4744679369, y: 124061.5238227584, z: 261000.7739897959 },
  { bodyId: 'charon', date: '2000-01-01T12:00:00Z', x: -6837.721052183023, y: -14480.59952787503, z: -11298.55593548415 },
]
