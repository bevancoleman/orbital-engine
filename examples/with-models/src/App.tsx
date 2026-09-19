import { useState } from 'react'
import { OrbitalSystemScene } from 'orbital-engine/react'
import type { ExternalFocusRequest } from 'orbital-engine/react'
import { SOLAR_SYSTEM } from 'orbital-engine'
import type { CelestialBody } from 'orbital-engine'
import { HAS_REAL_ASSET, SOLAR_SYSTEM_WITH_ASSETS } from './solarSystemWithAssets'

type Mode = 'placeholders' | 'real-assets'

const FLY_TARGETS = [
  { id: 'earth', label: 'Earth' },
  { id: 'moon', label: 'Moon' },
  { id: 'saturn', label: 'Saturn' },
  { id: 'iss', label: 'ISS' },
  { id: 'hubble', label: 'Hubble' },
  { id: 'sun', label: 'Sun (no real asset)' },
]

export function App() {
  const [mode, setMode] = useState<Mode>('real-assets')
  const [selected, setSelected] = useState<CelestialBody | null>(null)
  const [externalFocus, setExternalFocus] = useState<ExternalFocusRequest | null>(null)
  const system = mode === 'real-assets' ? SOLAR_SYSTEM_WITH_ASSETS : SOLAR_SYSTEM

  function switchMode(next: Mode) {
    setMode(next)
    setSelected(null)
    setExternalFocus(null)
  }

  function flyTo(bodyId: string) {
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
      {/* Normal-flow header, not an absolute overlay — see examples/basic's
          identical comment; OrbitalSystemScene has its own top-of-container
          toolbar and an overlay collides with (and intercepts clicks on) it. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, color: '#e2e8f0', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <button onClick={() => switchMode('real-assets')} disabled={mode === 'real-assets'}>
            Real NASA models/textures where available
          </button>
          <button onClick={() => switchMode('placeholders')} disabled={mode === 'placeholders'}>
            Built-in placeholder shapes only
          </button>
          <a href="../" style={{ color: '#22d3ee', marginLeft: 'auto', fontSize: 13 }}>
            ← other example
          </a>
        </div>

        <p style={{ maxWidth: 700, fontSize: 13, opacity: 0.85, margin: 0 }}>
          {mode === 'real-assets'
            ? 'CelestialBody.modelUrl (a real 3D model) and CelestialBody.textureUrl (a real surface photo wrapped around the built-in sphere) are both opt-in per body. 21 of the 30 bodies here have one; the other 9 (Sun, Mercury, Ceres, Vesta, Pallas, Hygiea, Uranus, Eris, and the comet) fall through to the ordinary placeholder shape because no real NASA asset exists for them — that fallback is the same code path this whole scene uses when neither field is set at all.'
            : 'The same SOLAR_SYSTEM data, with modelUrl/textureUrl stripped — everything renders through the built-in placeholder shapes. Compare against the other mode to see exactly what changes.'}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ opacity: 0.7 }}>Fly to:</span>
          {FLY_TARGETS.map((t) => (
            <button key={t.id} onClick={() => flyTo(t.id)}>
              {t.label}
              {mode === 'real-assets' && HAS_REAL_ASSET.has(t.id) ? ' ✓' : ''}
            </button>
          ))}
          {selected && <span style={{ marginLeft: 12, opacity: 0.8 }}>Selected: {selected.name}</span>}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <OrbitalSystemScene key={mode} system={system} onSelectBody={setSelected} externalFocus={externalFocus} />
      </div>
    </div>
  )
}
