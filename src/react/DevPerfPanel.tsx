import { computeObjectCounts, lodSummaryFor } from '../devStats'
import type { CelestialBody, StarSystemData } from '../types'
import type { SystemDataWarning } from '../validateSystemData'
import { describeDataWarning } from './dataWarningText'
import type { RendererStats } from './PerfStats'
import type { SceneInteractionStore } from './sceneInteractionStore'
import { uiStyles } from './theme'
import { useSceneInteractionSnapshot } from './useSceneInteraction'

/** Chrome/Edge-only heap size readout (performance.memory isn't in any spec
 *  — Firefox/Safari simply don't have it) — a best-effort dev aid, not
 *  something the overlay depends on; returns null anywhere it's absent
 *  rather than throwing. */
function jsHeapMb(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return mem ? mem.usedJSHeapSize / (1024 * 1024) : null
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={uiStyles.devPanelRow}>
      <span style={uiStyles.muted}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

/** The dev-mode performance overlay (see OrbitalSystemScene's `devMode`
 *  prop) — everything a person debugging this scene's own performance
 *  would otherwise have to open the browser's dev tools to see: FPS/frame
 *  time, draw calls, triangle/point/line counts, compiled shader program
 *  count, GPU-resident geometry/texture counts, JS heap usage where the
 *  browser exposes it, how many of the system's own objects are actually
 *  on screen right now vs. how many the LOD/crowding gate (visibility.ts)
 *  and screen-space thinning (labelDeclutter.ts) are currently hiding, and
 *  any data-contract/rendering-legibility warnings validateSystemData
 *  finds for the loaded system. Reads the visible sets and hover straight
 *  from the interaction store, so only this panel (not the whole scene)
 *  re-renders when they change. */
export function DevPerfPanel({
  stats,
  system,
  bodiesById,
  selectedBody,
  cameraDistance,
  dataWarnings,
  interaction,
}: {
  stats: RendererStats | null
  system: StarSystemData
  bodiesById: ReadonlyMap<string, CelestialBody>
  selectedBody: CelestialBody | null
  cameraDistance: number
  dataWarnings: SystemDataWarning[]
  interaction: SceneInteractionStore
}) {
  const { hoveredId, visibleBodyIds, visibleLabelIds } = useSceneInteractionSnapshot(interaction)
  const counts = computeObjectCounts(system, visibleBodyIds, visibleLabelIds)
  const heapMb = jsHeapMb()
  const lodBody = selectedBody ?? (hoveredId ? (bodiesById.get(hoveredId) ?? null) : null)
  const lodSummary = lodBody ? lodSummaryFor(lodBody, cameraDistance) : null

  return (
    <div style={uiStyles.devPanel}>
      <div style={uiStyles.devPanelTitle}>DEV — PERF</div>
      <Row label="fps" value={stats ? stats.fps.toFixed(0) : '—'} />
      <Row label="frame time" value={stats ? `${stats.frameTimeMs.toFixed(1)} ms` : '—'} />
      <Row label="draw calls" value={stats ? String(stats.drawCalls) : '—'} />
      <Row label="triangles" value={stats ? stats.triangles.toLocaleString() : '—'} />
      <Row label="points" value={stats ? stats.points.toLocaleString() : '—'} />
      <Row label="lines" value={stats ? stats.lines.toLocaleString() : '—'} />
      <Row label="programs" value={stats ? String(stats.programs) : '—'} />
      <Row label="geometries (gpu)" value={stats ? String(stats.geometries) : '—'} />
      <Row label="textures (gpu)" value={stats ? String(stats.textures) : '—'} />
      <Row label="js heap" value={heapMb !== null ? `${heapMb.toFixed(1)} MB` : 'n/a'} />
      <div style={uiStyles.devPanelSectionTitle}>OBJECTS</div>
      <Row label="bodies total" value={String(counts.totalBodies)} />
      <Row label="bodies shown" value={String(counts.visibleBodies)} />
      <Row label="bodies culled" value={String(counts.culledBodies)} />
      <Row label="labels shown" value={String(counts.visibleLabels)} />
      <Row label="belt points" value={counts.totalBeltObjects.toLocaleString()} />
      {lodBody && (
        <>
          <div style={uiStyles.devPanelSectionTitle}>LOD</div>
          <Row label={lodBody.name} value={lodSummary ?? 'fixed'} />
        </>
      )}
      {dataWarnings.length > 0 && (
        <>
          <div style={uiStyles.devPanelWarningTitle}>⚠ DATA WARNINGS ({dataWarnings.length})</div>
          {dataWarnings.map((w, i) => {
            const { title, detail } = describeDataWarning(w)
            return (
              <div key={`${w.kind}-${i}`} style={uiStyles.devPanelWarningRow}>
                <span>
                  {title} <span style={uiStyles.muted}>({w.kind})</span>
                </span>
                <span style={uiStyles.muted}>{detail}</span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
