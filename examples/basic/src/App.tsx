import { useState } from 'react'
import { OrbitalSystemScene } from 'orbital-engine/react'
import type { ExternalFocusRequest } from 'orbital-engine/react'
import { SOLAR_SYSTEM, formatActionLog } from 'orbital-engine'
import type { CelestialBody, ActionLogEntry } from 'orbital-engine'
import type { StarSystemData } from 'orbital-engine'
import { FICTIONAL_SYSTEM } from './fictionalSystem'
// Test data from the engine's own repo (not part of the package) — see
// vite.config.ts's server.fs.allow.
import { createSyntheticSystem } from '../../../src/fixtures/syntheticSystem'

type SystemId = 'solar' | 'fictional' | 'synthetic'

// `?system=synthetic-2000` (any count) loads a large generated system for
// checking performance in a browser — thousands of stations, asteroids
// and nav points, orbiting and fixed (see src/fixtures/syntheticSystem.ts).
const SYNTHETIC_COUNT = /^synthetic-(\d+)$/.exec(new URLSearchParams(window.location.search).get('system') ?? '')?.[1]
const SYNTHETIC_SYSTEM: StarSystemData | null = SYNTHETIC_COUNT ? createSyntheticSystem(Math.min(Number(SYNTHETIC_COUNT), 50_000)) : null

// A handful of bodies worth flying straight to, per system — demonstrates
// the externalFocus prop (a body id + a token that must change on every
// request, even a repeat of the same id, so clicking the same button twice
// still re-flies the camera there rather than being a no-op).
const FLY_TARGETS: Record<SystemId, { id: string; label: string }[]> = {
  solar: [
    { id: 'earth', label: 'Earth' },
    { id: 'iss', label: 'ISS (true scale — try it!)' },
    { id: 'mars', label: 'Mars' },
    { id: 'jupiter', label: 'Jupiter' },
  ],
  fictional: [
    { id: 'planet-1', label: 'Aurum' },
    { id: 'station-1', label: 'Aurum High Station' },
    { id: 'jump-point-1', label: 'Outbound Gateway' },
  ],
  synthetic: [
    { id: 'planet-1', label: 'Planet 1' },
    { id: 'planet-5', label: 'Planet 5' },
  ],
}

const DESCRIPTIONS: Record<SystemId, string> = {
  solar:
    'J2000 Keplerian orbital elements. Every body orbits over time, at its actual physical size and distance. Try flying to the ISS — it\'s smaller than a pixel at Earth-orbit scale, which is what the pixel-floor system is for.',
  fictional:
    'Same component, different input: no orbital elements at all, just one fixedPosition per body. This is the shape a game world or a one-off survey takes — coordinates with no motion, nothing simulated.',
  synthetic:
    'A generated system with thousands of bodies — nested moons, stations, asteroids, nav points and surface installations, orbiting and fixed — for checking that a large game-data system stays fast. The dev overlay shows the draw calls.',
}

export function App() {
  const [systemId, setSystemId] = useState<SystemId>(SYNTHETIC_SYSTEM ? 'synthetic' : 'solar')
  const [selected, setSelected] = useState<CelestialBody | null>(null)
  const [externalFocus, setExternalFocus] = useState<ExternalFocusRequest | null>(null)
  const [lightFromStar, setLightFromStar] = useState(false)
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([])
  const system = systemId === 'synthetic' && SYNTHETIC_SYSTEM ? SYNTHETIC_SYSTEM : systemId === 'fictional' ? FICTIONAL_SYSTEM : SOLAR_SYSTEM

  function switchSystem(next: SystemId) {
    setSystemId(next)
    setSelected(null)
    setExternalFocus(null)
  }

  function flyTo(bodyId: string) {
    // token: Date.now() — see FLY_TARGETS comment above for why this can't
    // just be the bodyId alone.
    setExternalFocus({ bodyId, token: Date.now() })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* A normal-flow header above the canvas, not an absolute overlay —
          OrbitalSystemScene renders its own toolbar at the top of ITS OWN
          container, so overlaying this on top of it visually collided with
          (and intercepted clicks on) the engine's own Up/Down/Recenter/Reset
          buttons. Giving the header real layout height instead means the
          two toolbars never share the same space. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, color: '#e2e8f0', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <button onClick={() => switchSystem('solar')} disabled={systemId === 'solar'}>
            Real Solar System (Kepler orbits)
          </button>
          <button onClick={() => switchSystem('fictional')} disabled={systemId === 'fictional'}>
            Fictional system (fixed positions)
          </button>
          {SYNTHETIC_SYSTEM && (
            <button onClick={() => switchSystem('synthetic')} disabled={systemId === 'synthetic'}>
              {SYNTHETIC_SYSTEM.name}
            </button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 13 }}>
            <input type="checkbox" checked={lightFromStar} onChange={(e) => setLightFromStar(e.target.checked)} />
            Light from star (real day/night)
          </label>
          <a href="./with-models/" style={{ color: '#22d3ee', fontSize: 13 }}>
            Real NASA models/textures example →
          </a>
          <a href="./docs/" style={{ color: '#22d3ee', fontSize: 13 }}>
            API reference →
          </a>
        </div>

        <p style={{ maxWidth: 640, fontSize: 13, opacity: 0.85, margin: 0 }}>{DESCRIPTIONS[systemId]}</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ opacity: 0.7 }}>Fly to:</span>
          {FLY_TARGETS[systemId].map((t) => (
            <button key={t.id} onClick={() => flyTo(t.id)}>
              {t.label}
            </button>
          ))}
          {selected && <span style={{ marginLeft: 12, opacity: 0.8 }}>Selected: {selected.name}</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="action-log" style={{ fontSize: 12, opacity: 0.7 }}>
              Action log
            </label>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(formatActionLog(actionLog))
              }}
              style={{ fontSize: 12 }}
            >
              Copy Action Log
            </button>
          </div>
          <textarea
            id="action-log"
            aria-label="Action log"
            readOnly
            value={formatActionLog(actionLog)}
            rows={5}
            style={{
              width: '100%',
              maxWidth: 640,
              fontFamily: 'monospace',
              fontSize: 11,
              resize: 'vertical',
              background: '#0f172a',
              color: '#e2e8f0',
              border: '1px solid #334155',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <OrbitalSystemScene
          key={system.id}
          system={system}
          onSelectBody={setSelected}
          externalFocus={externalFocus}
          lightFromStar={lightFromStar}
          onAction={(entry) => setActionLog((prev) => [...prev, entry])}
          devMode
        />
      </div>
    </div>
  )
}
