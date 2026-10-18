import { positionAtTime } from '../kepler'
import {
  J2000_OBLIQUITY_DEG,
  angleBetweenDeg,
  bodyPoleVector,
  equatorialNodeOffsetDeg,
  orbitNormal,
  planeBasis,
  poleFromEquatorialJ2000,
  poleVector,
  ringPlaneQuaternion,
  toReferenceFrame,
} from '../orientation'
import { compressVec } from '../render'
import type { CelestialBody, OrbitalElements, Vec3Km } from '../types'

function body(overrides: Partial<CelestialBody> = {}): CelestialBody {
  return { id: 'p', name: 'P', type: 'planet', parentId: 'star', radiusKm: 60_000, orbit: null, fixedPosition: { xKm: 1e9, yKm: 0, zKm: 0 }, ...overrides }
}

/** Rotate a vector by a three.js-order [x, y, z, w] quaternion. */
function rotate([qx, qy, qz, qw]: [number, number, number, number], [vx, vy, vz]: [number, number, number]): [number, number, number] {
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)]
}

/** Normal of the plane a set of RENDER-space points lies in. */
function renderPlaneNormal(a: [number, number, number], b: [number, number, number]): Vec3Km {
  return { x: a[1] * b[2] - a[2] * b[1], y: a[2] * b[0] - a[0] * b[2], z: a[0] * b[1] - a[1] * b[0] }
}

/** Angle between two PLANES given by their normals, ignoring which way
 *  each normal points — 0–90°. */
function planeAngleDeg(a: Vec3Km, b: Vec3Km): number {
  const angle = angleBetweenDeg(a, b)
  return Math.min(angle, 180 - angle)
}

const moonOrbit = (overrides: Partial<OrbitalElements>): OrbitalElements => ({
  semiMajorAxisKm: 500_000, eccentricity: 0.01, inclinationDeg: 0, longitudeOfAscendingNodeDeg: 0,
  argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0, orbitalPeriodDays: 5, epoch: '2000-01-01T12:00:00Z', ...overrides,
})

describe('poleFromEquatorialJ2000', () => {
  it("puts the celestial north pole at the ecliptic's own obliquity from the ecliptic pole", () => {
    const pole = poleFromEquatorialJ2000(0, 90)
    expect(pole.latitudeDeg).toBeCloseTo(90 - J2000_OBLIQUITY_DEG, 9)
    expect(pole.longitudeDeg).toBeCloseTo(90, 9)
  })

  it('leaves the vernal equinox where it is', () => {
    const pole = poleFromEquatorialJ2000(0, 0)
    expect(pole.latitudeDeg).toBeCloseTo(0, 9)
    expect(pole.longitudeDeg).toBeCloseTo(0, 9)
  })
})

describe('planeBasis', () => {
  it.each([
    { longitudeDeg: 30, latitudeDeg: 60 },
    { longitudeDeg: -120, latitudeDeg: -10 },
    { longitudeDeg: 0, latitudeDeg: 90 },
    { longitudeDeg: 0, latitudeDeg: -90 },
  ])('is a right-handed orthonormal set with x on the reference plane (%o)', (pole) => {
    const { x, y, z } = planeBasis(poleVector(pole))
    expect(Math.hypot(x.x, x.y, x.z)).toBeCloseTo(1, 12)
    expect(Math.hypot(y.x, y.y, y.z)).toBeCloseTo(1, 12)
    expect(x.x * y.x + x.y * y.y + x.z * y.z).toBeCloseTo(0, 12)
    expect(x.z).toBeCloseTo(0, 12)
    // x × y = z
    expect(x.y * y.z - x.z * y.y).toBeCloseTo(z.x, 12)
    expect(x.z * y.x - x.x * y.z).toBeCloseTo(z.y, 12)
    expect(x.x * y.y - x.y * y.x).toBeCloseTo(z.z, 12)
  })
})

describe('toReferenceFrame / orbitNormal', () => {
  it('is the identity with no pole', () => {
    expect(toReferenceFrame({ x: 1, y: 2, z: 3 }, undefined)).toEqual({ x: 1, y: 2, z: 3 })
  })

  it("puts an equatorial orbit's normal on the pole of the plane it's quoted against", () => {
    const pole = { longitudeDeg: 77, latitudeDeg: -8 }
    expect(angleBetweenDeg(orbitNormal({ inclinationDeg: 0, longitudeOfAscendingNodeDeg: 123, referencePlanePole: pole }), poleVector(pole))).toBeLessThan(1e-5)
    expect(angleBetweenDeg(orbitNormal({ inclinationDeg: 180, longitudeOfAscendingNodeDeg: 0, referencePlanePole: pole }), poleVector(pole))).toBeCloseTo(180, 4)
  })

  it('agrees with the plane positionAtTime actually moves in', () => {
    const orbit = moonOrbit({ inclinationDeg: 20, longitudeOfAscendingNodeDeg: 70, argumentOfPeriapsisDeg: 15, referencePlanePole: { longitudeDeg: 40, latitudeDeg: 50 } })
    const a = positionAtTime(orbit, new Date('2000-01-01T12:00:00Z'))
    const b = positionAtTime(orbit, new Date('2000-01-02T12:00:00Z'))
    const motionNormal = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
    expect(angleBetweenDeg(motionNormal, orbitNormal(orbit))).toBeLessThan(1e-6)
  })
})

describe('equatorialNodeOffsetDeg', () => {
  it("is 0 for the ecliptic itself — its node on the equator is the equinox, the reference +x", () => {
    expect(equatorialNodeOffsetDeg({ longitudeDeg: 0, latitudeDeg: 90 })).toBeCloseTo(0, 9)
  })
})

describe('bodyPoleVector', () => {
  it('is straight up with neither pole nor tilt', () => {
    expect(bodyPoleVector(body())).toEqual({ x: 0, y: -0, z: 1 })
  })

  it("uses the axial-tilt fallback in the SAME convention as an orbit's inclination", () => {
    const pole = bodyPoleVector(body({ axialTiltDeg: 26.73 }))
    expect(angleBetweenDeg(pole, orbitNormal({ inclinationDeg: 26.73, longitudeOfAscendingNodeDeg: 0 }))).toBeLessThan(1e-5)
  })

  it('prefers an explicit pole over the tilt', () => {
    const pole = { longitudeDeg: 10, latitudeDeg: 20 }
    expect(bodyPoleVector(body({ axialTiltDeg: 80, pole }))).toEqual(poleVector(pole))
  })
})

describe('ringPlaneQuaternion', () => {
  it('is the identity for an untilted body', () => {
    const q = ringPlaneQuaternion(body())
    expect(q[0]).toBeCloseTo(0, 12)
    expect(q[1]).toBeCloseTo(0, 12)
    expect(q[2]).toBeCloseTo(0, 12)
    expect(q[3]).toBeCloseTo(1, 12)
  })

  it.each([
    { longitudeDeg: 77, latitudeDeg: -8 },
    { longitudeDeg: 200, latitudeDeg: 60 },
    { longitudeDeg: 0, latitudeDeg: -90 },
  ])('turns the ring normal (+Y) onto the render-space pole (%o)', (pole) => {
    const q = ringPlaneQuaternion(body({ pole }))
    expect(Math.hypot(...q)).toBeCloseTo(1, 12)
    const [nx, ny, nz] = rotate(q, [0, 1, 0])
    const p = poleVector(pole)
    expect(nx).toBeCloseTo(p.x, 9)
    expect(ny).toBeCloseTo(p.z, 9)
    expect(nz).toBeCloseTo(p.y, 9)
  })

  // Real, observed bug: rings were tilted by +axialTilt about render X while
  // orbits used the standard element rotation; through the orbital→render
  // axis swap (a mirror) the two came out with opposite signs, so a moon at
  // Saturn's own 26.73° (node 0) drew 53.5° off the ring plane.
  it("draws an axial-tilt-only body's rings in the plane of a moon orbiting at that tilt", () => {
    const tilt = 26.73
    const planet = body({ axialTiltDeg: tilt })
    const orbit = moonOrbit({ inclinationDeg: tilt })
    const a = compressVec(positionAtTime(orbit, new Date('2000-01-01T12:00:00Z')))
    const b = compressVec(positionAtTime(orbit, new Date('2000-01-02T12:00:00Z')))
    const [nx, ny, nz] = rotate(ringPlaneQuaternion(planet), [0, 1, 0])
    expect(planeAngleDeg(renderPlaneNormal(a, b), { x: nx, y: ny, z: nz })).toBeLessThan(1e-6)
  })

  it("draws an explicit-pole body's rings in the plane of an equatorial moon", () => {
    const pole = poleFromEquatorialJ2000(40.589, 83.537)
    const planet = body({ pole })
    const orbit = moonOrbit({ inclinationDeg: 0, longitudeOfAscendingNodeDeg: 40, referencePlanePole: pole })
    const a = compressVec(positionAtTime(orbit, new Date('2000-01-01T12:00:00Z')))
    const b = compressVec(positionAtTime(orbit, new Date('2000-01-02T12:00:00Z')))
    const [nx, ny, nz] = rotate(ringPlaneQuaternion(planet), [0, 1, 0])
    expect(planeAngleDeg(renderPlaneNormal(a, b), { x: nx, y: ny, z: nz })).toBeLessThan(1e-6)
  })
})
