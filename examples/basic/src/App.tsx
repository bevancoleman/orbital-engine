import { useState } from 'react'
import { OrbitalSystemScene, SOLAR_SYSTEM } from 'orbital-engine'
import type { CelestialBody } from 'orbital-engine'
import { FICTIONAL_SYSTEM } from './fictionalSystem'

export function App() {
  const [systemId, setSystemId] = useState<'solar' | 'fictional'>('solar')
  const [selected, setSelected] = useState<CelestialBody | null>(null)
  const system = systemId === 'solar' ? SOLAR_SYSTEM : FICTIONAL_SYSTEM

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 1,
          display: 'flex',
          gap: 8,
          fontFamily: 'system-ui, sans-serif',
          color: '#e2e8f0',
        }}
      >
        <button onClick={() => setSystemId('solar')} disabled={systemId === 'solar'}>
          Real Solar System (Kepler orbits)
        </button>
        <button onClick={() => setSystemId('fictional')} disabled={systemId === 'fictional'}>
          Fictional system (fixed positions)
        </button>
        {selected && <span style={{ marginLeft: 12, opacity: 0.8 }}>Selected: {selected.name}</span>}
      </div>
      <OrbitalSystemScene key={system.id} system={system} onSelectBody={setSelected} />
    </div>
  )
}
