import { resolveAllTruePositionsKm, trueOffsetKm } from '../truePositions'
import { resolveAllWorldPositions } from '../render'
import { SOLAR_SYSTEM } from '../solarSystemData'
import { positionAtTime } from '../kepler'
import type { WorldVec } from '../render'
import type { CelestialBody } from '../types'
import { lengthVec3, subtractVec3 } from '../vec3'

const DATE = new Date('2026-10-20T00:00:00Z')

function find(id: string): CelestialBody {
  return SOLAR_SYSTEM.bodies.find((b) => b.id === id)!
}

function unit(v: WorldVec): WorldVec {
  const l = lengthVec3(v)
  return [v[0] / l, v[1] / l, v[2] / l]
}

describe('trueOffsetKm', () => {
  it('is the Kepler position in render axes (orbital z becomes y)', () => {
    const earth = find('earth')
    const p = positionAtTime(earth.orbit!, DATE)
    expect(trueOffsetKm(earth, DATE)).toEqual([p.x, p.z, p.y])
  })

  it('is a fixed body\'s own offset, swapped the same way, and zero with no position data', () => {
    const fixed: CelestialBody = { id: 'f', name: 'F', type: 'station', parentId: 'sun', radiusKm: 1, orbit: null, fixedPosition: { xKm: 1, yKm: 2, zKm: 3 } }
    expect(trueOffsetKm(fixed, DATE)).toEqual([1, 3, 2])
    expect(trueOffsetKm(find('sun'), DATE)).toEqual([0, 0, 0])
  })
})

describe('resolveAllTruePositionsKm', () => {
  const truePositions = resolveAllTruePositionsKm(SOLAR_SYSTEM, DATE)
  const world = resolveAllWorldPositions(SOLAR_SYSTEM, DATE)

  it('puts the Earth about 1 AU from the Sun and the Moon ~384,000 km from the Earth', () => {
    const earth = truePositions.get('earth')!
    expect(lengthVec3(earth) / 149_597_870.7).toBeGreaterThan(0.98)
    expect(lengthVec3(earth) / 149_597_870.7).toBeLessThan(1.02)
    const moonFromEarth = lengthVec3(subtractVec3(truePositions.get('moon')!, earth))
    expect(moonFromEarth).toBeGreaterThan(356_000)
    expect(moonFromEarth).toBeLessThan(407_000)
  })

  it('keeps every parent→child direction the compressed world positions have (only lengths differ)', () => {
    for (const body of SOLAR_SYSTEM.bodies) {
      if (!body.parentId || !body.orbit) continue
      const trueOffset = subtractVec3(truePositions.get(body.id)!, truePositions.get(body.parentId)!)
      const worldOffset = subtractVec3(world.get(body.id)!, world.get(body.parentId)!)
      const [a, b] = [unit(trueOffset), unit(worldOffset)]
      for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, 9)
    }
  })
})
