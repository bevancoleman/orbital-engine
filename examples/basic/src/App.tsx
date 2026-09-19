import { useState } from 'react'
import { OrbitalSystemScene } from 'orbital-engine/react'
import type { ExternalFocusRequest } from 'orbital-engine/react'
import { SOLAR_SYSTEM } from 'orbital-engine'
import type { CelestialBody } from 'orbital-engine'
import { FICTIONAL_SYSTEM } from './fictionalSystem'

type SystemId = 'solar' | 'fictional'

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
}

const DESCRIPTIONS: Record<SystemId, string> = {
  solar:
    'Real J2000 Keplerian orbital elements — every body actually orbits over time, at its real physical size and real distance. Zoom in on the ISS: it is genuinely smaller than a pixel at Earth-orbit scale, and the pixel-floor system is what keeps it visible at all.',
  fictional:
    'The same component, fed data with NO orbital elements at all — just one known position per body (`fixedPosition`). This is the shape a game world or a one-time survey snapshot takes: real coordinates, no motion. Bodies here sit still; nothing here is simulated or guessed.',
}

export function App() {
  const [systemId, setSystemId] = useState<SystemId>('solar')
  const [selected, setSelected] = useState<CelestialBody | null>(null)
  const [externalFocus, setExternalFocus] = useState<ExternalFocusRequest | null>(null)
  const system = systemId === 'solar' ? SOLAR_SYSTEM : FICTIONAL_SYSTEM

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
    <div style={{ position: 'relative', width: '100%', height: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          color: '#e2e8f0',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <button onClick={() => switchSystem('solar')} disabled={systemId === 'solar'}>
            Real Solar System (Kepler orbits)
          </button>
          <button onClick={() => switchSystem('fictional')} disabled={systemId === 'fictional'}>
            Fictional system (fixed positions)
          </button>
          <a href="./docs/" style={{ color: '#22d3ee', marginLeft: 'auto', fontSize: 13 }}>
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
      </div>

      <OrbitalSystemScene
        key={system.id}
        system={system}
        onSelectBody={setSelected}
        externalFocus={externalFocus}
      />
    </div>
  )
}
