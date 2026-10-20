import {
  ACTIVITY_ONSET_AU,
  DUST_BETAS,
  FULL_ACTIVITY_AU,
  ION_TAIL_LENGTH_AT_1AU_KM,
  SOLAR_WIND_SPEED_KM_S,
  cometActivity,
  cometTailGeometry,
  gravitationalParameter,
  ionTailAberration,
  ionTailDirection,
  ionTailLengthKm,
  stateAt,
} from '../comets'
import { SOLAR_SYSTEM } from '../solarSystemData'
import { AU_KM } from '../constants'
import type { WorldVec } from '../render'
import { crossVec3, dotVec3, lengthVec3, normalizeOr } from '../vec3'

function last<T>(items: readonly T[]): T {
  return items[items.length - 1]!
}

const HALLEY = SOLAR_SYSTEM.bodies.find((b) => b.id === 'halley')!.orbit!
const PERIHELION = new Date('1986-02-09T00:00:00Z')
/** Halley in October 2026: ~34 AU out, just past aphelion. */
const FAR = new Date('2026-10-20T00:00:00Z')

describe('cometActivity', () => {
  it('is fully on inside 3 AU, off beyond 5 AU, and ramps smoothly between', () => {
    expect(cometActivity(0.5)).toBe(1)
    expect(cometActivity(FULL_ACTIVITY_AU)).toBe(1)
    expect(cometActivity(ACTIVITY_ONSET_AU)).toBe(0)
    expect(cometActivity(30)).toBe(0)
    let previous = 2
    for (let r = 3; r <= 5; r += 0.1) {
      const a = cometActivity(r)
      expect(a).toBeLessThanOrEqual(previous)
      previous = a
    }
    expect(cometActivity(4)).toBeCloseTo(0.5, 6)
  })

  it('treats a nonsensical distance as inactive', () => {
    expect(cometActivity(Number.NaN)).toBe(0)
    expect(cometActivity(-1)).toBe(0)
  })
})

describe('ionTailLengthKm', () => {
  it('is the 1 AU heuristic at 1 AU, longer nearer the star, gone beyond the onset distance', () => {
    expect(ionTailLengthKm(1)).toBe(ION_TAIL_LENGTH_AT_1AU_KM)
    expect(ionTailLengthKm(0.6)).toBeGreaterThan(ionTailLengthKm(1))
    expect(ionTailLengthKm(0.01)).toBe(ionTailLengthKm(0.3))
    expect(ionTailLengthKm(6)).toBe(0)
  })
})

describe('ionTailDirection', () => {
  it('points straight away from the star for a comet at rest', () => {
    expect(ionTailDirection([1, 0, 0], [0, 0, 0])).toEqual([1, 0, 0])
  })

  it('tilts back against the comet\'s motion by the aberration angle atan(v / v_wind)', () => {
    const v = 50
    const direction = ionTailDirection([1, 0, 0], [0, 0, v])
    expect(direction[2]).toBeLessThan(0)
    const angle = ionTailAberration({ starToComet: [1, 0, 0], ionDirection: direction })
    expect(angle).toBeCloseTo(Math.atan(v / SOLAR_WIND_SPEED_KM_S), 9)
  })

  it('falls back to anti-star when the wind and comet velocity cancel', () => {
    expect(ionTailDirection([1, 0, 0], [400, 0, 0])).toEqual([1, 0, 0])
  })
})

describe('gravitationalParameter', () => {
  it('recovers the Sun\'s real GM (1.32712×10¹¹ km³/s²) from Halley\'s own orbit', () => {
    expect(gravitationalParameter(HALLEY) / 1.32712440018e11).toBeCloseTo(1, 2)
  })
})

describe('stateAt', () => {
  it('puts Halley at its perihelion distance a(1 − e) with the vis-viva speed there', () => {
    const { position, velocity } = stateAt(HALLEY, PERIHELION.getTime())
    expect(lengthVec3(position) / HALLEY.semiMajorAxisKm).toBeCloseTo(1 - HALLEY.eccentricity, 4)
    expect(lengthVec3(position) / AU_KM).toBeLessThan(0.6)
    const mu = gravitationalParameter(HALLEY)
    const visViva = Math.sqrt(mu * (2 / lengthVec3(position) - 1 / HALLEY.semiMajorAxisKm))
    expect(lengthVec3(velocity) / visViva).toBeCloseTo(1, 3)
  })
})

describe('cometTailGeometry', () => {
  it('has no tail, coma or dust far from the star', () => {
    const far = cometTailGeometry(HALLEY, FAR)
    expect(far.distanceAu).toBeGreaterThan(30)
    expect(far.activity).toBe(0)
    expect(far.ionLengthKm).toBe(0)
    expect(far.comaRadiusKm).toBe(0)
    expect(far.dust).toEqual([])
  })

  const near = cometTailGeometry(HALLEY, PERIHELION)
  const { velocity } = stateAt(HALLEY, PERIHELION.getTime())
  const along = normalizeOr(velocity, [1, 0, 0])

  it('near perihelion: fully active, a 10⁷-km-scale ion tail pointing (almost) away from the Sun', () => {
    expect(near.activity).toBe(1)
    expect(near.ionLengthKm).toBeGreaterThan(1e7)
    expect(near.ionLengthKm).toBeLessThan(1e8)
    expect(dotVec3(near.ionDirection, near.starToComet)).toBeGreaterThan(Math.cos((10 * Math.PI) / 180))
    // ~54.5 km/s against a 400 km/s wind: ~7.8°.
    expect(ionTailAberration(near)).toBeCloseTo(Math.atan(54.5 / 400), 2)
    // ...tilted back against the direction of motion.
    expect(dotVec3(near.ionDirection, along)).toBeLessThan(0)
  })

  it('draws one dust curve per β, starting at the nucleus', () => {
    expect(near.dust.map((t) => t.beta)).toEqual([...DUST_BETAS])
    for (const track of near.dust) {
      expect(track.points[0]).toEqual([0, 0, 0])
      expect(track.points).toHaveLength(20)
      expect(track.agesDays[track.agesDays.length - 1]).toBe(30)
      expect(track.weights[track.weights.length - 1]).toBe(0)
      expect(track.widthsKm[0]).toBe(near.comaRadiusKm)
    }
  })

  it('pushes dust away from the Sun and curves it behind the orbit, more for higher β', () => {
    const tip = (beta: number): WorldVec => last(near.dust.find((t) => t.beta === beta)!.points)
    for (const beta of DUST_BETAS) {
      const p = tip(beta)
      expect(dotVec3(p, near.starToComet)).toBeGreaterThan(0)
      // Trailing the motion: the curve bends opposite the velocity.
      expect(dotVec3(p, along)).toBeLessThan(0)
    }
    expect(lengthVec3(tip(1))).toBeGreaterThan(lengthVec3(tip(0.4)))
    expect(lengthVec3(tip(0.4))).toBeGreaterThan(lengthVec3(tip(0.15)))
    // Dust curves away from the straight ion tail: a real angle between them.
    const dustDirection = normalizeOr(tip(0.4), [1, 0, 0])
    const angle = Math.atan2(lengthVec3(crossVec3(dustDirection, near.ionDirection)), dotVec3(dustDirection, near.ionDirection))
    expect(angle).toBeGreaterThan((5 * Math.PI) / 180)
  })

  it('makes a dust tail of plausible true scale: ~10⁷ km after a month at perihelion', () => {
    const tip = last(near.dust.find((t) => t.beta === 0.4)!.points)
    expect(lengthVec3(tip)).toBeGreaterThan(3e6)
    expect(lengthVec3(tip)).toBeLessThan(1e8)
  })

  it('a grain with β = 0 is just the nucleus — the integrator\'s error cancels', () => {
    // Not exposed directly; the two smallest-β tips scale ~linearly with β
    // for a short tail, so extrapolating to β = 0 should land near zero.
    const short = cometTailGeometry(HALLEY, PERIHELION, { dustSamples: 2, stepDays: 0.25 })
    const [a, b] = short.dust
    const ra = lengthVec3(a!.points[1]!)
    const rb = lengthVec3(b!.points[1]!)
    const intercept = ra - (rb - ra) * (a!.beta / (b!.beta - a!.beta))
    expect(Math.abs(intercept)).toBeLessThan(0.1 * ra)
  })

  it('a tail shrinks as the comet recedes: shorter at 2.5 AU than at perihelion', () => {
    // Halley crossed ~2.5 AU outbound around mid-1986's end.
    const later = cometTailGeometry(HALLEY, new Date('1987-01-01T00:00:00Z'))
    expect(later.distanceAu).toBeGreaterThan(2)
    expect(later.ionLengthKm).toBeLessThan(near.ionLengthKm)
  })
})
