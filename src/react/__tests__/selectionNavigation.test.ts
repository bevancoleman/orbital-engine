import {
  buildSystemIndex,
  childTarget,
  parentTarget,
  parseSelectionValue,
  resolveSelection,
  selectionValue,
} from '../selectionNavigation'
import type { StarSystemData } from '../../types'

const system: StarSystemData = {
  id: 'sys',
  name: 'Test system',
  bodies: [
    { id: 'sun', name: 'Sun', type: 'star', parentId: null, radiusKm: 700000, orbit: null, fixedPosition: null },
    { id: 'earth', name: 'Earth', type: 'planet', parentId: 'sun', radiusKm: 6371, fixedPosition: { xKm: 1.5e8, yKm: 0, zKm: 0 }, orbit: null },
    { id: 'moon', name: 'Moon', type: 'moon', parentId: 'earth', radiusKm: 1737, fixedPosition: { xKm: 384000, yKm: 0, zKm: 0 }, orbit: null },
    { id: 'stanton:arc-l1', name: 'ARC-L1', type: 'station', parentId: 'earth', radiusKm: 1, fixedPosition: { xKm: 1e6, yKm: 0, zKm: 0 }, orbit: null },
  ],
  belts: [{ id: 'belt:main', name: 'Main belt', type: 'belt', parentId: 'sun', innerRadiusKm: 3e8, outerRadiusKm: 4.5e8, inclinationSpreadDeg: 10, particleCount: 10 }],
}

describe('selectionValue / parseSelectionValue', () => {
  it('round-trips, including ids that themselves contain ":"', () => {
    for (const selection of [
      { kind: 'body' as const, id: 'earth' },
      { kind: 'body' as const, id: 'stanton:arc-l1' },
      { kind: 'belt' as const, id: 'belt:main' },
    ]) {
      expect(parseSelectionValue(selectionValue(selection))).toEqual(selection)
    }
  })

  it('maps no selection to the empty placeholder value and back', () => {
    expect(selectionValue(null)).toBe('')
    expect(parseSelectionValue('')).toBeNull()
  })

  it('rejects malformed values', () => {
    expect(parseSelectionValue('earth')).toBeNull()
    expect(parseSelectionValue(':earth')).toBeNull()
    expect(parseSelectionValue('body:')).toBeNull()
    expect(parseSelectionValue('comet:halley')).toBeNull()
  })
})

describe('buildSystemIndex / resolveSelection', () => {
  const index = buildSystemIndex(system)

  it('indexes bodies, belts and each body’s first child', () => {
    expect(index.bodiesById.get('moon')?.name).toBe('Moon')
    expect(index.beltsById.get('belt:main')?.name).toBe('Main belt')
    expect(index.firstChildById.get('earth')?.id).toBe('moon')
    expect(index.firstChildById.get('sun')?.id).toBe('earth')
    expect(index.firstChildById.has('moon')).toBe(false)
  })

  it('handles a system with no belts', () => {
    expect(buildSystemIndex({ ...system, belts: undefined }).beltsById.size).toBe(0)
  })

  it('resolves a selection to its body or belt, and unknown ids to nothing', () => {
    expect(resolveSelection({ kind: 'body', id: 'earth' }, index).selectedBody?.id).toBe('earth')
    expect(resolveSelection({ kind: 'belt', id: 'belt:main' }, index).selectedBelt?.id).toBe('belt:main')
    expect(resolveSelection({ kind: 'body', id: 'pluto' }, index)).toEqual({ selectedBody: null, selectedBelt: null })
    expect(resolveSelection(null, index)).toEqual({ selectedBody: null, selectedBelt: null })
  })
})

describe('parentTarget / childTarget', () => {
  const index = buildSystemIndex(system)
  const at = (selection: Parameters<typeof resolveSelection>[0]) => resolveSelection(selection, index)

  it('goes up from a moon to its planet, and from a belt to its parent body', () => {
    expect(parentTarget(at({ kind: 'body', id: 'moon' }), index)?.id).toBe('earth')
    expect(parentTarget(at({ kind: 'belt', id: 'belt:main' }), index)?.id).toBe('sun')
  })

  it('has nowhere to go up from the star, or with nothing selected', () => {
    expect(parentTarget(at({ kind: 'body', id: 'sun' }), index)).toBeNull()
    expect(parentTarget(at(null), index)).toBeNull()
  })

  it('goes down to the first child in dataset order', () => {
    expect(childTarget(at({ kind: 'body', id: 'earth' }), index)?.id).toBe('moon')
  })

  it('has nowhere to go down from a childless body or a belt', () => {
    expect(childTarget(at({ kind: 'body', id: 'moon' }), index)).toBeNull()
    expect(childTarget(at({ kind: 'belt', id: 'belt:main' }), index)).toBeNull()
  })
})
