import type { ComponentRef } from 'react'
import { jest } from '@jest/globals'
import { act, byText, render } from '../__test-utils__/render'
import { Toolbar, type ToolbarProps } from '../Toolbar'
import { TimeBar } from '../TimeBar'
import { BeltInfoPanel, BodyInfoPanel } from '../InfoPanel'
import { DevPerfPanel } from '../DevPerfPanel'
import { createSceneInteractionStore } from '../sceneInteractionStore'
import { SOLAR_SYSTEM } from '../../solarSystemData'
import type { StarSystemData } from '../../types'

const system: StarSystemData = {
  id: 'sys',
  name: 'Test',
  bodies: [
    { id: 'sun', name: 'Sun', type: 'star', parentId: null, radiusKm: 700000, orbit: null, fixedPosition: null },
    { id: 'st:a', name: 'Alpha Station', type: 'station', parentId: 'sun', radiusKm: 1, orbit: null, fixedPosition: { xKm: 1e6, yKm: 0, zKm: 0 } },
  ],
  belts: [{ id: 'b', name: 'Belt', type: 'belt', parentId: 'sun', innerRadiusKm: 1e8, outerRadiusKm: 2e8, inclinationSpreadDeg: 5, particleCount: 10 }],
}

function toolbarProps(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    system,
    selection: null,
    canGoUp: false,
    canGoDown: true,
    zoomSliderPosition: 0.5,
    onSelectValue: jest.fn(),
    onUp: jest.fn(),
    onDown: jest.fn(),
    onRecenter: jest.fn(),
    onReset: jest.fn(),
    onZoomSliderChange: jest.fn(),
    ...overrides,
  }
}

function changeValue(input: ComponentRef<'input'> | ComponentRef<'select'>, value: string): void {
  const proto = input instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
  input.dispatchEvent(new window.Event(input instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

describe('Toolbar', () => {
  it('lists bodies and belts in a named dropdown, and reports the picked value (ids with ":" intact)', () => {
    const props = toolbarProps()
    const view = render(<Toolbar {...props} />)
    const select = view.container.querySelector('select')!
    expect(select.getAttribute('aria-label')).toBe('Select an object')
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.value)).toEqual(['', 'body:sun', 'body:st:a', 'belt:b'])
    act(() => changeValue(select, 'body:st:a'))
    expect(props.onSelectValue).toHaveBeenCalledWith('body:st:a')
    view.unmount()
  })

  it('keeps the exact button names the e2e suite selects by, and disables what can’t be done', () => {
    const props = toolbarProps()
    const view = render(<Toolbar {...props} />)
    const button = (name: string) => byText<ComponentRef<'button'>>(view.container, name, 'button')[0]!
    expect(button('↑ Up').disabled).toBe(true)
    expect(button('↓ Down').disabled).toBe(false)
    expect(button('⟲ Recenter').disabled).toBe(true)
    act(() => button('↓ Down').click())
    act(() => button('Reset').click())
    expect(props.onDown).toHaveBeenCalledTimes(1)
    expect(props.onReset).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('maps the zoom slider to [0, 1]', () => {
    const props = toolbarProps({ zoomSliderPosition: 0.25 })
    const view = render(<Toolbar {...props} />)
    const slider = view.container.querySelector<ComponentRef<'input'>>('input[type=range][title^="Zoom"]')!
    expect(slider.value).toBe('250')
    act(() => changeValue(slider, '700'))
    expect(props.onZoomSliderChange).toHaveBeenCalledWith(0.7)
    view.unmount()
  })
})

describe('TimeBar', () => {
  it('shows Play/Pause, the speed and the date, and reports changes', () => {
    const onToggle = jest.fn()
    const onSpeed = jest.fn<(n: number) => void>()
    const view = render(
      <TimeBar simDate={new Date('2026-03-04T12:00:00Z')} playing={false} daysPerSecond={1} onTogglePlaying={onToggle} onSpeedChange={onSpeed} />
    )
    expect(byText(view.container, 'Play', 'button')).toHaveLength(1)
    expect(view.container.textContent).toContain('2026-03-04')
    act(() => byText<ComponentRef<'button'>>(view.container, 'Play', 'button')[0]!.click())
    expect(onToggle).toHaveBeenCalled()
    const slider = view.container.querySelector<ComponentRef<'input'>>('label input[type=range]')!
    act(() => changeValue(slider, '0'))
    expect(onSpeed).toHaveBeenCalledTimes(1)
    expect(onSpeed.mock.calls[0]![0]).toBeLessThan(1)
    view.unmount()
  })
})

describe('info panels', () => {
  it('shows real Kepler elements for an orbiting body', () => {
    const earth = SOLAR_SYSTEM.bodies.find((b) => b.id === 'earth')!
    const view = render(<BodyInfoPanel body={earth} hasOrbitalMotion />)
    const panel = view.container.firstElementChild!
    expect(panel.getAttribute('aria-live')).toBe('polite')
    const lines = Array.from(panel.children).map((c) => c.textContent)
    expect(lines[0]).toBe('Earth')
    expect(lines.some((t) => /^a: 1\.000 AU$/.test(t ?? ''))).toBe(true)
    expect(lines.some((t) => /^e: /.test(t ?? ''))).toBe(true)
    expect(lines.some((t) => /^period: /.test(t ?? ''))).toBe(true)
    view.unmount()
  })

  it('omits orbital elements for a fixed-position body and shows its note/wiki footer', () => {
    const body = { ...system.bodies[1]!, note: 'A snapshot position', wikiSummary: 'Summary', wikiUrl: 'https://example.org/a' }
    const view = render(<BodyInfoPanel body={body} hasOrbitalMotion={false} />)
    expect(view.container.textContent).not.toMatch(/a: /)
    expect(view.container.textContent).toContain('A snapshot position')
    expect(view.container.querySelector('a')!.getAttribute('href')).toBe('https://example.org/a')
    view.unmount()
  })

  it('shows a belt’s extent and co-orbital reference', () => {
    const belt = { ...system.belts![0]!, coOrbital: { bodyId: 'sun', leadAngleDeg: 60, angularSpreadDeg: 20 } }
    const bodiesById = new Map(system.bodies.map((b) => [b.id, b]))
    const view = render(<BeltInfoPanel belt={belt} hasOrbitalMotion={false} bodiesById={bodiesById} />)
    expect(view.container.textContent).toContain('co-orbital with Sun, +60°')
    view.unmount()
  })
})

describe('DevPerfPanel', () => {
  it('reads object counts and the hovered body’s LOD from the interaction store', () => {
    const interaction = createSceneInteractionStore()
    const bodiesById = new Map(system.bodies.map((b) => [b.id, b]))
    const view = render(
      <DevPerfPanel
        stats={null}
        system={system}
        bodiesById={bodiesById}
        selectedBody={null}
        cameraDistance={100}
        dataWarnings={[{ kind: 'invalid-belt', beltId: 'b', message: 'bad' } as never]}
        interaction={interaction}
      />
    )
    expect(view.container.textContent).toContain('DATA WARNINGS (1)')
    act(() => {
      interaction.setVisibleBodyIds(new Set(['sun']))
      interaction.setHoveredId('sun')
    })
    const shown = byText(view.container, 'bodies shown', 'span')[0]!.nextElementSibling!.textContent
    expect(shown).toBe('1')
    expect(byText(view.container, 'LOD', 'div')).toHaveLength(1)
    expect(byText(view.container, 'Sun', 'span')).toHaveLength(1)
    view.unmount()
  })
})
