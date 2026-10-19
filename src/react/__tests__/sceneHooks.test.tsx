import { jest } from '@jest/globals'
import { act, renderHook } from '../__test-utils__/render'
import { useSimulationClock } from '../useSimulationClock'
import { ACTION_DEBOUNCE_MS, useActionLog } from '../useActionLog'
import { useSelectionNavigation, type SelectionNavigationOptions } from '../useSelectionNavigation'
import { useStableCallback } from '../useStableCallback'
import { buildSystemIndex } from '../selectionNavigation'
import { MAX_DAYS_PER_SECOND } from '../../timeScale'
import { SOLAR_SYSTEM } from '../../solarSystemData'
import type { ActionLogEntry } from '../../actionLog'
import type { CelestialBody, StarSystemData } from '../../types'

describe('useStableCallback', () => {
  it('keeps one identity while always calling the latest closure', () => {
    let value = 1
    const hook = renderHook(() => {
      const captured = value
      return useStableCallback(() => captured)
    })
    const first = hook.current
    value = 2
    hook.rerender()
    expect(hook.current).toBe(first)
    expect(hook.current()).toBe(2)
    hook.unmount()
  })
})

describe('useSimulationClock', () => {
  it('clamps the initial and later speeds and advances the date', () => {
    const hook = renderHook(() => useSimulationClock(true, 1e9))
    expect(hook.current.playing).toBe(true)
    expect(hook.current.daysPerSecond).toBe(MAX_DAYS_PER_SECOND)
    const start = hook.current.simDate.getTime()
    const advance = hook.current.advance
    act(() => hook.current.advance(1000))
    expect(hook.current.simDate.getTime()).toBe(start + 1000)
    expect(hook.current.simDateRef.current.getTime()).toBe(start + 1000)
    expect(hook.current.advance).toBe(advance)
    act(() => hook.current.setDaysPerSecond(-5))
    expect(hook.current.daysPerSecond).toBeGreaterThan(0)
    hook.unmount()
  })
})

describe('useActionLog', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const simDateRef = { current: new Date('2026-01-01T00:00:00Z') }

  it('stamps entries with the simDate current at EMIT time and the latest onAction', () => {
    const first = jest.fn<(e: ActionLogEntry) => void>()
    const second = jest.fn<(e: ActionLogEntry) => void>()
    let handler = first
    const hook = renderHook(() => useActionLog(handler, simDateRef))
    act(() => hook.current.startSession())
    act(() => hook.current.recordDebounced('set-speed', { type: 'set-speed', daysPerSecond: 3 }))
    act(() => hook.current.recordDebounced('set-speed', { type: 'set-speed', daysPerSecond: 4 }))
    handler = second
    hook.rerender()
    simDateRef.current = new Date('2026-06-01T00:00:00Z')
    act(() => {
      jest.advanceTimersByTime(ACTION_DEBOUNCE_MS)
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    const entry = second.mock.calls[0]![0]
    expect(entry).toMatchObject({ type: 'set-speed', daysPerSecond: 4, simDateISO: '2026-06-01T00:00:00.000Z' })
    hook.unmount()
  })

  it('drops pending debounced entries on unmount instead of firing into a torn-down consumer', () => {
    const onAction = jest.fn<(e: ActionLogEntry) => void>()
    const hook = renderHook(() => useActionLog(onAction, simDateRef))
    act(() => hook.current.recordDebounced('set-zoom', { type: 'set-zoom', sliderPosition: 0.5 }))
    hook.unmount()
    jest.advanceTimersByTime(ACTION_DEBOUNCE_MS * 2)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('is a no-op without an onAction', () => {
    const hook = renderHook(() => useActionLog(undefined, simDateRef))
    expect(() => act(() => hook.current.recordAction({ type: 'play' }))).not.toThrow()
    hook.unmount()
  })
})

describe('useSelectionNavigation', () => {
  function setup(overrides: Partial<SelectionNavigationOptions> = {}, system: StarSystemData = SOLAR_SYSTEM) {
    const recordAction = jest.fn()
    const onSelectBody = jest.fn<(b: CelestialBody) => void>()
    const onSystemChange = jest.fn()
    const index = buildSystemIndex(system)
    const options: SelectionNavigationOptions = {
      system,
      index,
      clock: {
        simDate: new Date('2026-01-01T00:00:00Z'),
        simDateRef: { current: new Date('2026-01-01T00:00:00Z') },
        playing: false,
        daysPerSecond: 1,
        setPlaying: jest.fn(),
        setDaysPerSecond: jest.fn(),
        advance: jest.fn(),
      },
      log: { recordAction, recordDebounced: jest.fn(), startSession: jest.fn() },
      onSelectBody,
      onSystemChange,
      ...overrides,
    }
    const hook = renderHook(() => useSelectionNavigation(options))
    return { hook, recordAction, onSelectBody, onSystemChange, options }
  }

  it('resets to the whole-system framing on mount and reports the system change', () => {
    const { hook, onSystemChange } = setup()
    expect(hook.current.selection).toBeNull()
    expect(hook.current.focus).not.toBeNull()
    expect(onSystemChange).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it('selects from the dropdown, notifies onSelectBody, and navigates up and down the hierarchy', () => {
    const { hook, onSelectBody, recordAction } = setup()
    act(() => hook.current.selectFromDropdown('body:earth'))
    expect(hook.current.selectedBody?.id).toBe('earth')
    expect(onSelectBody).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'earth' }))
    expect(hook.current.canGoUp).toBe(true)
    expect(hook.current.canGoDown).toBe(true)

    act(() => hook.current.goDown())
    expect(hook.current.selectedBody?.parentId).toBe('earth')
    act(() => hook.current.goUp())
    expect(hook.current.selectedBody?.id).toBe('earth')
    act(() => hook.current.reset())
    expect(hook.current.selection).toBeNull()

    const types = recordAction.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(types).toEqual(['select-body', 'select-body', 'down', 'select-body', 'up', 'reset'])
    hook.unmount()
  })

  it('selects belts and ignores malformed or unknown dropdown values', () => {
    const { hook } = setup()
    const beltId = SOLAR_SYSTEM.belts![0]!.id
    act(() => hook.current.selectFromDropdown(`belt:${beltId}`))
    expect(hook.current.selectedBelt?.id).toBe(beltId)
    expect(hook.current.canGoDown).toBe(false)
    act(() => hook.current.selectFromDropdown('body:no-such-body'))
    act(() => hook.current.selectFromDropdown(''))
    expect(hook.current.selectedBelt?.id).toBe(beltId)
    hook.unmount()
  })

  it('flies to an external focus request WITHOUT re-firing onSelectBody', () => {
    const { hook, onSelectBody } = setup({ externalFocus: { bodyId: 'mars', token: 1 } })
    expect(hook.current.selectedBody?.id).toBe('mars')
    expect(onSelectBody).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('arrives framing the body itself, and toggles to its system framing when it is selected again', () => {
    const { hook } = setup()
    act(() => hook.current.selectFromDropdown('body:jupiter'))
    expect(hook.current.framing).toBe('body')
    const bodyDistance = hook.current.focus!.distance
    act(() => hook.current.selectBody(hook.current.selectedBody!))
    expect(hook.current.framing).toBe('system')
    expect(hook.current.selectedBody?.id).toBe('jupiter')
    expect(hook.current.focus!.distance).toBeGreaterThan(bodyDistance * 10)
    // Recenter keeps the framing the user chose.
    act(() => hook.current.recenter())
    expect(hook.current.framing).toBe('system')
    act(() => hook.current.selectBody(hook.current.selectedBody!))
    expect(hook.current.framing).toBe('body')
    expect(hook.current.focus!.distance).toBeCloseTo(bodyDistance, 9)
    // A different body arrives in the arrival framing again.
    act(() => hook.current.selectBody(hook.current.selectedBody!))
    act(() => hook.current.goDown())
    expect(hook.current.framing).toBe('body')
    act(() => hook.current.reset())
    expect(hook.current.framing).toBeNull()
    hook.unmount()
  })

  it("arrives in the moon-system framing with arrivalFraming: 'system'", () => {
    const { hook } = setup({ arrivalFraming: 'system' })
    act(() => hook.current.selectFromDropdown('body:jupiter'))
    expect(hook.current.framing).toBe('system')
    act(() => hook.current.selectBody(hook.current.selectedBody!))
    expect(hook.current.framing).toBe('body')
    hook.unmount()
  })

  it('an external focus request always arrives in the arrival framing, even on the selected body', () => {
    const { hook, options } = setup({ externalFocus: { bodyId: 'mars', token: 1 } })
    act(() => hook.current.selectBody(hook.current.selectedBody!))
    expect(hook.current.framing).toBe('system')
    options.externalFocus = { bodyId: 'mars', token: 2 }
    hook.rerender()
    expect(hook.current.framing).toBe('body')
    hook.unmount()
  })

  it('keeps callback identities stable across renders (memoized children depend on it)', () => {
    const { hook } = setup()
    const { selectBody, goUp, selectFromDropdown } = hook.current
    act(() => hook.current.selectFromDropdown('body:earth'))
    expect(hook.current.selectBody).toBe(selectBody)
    expect(hook.current.goUp).toBe(goUp)
    expect(hook.current.selectFromDropdown).toBe(selectFromDropdown)
    hook.unmount()
  })
})
