import { jest } from '@jest/globals'
import { AU_KM, beltExtentText, bodyRadiusText, bodyTypeLabel, coOrbitalText, formatAu } from '../infoPanelText'
import { describeDataWarning } from '../dataWarningText'
import { MS_PER_DAY, flightTargetDate, simulatedAdvanceMs } from '../simulationTime'
import { createKeyedDebouncer } from '../keyedDebouncer'
import type { BeltRegion, CelestialBody } from '../../types'
import type { SystemDataWarning } from '../../validateSystemData'

const belt: BeltRegion = {
  id: 'trojans',
  name: 'Trojans',
  type: 'belt',
  parentId: 'sun',
  innerRadiusKm: 5 * AU_KM,
  outerRadiusKm: 5.5 * AU_KM,
  inclinationSpreadDeg: 10,
  particleCount: 10,
}
const jupiter: CelestialBody = { id: 'jupiter', name: 'Jupiter', type: 'planet', parentId: 'sun', radiusKm: 69911, orbit: null, fixedPosition: null }

describe('infoPanelText', () => {
  it('formats AU from km', () => {
    expect(formatAu(AU_KM, 3)).toBe('1.000 AU')
  })

  it('humanizes body types', () => {
    expect(bodyTypeLabel('dwarf_planet')).toBe('dwarf planet')
    expect(bodyTypeLabel('surface_installation')).toBe('surface installation')
  })

  it('quotes radius in km for an orbiting system and in scaled units otherwise', () => {
    expect(bodyRadiusText(jupiter, true)).toBe(`radius: ${(69911).toLocaleString()} km`)
    expect(bodyRadiusText(jupiter, false)).toBe('radius: 69.91 Mm')
  })

  it('quotes belt extent in AU or scaled units', () => {
    expect(beltExtentText(belt, true)).toBe('5.00–5.50 AU')
    expect(beltExtentText(belt, false)).toMatch(/Gm–.*Gm$/)
  })

  it('describes co-orbital belts by reference-body name, falling back to its id', () => {
    const coOrbital = { ...belt, coOrbital: { bodyId: 'jupiter', leadAngleDeg: 60, angularSpreadDeg: 30 } }
    expect(coOrbitalText(coOrbital, new Map([['jupiter', jupiter]]))).toBe('co-orbital with Jupiter, +60°')
    expect(coOrbitalText({ ...coOrbital, coOrbital: { ...coOrbital.coOrbital, leadAngleDeg: -60 } }, new Map())).toBe(
      'co-orbital with jupiter, -60°'
    )
    expect(coOrbitalText(belt, new Map())).toBeNull()
  })
})

describe('describeDataWarning', () => {
  it('has a title and detail for every warning kind', () => {
    const warnings: SystemDataWarning[] = [
      { kind: 'missing-position', bodyId: 'x', bodyName: 'X' } as SystemDataWarning,
      { kind: 'unrecognized-type', bodyId: 'x', bodyName: 'X', type: 'blob' } as SystemDataWarning,
      { kind: 'embedded-in-parent', bodyId: 'x', bodyName: 'X', parentName: 'P', distanceKm: 10, parentRadiusKm: 1000 } as SystemDataWarning,
      {
        kind: 'embedded-in-sibling',
        bodyName: 'A',
        otherBodyName: 'B',
        distanceKm: 5,
        bodyRadiusKm: 10,
        otherBodyRadiusKm: 20,
      } as SystemDataWarning,
      { kind: 'invalid-ring', bodyId: 'saturn', message: 'bad ring' } as SystemDataWarning,
      { kind: 'invalid-belt', beltId: 'kuiper', message: 'bad belt' } as SystemDataWarning,
    ]
    const described = warnings.map(describeDataWarning)
    expect(described.map((d) => d.title)).toEqual(['X', 'X', 'X', 'A / B', 'ring on saturn', 'belt kuiper'])
    expect(described[1]!.detail).toBe('unrecognized type "blob"')
    expect(described[2]!.detail).toContain('inside P')
    expect(described[3]!.detail).toContain('apart')
    expect(described.every((d) => d.detail.length > 0)).toBe(true)
  })

  it('describes the hierarchy, orbit and radius warning kinds', () => {
    const warnings: SystemDataWarning[] = [
      { kind: 'unknown-parent', bodyId: 'x', bodyName: 'X', parentId: 'ghost' } as SystemDataWarning,
      { kind: 'parent-cycle', bodyId: 'x', bodyName: 'X', message: 'cycle a → b → a' } as SystemDataWarning,
      { kind: 'invalid-orbit', bodyId: 'x', bodyName: 'X', message: 'period must be > 0' } as SystemDataWarning,
      { kind: 'invalid-radius', bodyId: 'x', bodyName: 'X', radiusKm: 0 } as SystemDataWarning,
      {
        kind: 'periapsis-inside-parent',
        bodyId: 'x',
        bodyName: 'X',
        parentName: 'P',
        distanceKm: 12,
        parentRadiusKm: 6371,
      } as SystemDataWarning,
    ]
    const details = warnings.map((w) => describeDataWarning(w).detail)
    expect(details[0]).toContain('"ghost"')
    expect(details[1]).toBe('cycle a → b → a')
    expect(details[2]).toBe('period must be > 0')
    expect(details[3]).toBe('radius 0 km is not positive')
    expect(details[4]).toContain('inside P')
  })
})

describe('simulationTime', () => {
  it('converts real seconds of playback into simulated ms', () => {
    expect(simulatedAdvanceMs(0.5, 2)).toBe(MS_PER_DAY)
  })

  it('targets "now" while paused and now-plus-flight-duration while playing', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(flightTargetDate(now, false, 10, 900)).toBe(now)
    expect(flightTargetDate(now, true, 1, 1000).getTime()).toBe(now.getTime() + MS_PER_DAY)
  })
})

describe('createKeyedDebouncer', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('runs only the last call per key once the delay passes', () => {
    const debouncer = createKeyedDebouncer()
    const runs: string[] = []
    debouncer.schedule('speed', 300, () => runs.push('speed-1'))
    debouncer.schedule('speed', 300, () => runs.push('speed-2'))
    debouncer.schedule('zoom', 300, () => runs.push('zoom'))
    expect(debouncer.pendingCount).toBe(2)
    jest.advanceTimersByTime(299)
    expect(runs).toEqual([])
    jest.advanceTimersByTime(1)
    expect(runs).toEqual(['speed-2', 'zoom'])
    expect(debouncer.pendingCount).toBe(0)
  })

  it('cancelAll drops every pending run (unmount)', () => {
    const debouncer = createKeyedDebouncer()
    const run = jest.fn()
    debouncer.schedule('a', 100, run)
    debouncer.schedule('b', 100, run)
    debouncer.cancelAll()
    jest.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()
    expect(debouncer.pendingCount).toBe(0)
  })
})
