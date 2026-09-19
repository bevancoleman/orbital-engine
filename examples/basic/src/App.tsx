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
    'J2000 Keplerian orbital elements. Every body orbits over time, at its actual physical size and distance. Try flying to the ISS — it\'s smaller than a pixel at Earth-orbit scale, which is what the pixel-floor system is for.',
  fictional:
    'Same component, different input: no orbital elements at all, just one fixedPosition per body. This is the shape a game world or a one-off survey takes — coordinates with no motion, nothing simulated.',
}

export function App() {
  const [systemId, setSystemId] = useState<SystemId>('solar')
  const [selected, setSelected] = useState<CelestialBody | null>(null)
  const [externalFocus, setExternalFocus] = useState<ExternalFocusRequest | null>(null)
  const [lightFromStar, setLightFromStar] = useState(false)
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
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <OrbitalSystemScene
          key={system.id}
          system={system}
          onSelectBody={setSelected}
          externalFocus={externalFocus}
          lightFromStar={lightFromStar}
        />
      </div>
    </div>
  )
}
