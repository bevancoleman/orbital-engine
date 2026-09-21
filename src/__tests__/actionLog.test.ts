import { formatActionLog, formatActionLogEntry, type ActionLogEntry } from '../actionLog'

describe('formatActionLogEntry', () => {
  it('formats session-start with its full payload', () => {
    const entry: ActionLogEntry = {
      type: 'session-start',
      atMs: 0,
      simDateISO: '2026-09-21T12:00:00.000Z',
      systemId: 'solar',
      initialPlaying: false,
      initialDaysPerSecond: 1,
    }
    expect(formatActionLogEntry(entry)).toBe(
      '+0ms session-start {"systemId":"solar","initialPlaying":false,"initialDaysPerSecond":1} @2026-09-21T12:00:00.000Z'
    )
  })

  it('formats select-body with its bodyId payload', () => {
    const entry: ActionLogEntry = {
      type: 'select-body',
      atMs: 1500,
      simDateISO: '2026-09-21T12:00:01.500Z',
      bodyId: 'iss',
    }
    expect(formatActionLogEntry(entry)).toBe('+1500ms select-body {"bodyId":"iss"} @2026-09-21T12:00:01.500Z')
  })

  it('formats select-belt with its beltId payload', () => {
    const entry: ActionLogEntry = {
      type: 'select-belt',
      atMs: 2000,
      simDateISO: '2026-09-21T12:00:02.000Z',
      beltId: 'main-belt',
    }
    expect(formatActionLogEntry(entry)).toBe('+2000ms select-belt {"beltId":"main-belt"} @2026-09-21T12:00:02.000Z')
  })

  it('formats up with no payload braces', () => {
    const entry: ActionLogEntry = { type: 'up', atMs: 100, simDateISO: '2026-09-21T12:00:00.100Z' }
    expect(formatActionLogEntry(entry)).toBe('+100ms up @2026-09-21T12:00:00.100Z')
  })

  it('formats down with no payload braces', () => {
    const entry: ActionLogEntry = { type: 'down', atMs: 200, simDateISO: '2026-09-21T12:00:00.200Z' }
    expect(formatActionLogEntry(entry)).toBe('+200ms down @2026-09-21T12:00:00.200Z')
  })

  it('formats recenter with no payload braces', () => {
    const entry: ActionLogEntry = { type: 'recenter', atMs: 300, simDateISO: '2026-09-21T12:00:00.300Z' }
    expect(formatActionLogEntry(entry)).toBe('+300ms recenter @2026-09-21T12:00:00.300Z')
  })

  it('formats reset with no payload braces', () => {
    const entry: ActionLogEntry = { type: 'reset', atMs: 400, simDateISO: '2026-09-21T12:00:00.400Z' }
    expect(formatActionLogEntry(entry)).toBe('+400ms reset @2026-09-21T12:00:00.400Z')
  })

  it('formats play with no payload braces', () => {
    const entry: ActionLogEntry = { type: 'play', atMs: 2700, simDateISO: '2026-09-21T12:00:02.700Z' }
    expect(formatActionLogEntry(entry)).toBe('+2700ms play @2026-09-21T12:00:02.700Z')
  })

  it('formats pause with no payload braces', () => {
    const entry: ActionLogEntry = { type: 'pause', atMs: 2750, simDateISO: '2026-09-21T12:00:02.750Z' }
    expect(formatActionLogEntry(entry)).toBe('+2750ms pause @2026-09-21T12:00:02.750Z')
  })

  it('formats set-speed with its daysPerSecond payload', () => {
    const entry: ActionLogEntry = {
      type: 'set-speed',
      atMs: 5000,
      simDateISO: '2026-09-21T12:00:05.000Z',
      daysPerSecond: 6.09,
    }
    expect(formatActionLogEntry(entry)).toBe('+5000ms set-speed {"daysPerSecond":6.09} @2026-09-21T12:00:05.000Z')
  })

  it('formats set-zoom with its sliderPosition payload', () => {
    const entry: ActionLogEntry = {
      type: 'set-zoom',
      atMs: 6200,
      simDateISO: '2026-09-21T12:00:06.200Z',
      sliderPosition: 0.42,
    }
    expect(formatActionLogEntry(entry)).toBe('+6200ms set-zoom {"sliderPosition":0.42} @2026-09-21T12:00:06.200Z')
  })
})

describe('formatActionLog', () => {
  it('joins multiple entries with newlines, preserving order', () => {
    const entries: ActionLogEntry[] = [
      {
        type: 'session-start',
        atMs: 0,
        simDateISO: '2026-09-21T12:00:00.000Z',
        systemId: 'solar',
        initialPlaying: false,
        initialDaysPerSecond: 1,
      },
      { type: 'select-body', atMs: 1500, simDateISO: '2026-09-21T12:00:01.500Z', bodyId: 'iss' },
      { type: 'pause', atMs: 2750, simDateISO: '2026-09-21T12:00:02.750Z' },
    ]
    expect(formatActionLog(entries)).toBe(
      [
        '+0ms session-start {"systemId":"solar","initialPlaying":false,"initialDaysPerSecond":1} @2026-09-21T12:00:00.000Z',
        '+1500ms select-body {"bodyId":"iss"} @2026-09-21T12:00:01.500Z',
        '+2750ms pause @2026-09-21T12:00:02.750Z',
      ].join('\n')
    )
  })

  it('returns an empty string for an empty log', () => {
    expect(formatActionLog([])).toBe('')
  })

  it('formats a single-entry log the same as formatActionLogEntry alone', () => {
    const entry: ActionLogEntry = { type: 'reset', atMs: 400, simDateISO: '2026-09-21T12:00:00.400Z' }
    expect(formatActionLog([entry])).toBe(formatActionLogEntry(entry))
  })
})
