/**
 * Standalone visual/regression tooling for the fixed camera-route fixture
 * (src/fixtures/cameraRouteFixture.ts + src/routeCameraSimulator.ts).
 *
 * Two jobs, both driven off the exact same deterministic simulation the
 * Jest regression test (src/__tests__/cameraRoute.test.ts) checks:
 *
 *   npm run plot:camera-route              → renders one SVG PER PHASE PER
 *                                             RUN, where a "run" is one of
 *                                             CAMERA_ROUTE_TRACKING_SPEEDS_DPS
 *                                             (paused, 0.2 d/s, 1 d/s,
 *                                             2 d/s — see that constant's
 *                                             own comment) —
 *                                             artifacts/camera-route-paused-1-star.svg,
 *                                             -0.2dps-2-planetA.svg, etc.
 *                                             Different speeds only change
 *                                             each phase's TRACK segment
 *                                             (the settle/orbit-follow part
 *                                             after arrival) — the flight
 *                                             segment doesn't depend on
 *                                             playback speed at all, so
 *                                             it's identical across a
 *                                             phase's 4 run images by
 *                                             construction. Each SVG states
 *                                             what it's framing (and its
 *                                             parent), which run/speed it
 *                                             is, and shows that phase's
 *                                             flight path, camera angle,
 *                                             flight-path bend, and
 *                                             per-frame score. Only the run
 *                                             at the app's default speed
 *                                             (1 d/s, matching
 *                                             CAMERA_ROUTE_TRACK_STEP_MS)
 *                                             overlays the checked-in
 *                                             reference (dashed grey) — the
 *                                             reference was only ever
 *                                             generated at that one speed,
 *                                             so overlaying it on a
 *                                             different speed's run would
 *                                             compare unrelated moments.
 *   npm run plot:camera-route -- --update-reference
 *                                           → (re)writes src/fixtures/
 *                                             cameraRouteReference.json from
 *                                             the DEFAULT-speed run only
 *                                             (one combined file spanning
 *                                             every phase — that's what the
 *                                             Jest test reads). Only do
 *                                             this deliberately, after
 *                                             visually confirming every
 *                                             phase/run's plot looks right.
 *
 * Deliberately NOT part of `npm test` / CI, and deliberately not a
 * pixel/image snapshot: this repo's e2e tests already found pixel-level
 * screenshot diffing of the canvas unreliable (see e2e/examples-basic.spec.ts's
 * canvasHasContentAt comment) — the SVGs here are for a human, the
 * regression test compares the underlying numeric trace instead.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAMERA_ROUTE_FIXTURE_SYSTEM,
  CAMERA_ROUTE_FIXTURE_WAYPOINTS,
  CAMERA_ROUTE_START_DATE,
  CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
  CAMERA_ROUTE_TRACK_STEPS,
  CAMERA_ROUTE_TRACK_STEP_MS,
  CAMERA_ROUTE_TRACKING_SPEEDS_DPS,
  daysPerSecondToTrackStepMs,
  describeTrackingSpeed,
} from '../src/fixtures/cameraRouteFixture'
import { DEFAULT_DAYS_PER_SECOND } from '../src/timeScale'
import { simulateCameraRoute, type CameraRouteFrame } from '../src/routeCameraSimulator'
import { resolveWorldPosition, compressVecByRatio, orbitCompressionRatio, type WorldVec } from '../src/render'
import { orbitPath } from '../src/kepler'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REFERENCE_PATH = join(ROOT, 'src/fixtures/cameraRouteReference.json')
const ARTIFACTS_DIR = join(ROOT, 'artifacts')

if (process.argv.includes('--update-reference')) {
  const defaultRun = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, CAMERA_ROUTE_FIXTURE_WAYPOINTS, CAMERA_ROUTE_START_DATE, {
    samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
    trackSteps: CAMERA_ROUTE_TRACK_STEPS,
    trackStepMs: CAMERA_ROUTE_TRACK_STEP_MS,
  })
  writeFileSync(REFERENCE_PATH, JSON.stringify(defaultRun, null, 2) + '\n')
  console.log(`Wrote ${defaultRun.length} frames to ${REFERENCE_PATH}`)
  process.exit(0)
}

const reference: CameraRouteFrame[] | null = existsSync(REFERENCE_PATH)
  ? (JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')) as CameraRouteFrame[])
  : null

/** Filename-safe token for a speed — "paused", "0.2dps", "1dps", "2dps". */
function speedToken(daysPerSecond: number): string {
  if (daysPerSecond === 0) return 'paused'
  // Hours/second, not days — the natural unit since MAX_HOURS_PER_SECOND
  // (timeScale.ts); 3 significant figures keeps filenames short and
  // filesystem-safe without the raw floating-point repr of a derived
  // constant like DEFAULT_DAYS_PER_SECOND showing up verbatim.
  const hoursPerSecond = daysPerSecond * 24
  return `${hoursPerSecond.toPrecision(3).replace(/\.?0+$/, '')}hps`
}

// ---- SVG rendering (no dependencies) --------------------------------------

const WIDTH = 900
const TOP_HEIGHT = 460
const PANEL_HEIGHT = 150
const PADDING = 48
const HEIGHT = TOP_HEIGHT + PANEL_HEIGHT * 3 + PADDING
const plotW = WIDTH - PADDING * 2

function bounds(points: [number, number][]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  const padX = Math.max((maxX - minX) * 0.1, 1e-6)
  const padY = Math.max((maxY - minY) * 0.1, 1e-6)
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY }
}

function phaseColor(phase: CameraRouteFrame['phase']): string {
  return phase === 'flight' ? '#2f6fed' : '#e07b2a'
}

interface SystemSnapshot {
  /** Every body's own world position at the snapshot date. */
  positions: Map<string, WorldVec>
  /** Every orbiting body's full orbit ring (world-space, absolute — the
   *  parent's own snapshot position already added in), for drawing as
   *  system-context backdrop. Bodies with no orbit (the star, or any
   *  fixedPosition-only body) contribute nothing here. */
  rings: { bodyId: string; points: WorldVec[] }[]
}

/** A full picture of where every body in the fixture system actually is
 *  (and the shape of everything's orbit), at one reference moment — this
 *  is what lets a single phase's own flight path be drawn IN CONTEXT of
 *  the whole system, not just next to its own isolated target, the same
 *  way OrbitLines.tsx draws the real app's orbit rings (parent-relative
 *  points, positioned by adding the parent's own snapshot position — see
 *  that file's own comment for why the ratio has to be the orbit's own
 *  fixed one, not each point's independent one). */
function systemSnapshot(date: Date): SystemSnapshot {
  const positions = new Map<string, WorldVec>()
  for (const b of CAMERA_ROUTE_FIXTURE_SYSTEM.bodies) {
    positions.set(b.id, resolveWorldPosition(b, CAMERA_ROUTE_FIXTURE_SYSTEM.bodies, date))
  }
  const rings: { bodyId: string; points: WorldVec[] }[] = []
  for (const b of CAMERA_ROUTE_FIXTURE_SYSTEM.bodies) {
    if (!b.orbit) continue
    const parentPos = (b.parentId && positions.get(b.parentId)) || ([0, 0, 0] as WorldVec)
    const ratio = orbitCompressionRatio(b.orbit)
    const points = orbitPath(b.orbit, 128).map((p) => {
      const [x, y, z] = compressVecByRatio(p, ratio)
      return [x + parentPos[0], y + parentPos[1], z + parentPos[2]] as WorldVec
    })
    rings.push({ bodyId: b.id, points })
  }
  return { positions, rings }
}

/** Renders one phase's (i.e. one leg's) frames as a standalone SVG: a
 *  top-down flight-path panel plus three stacked line-chart panels
 *  (camera turn rate, flight-path bend, per-frame success score). `legFrames`
 *  and `refLegFrames` are both pre-filtered to this leg only, so nothing
 *  here reasons about leg/phase boundaries — that's the whole point of
 *  splitting per phase. */
function renderPhaseSvg(
  legFrames: CameraRouteFrame[],
  refLegFrames: CameraRouteFrame[] | null,
  legIndex: number,
  speedLabel: string
): string {
  const first = legFrames[0]
  const parentLabel = first.parentBodyId ? `parent: ${first.parentBodyId}` : 'parent: none (root body)'
  const title = `Phase ${legIndex + 1}: framing ${first.bodyId} (${parentLabel}) — ${speedLabel}`

  // Whole-system backdrop, snapshotted at this phase's own start — every
  // body's position and orbit ring, not just the one this phase is
  // framing, so the flight reads in context of where it sits within the
  // entire system rather than in isolation.
  const system = systemSnapshot(new Date(first.simDate))

  const topPoints: [number, number][] = [
    ...legFrames.map((f): [number, number] => [f.cameraPos[0], f.cameraPos[2]]),
    ...[...system.positions.values()].map((p): [number, number] => [p[0], p[2]]),
    ...system.rings.flatMap((r) => r.points.map((p): [number, number] => [p[0], p[2]])),
  ]
  const topBounds = bounds(topPoints)
  // Top-down plot area starts below the two-row header (title + legend,
  // the latter now at y=44) instead of right at PADDING, so plotted
  // content never overlaps the legend text.
  const TOP_PLOT_Y = 64
  const topPlotH = TOP_HEIGHT - TOP_PLOT_Y - PADDING / 2

  // Contiguous [start, end) index ranges where the camera genuinely did
  // NOT move frame-to-frame (CameraRouteFrame.moved === false) — common
  // and expected (a paused run's whole track phase, or the star's track
  // phase at ANY speed, since it has no orbit), not itself a failure.
  // Marked explicitly because phase colour (flight/track) doesn't tell
  // you this: a body can easily still be MOVING throughout "track" (the
  // whole point of tracking one that orbits), so "stopped" is a distinct,
  // narrower condition worth calling out on its own.
  const stoppedRuns: { start: number; end: number }[] = []
  {
    let runStart: number | null = null
    for (let i = 0; i < legFrames.length; i++) {
      const stopped = !legFrames[i].moved
      if (stopped && runStart === null) runStart = i
      if (!stopped && runStart !== null) {
        stoppedRuns.push({ start: runStart, end: i })
        runStart = null
      }
    }
    if (runStart !== null) stoppedRuns.push({ start: runStart, end: legFrames.length })
  }

  function projectTop([x, z]: [number, number]): [number, number] {
    const px = PADDING + ((x - topBounds.minX) / (topBounds.maxX - topBounds.minX)) * plotW
    // SVG y grows downward; flip so +z is "up" on the page like a conventional top-down map.
    const py = TOP_PLOT_Y + (1 - (z - topBounds.minY) / (topBounds.maxY - topBounds.minY)) * topPlotH
    return [px, py]
  }

  function polyline(fs: CameraRouteFrame[], stroke: string, dash?: string): string {
    const pts = fs.map((f) => projectTop([f.cameraPos[0], f.cameraPos[2]]).join(',')).join(' ')
    return `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} />`
  }

  // One polyline per phase (flight vs. track) run within this leg, so the
  // two get their own color without a stray line joining them end to end.
  function segmentedRoute(fs: CameraRouteFrame[], dash?: string): string {
    const parts: string[] = []
    let runStart = 0
    for (let i = 1; i <= fs.length; i++) {
      const prev = fs[i - 1]
      const cur = fs[i]
      if (!cur || cur.phase !== prev.phase) {
        parts.push(polyline(fs.slice(runStart, i), phaseColor(prev.phase), dash))
        runStart = i
      }
    }
    return parts.join('\n  ')
  }

  function directionArrows(fs: CameraRouteFrame[]): string {
    const arrows: string[] = []
    for (let i = 0; i < fs.length; i += Math.max(1, Math.round(fs.length / 24))) {
      const f = fs[i]
      const [x1, y1] = projectTop([f.cameraPos[0], f.cameraPos[2]])
      const [x2, y2] = projectTop([f.target[0], f.target[2]])
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1
      const ux = (dx / len) * 10
      const uy = (dy / len) * 10
      arrows.push(
        `<line x1="${x1}" y1="${y1}" x2="${x1 + ux}" y2="${y1 + uy}" stroke="#999" stroke-width="1" marker-end="url(#arrow)" />`
      )
    }
    return arrows.join('\n  ')
  }

  function orbitRings(): string {
    return system.rings
      .map(({ points }) => {
        const pts = points.map((p) => projectTop([p[0], p[2]]).join(',')).join(' ')
        return `<polygon points="${pts}" fill="none" stroke="#c9c9c9" stroke-width="1" />`
      })
      .join('\n  ')
  }

  /** Every body in the system, labeled — this phase's own target stands
   *  out (bold, dark); everything else is a smaller, lighter reference
   *  marker, still labeled, so the target's place in the whole system is
   *  legible without competing with the flight path itself for attention. */
  function systemBodyMarkers(): string {
    const markers: string[] = []
    for (const [bodyId, pos] of system.positions) {
      const [x, y] = projectTop([pos[0], pos[2]])
      const isTarget = bodyId === first.bodyId
      const r = isTarget ? 5 : 3
      const fill = isTarget ? '#1a1a1a' : '#888'
      const fontWeight = isTarget ? ' font-weight="bold"' : ''
      markers.push(
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" /><text x="${x + 8}" y="${y + 4}" font-size="${isTarget ? 12 : 11}" fill="${fill}"${fontWeight}>${bodyId}</text>`
      )
    }
    return markers.join('\n  ')
  }

  /** Marks each stopped-motion run's camera position on the top-down
   *  panel — one marker per contiguous run (position is constant for the
   *  whole run by definition, so one point represents it exactly), not
   *  one per frame. */
  function stoppedMarkers(): string {
    return stoppedRuns
      .map(({ start }) => {
        const [x, y] = projectTop([legFrames[start].cameraPos[0], legFrames[start].cameraPos[2]])
        // A small ring around the existing path point, distinct from both
        // the phase-colour line and the system's own body markers.
        return `<circle cx="${x}" cy="${y}" r="8" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-dasharray="2,2" />`
      })
      .join('\n  ')
  }

  /** A generic 0..max line-chart panel shared by the three metric panels
   *  below — only the y-accessor, color, and scale differ between them. */
  function metricPanel(
    panelIndex: number,
    heading: string,
    accessor: (f: CameraRouteFrame) => number,
    color: string,
    maxOverride?: number
  ): string {
    const yTop = TOP_HEIGHT + PANEL_HEIGHT * panelIndex + PADDING / 2
    const h = PANEL_HEIGHT - PADDING / 2
    const n = legFrames.length
    const x = (i: number) => PADDING + (i / Math.max(1, n - 1)) * plotW
    // Floor of 1, not ~0: auto-scaling to the RAW max (as low as ~1e-6 for
    // a perfectly straight path, pure acos/trig floating-point noise —
    // see angleBetweenDeg) stretches that noise to fill the whole panel
    // height, visually reading as a dramatic bend/spike when the real
    // value is a physically meaningless fraction of a millionth of a
    // degree. 1° is still far below anything that would ever look
    // "smooth" to a human, so a genuine small-but-real signal isn't
    // hidden by this floor either.
    const max = maxOverride ?? Math.max(1, ...legFrames.map(accessor), ...(refLegFrames?.map(accessor) ?? []))
    const y = (v: number) => yTop + h - (Math.min(max, Math.max(0, v)) / max) * h

    const line = (data: CameraRouteFrame[], c: string, dash?: string) =>
      `<polyline points="${data.map((f, i) => `${x(i)},${y(accessor(f))}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} />`

    const refLine = refLegFrames ? line(refLegFrames, '#999', '4,3') : ''
    const stoppedBands = stoppedRuns
      .map(
        ({ start, end }) =>
          `<rect x="${x(start)}" y="${yTop}" width="${Math.max(1, x(end - 1) - x(start))}" height="${h}" fill="#1a1a1a" opacity="0.06" />`
      )
      .join('\n  ')
    return `
  <text x="${PADDING}" y="${yTop - 8}" font-size="13" fill="#1a1a1a">${heading}</text>
  ${stoppedBands}
  <line x1="${PADDING}" y1="${y(0)}" x2="${PADDING + plotW}" y2="${y(0)}" stroke="#ddd" />
  <text x="${PADDING - 4}" y="${y(max) + 4}" font-size="10" fill="#999" text-anchor="end">${max.toFixed(max < 2 ? 2 : 0)}</text>
  ${refLine}
  ${line(legFrames, color)}
  `
  }

  // Second row, left-aligned with a running cursor — avoids guessing fixed
  // offsets from the right edge that could collide with each other (or
  // with the title above) depending on which optional items are present.
  const legendY = 44
  let legendX = PADDING
  const legendItems: string[] = []
  function legendSwatch(svg: string, label: string, width: number): void {
    legendItems.push(svg.replace('{x}', String(legendX)))
    legendItems.push(`<text x="${legendX + 30}" y="${legendY + 4}">${label}</text>`)
    legendX += width
  }
  legendSwatch(
    `<line x1="{x}" y1="${legendY}" x2="{x2}" y2="${legendY}" stroke="${phaseColor('flight')}" stroke-width="2" />`.replace(
      '{x2}',
      String(legendX + 24)
    ),
    'flight',
    80
  )
  legendSwatch(
    `<line x1="{x}" y1="${legendY}" x2="{x2}" y2="${legendY}" stroke="${phaseColor('track')}" stroke-width="2" />`.replace(
      '{x2}',
      String(legendX + 24)
    ),
    'track',
    75
  )
  if (refLegFrames) {
    legendSwatch(
      `<line x1="{x}" y1="${legendY}" x2="{x2}" y2="${legendY}" stroke="#999" stroke-width="2" stroke-dasharray="4,3" />`.replace(
        '{x2}',
        String(legendX + 24)
      ),
      'reference',
      110
    )
  }
  if (stoppedRuns.length) {
    legendItems.push(
      `<circle cx="${legendX + 6}" cy="${legendY}" r="6" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-dasharray="2,2" />`
    )
    legendItems.push(`<text x="${legendX + 30}" y="${legendY + 4}">stopped (camera did not move this frame)</text>`)
  }

  const legend = `
  <g font-size="12" fill="#1a1a1a">
    <text x="${PADDING}" y="24" font-size="15" font-weight="bold">${title}</text>
    ${legendItems.join('\n    ')}
  </g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fff" />
  <defs>
    <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 z" fill="#999" />
    </marker>
  </defs>
  ${legend}
  <text x="${PADDING}" y="${TOP_HEIGHT - 8}" font-size="13" fill="#1a1a1a">Top-down (X/Z) flight path, in context of the whole system</text>
  ${orbitRings()}
  ${refLegFrames ? segmentedRoute(refLegFrames, '4,3').replace(/stroke="[^"]*"/g, 'stroke="#999"') : ''}
  ${segmentedRoute(legFrames)}
  ${directionArrows(legFrames)}
  ${systemBodyMarkers()}
  ${stoppedMarkers()}
  ${metricPanel(0, 'Camera turn rate, deg/frame (viewing angle) — any spike here is a failure', (f) => f.turnRateDeg ?? 0, '#c0392b', 20)}
  ${metricPanel(1, 'Flight-path bend, deg/frame — a failure DURING FLIGHT (blue); during track (orange) reflects real orbital speed, not asserted', (f) => f.flightPathTurnDeg ?? 0, '#8e44ad')}
  ${metricPanel(2, 'Per-frame framing score (target ± parent in view) — 1 = perfectly framed; should rise and STAY, never a progress-to-destination measure', (f) => (f.parentFramingScore !== null ? Math.min(f.targetFramingScore, f.parentFramingScore) : f.targetFramingScore), '#2f6fed', 1)}
</svg>
`
}

mkdirSync(ARTIFACTS_DIR, { recursive: true })

for (const speed of CAMERA_ROUTE_TRACKING_SPEEDS_DPS) {
  const speedLabel = describeTrackingSpeed(speed)
  // The checked-in reference was only ever generated at the app's default
  // speed (see CAMERA_ROUTE_TRACK_STEP_MS) — overlaying it on a different
  // speed's run would line up unrelated simulated moments, so it's only
  // ever shown on that one run's images.
  const isReferenceSpeed = speed === DEFAULT_DAYS_PER_SECOND

  CAMERA_ROUTE_FIXTURE_WAYPOINTS.forEach((waypointId, waypointIndex) => {
    // Each phase is simulated as its OWN single-waypoint route, not
    // chained on from wherever the previous phase's flight happened to
    // leave the camera — every phase's flight starts from the exact same
    // fixed default view (see routeCameraSimulator's own INITIAL_TARGET/
    // INITIAL_DIRECTION), the same starting point phase 1 (star) itself
    // starts from. Lets every phase/speed image be compared on equal
    // footing (same vantage point) instead of each one's starting angle
    // depending on the route's own prior history — that history is still
    // real, tested behavior (see the main "simulateCameraRoute — fixed
    // fixture" describe block in cameraRoute.test.ts, which chains the
    // whole route exactly as a real sequential flight would), just not
    // what these comparison images are for.
    const frames = simulateCameraRoute(CAMERA_ROUTE_FIXTURE_SYSTEM, [waypointId], CAMERA_ROUTE_START_DATE, {
      samplesPerFlight: CAMERA_ROUTE_SAMPLES_PER_FLIGHT,
      trackSteps: CAMERA_ROUTE_TRACK_STEPS,
      trackStepMs: daysPerSecondToTrackStepMs(speed),
      // Both new features turned ON for these comparison images: the
      // flight itself assumes the SAME speed as the run it's part of was
      // already playing at when the flight started (so a fast orbiter's
      // flight also tracks its real predicted trajectory, not just its
      // track phase), and track-phase smoothing is enabled to tame the
      // epicycle-style spikes a fast/close orbiter's own moving parent
      // can otherwise cause (see camera.ts's smoothTrajectory and
      // routeCameraSimulator's own SimulateCameraRouteOptions for both).
      flightDaysPerSecond: speed,
      smoothTracking: true,
    })
    // The checked-in reference (cameraRouteReference.json) is the CHAINED
    // route, so only its own phase 1 (star) — the one phase unaffected by
    // chaining, since there's no prior leg to chain from either way —
    // corresponds to this independent-start run. Every other phase would
    // be comparing against a reference that started somewhere different.
    const refLegFrames = isReferenceSpeed && reference && waypointIndex === 0 ? reference.filter((f) => f.leg === 0) : null
    const path = join(ARTIFACTS_DIR, `camera-route-${speedToken(speed)}-${waypointIndex + 1}-${waypointId}.svg`)
    writeFileSync(path, renderPhaseSvg(frames, refLegFrames?.length ? refLegFrames : null, waypointIndex, speedLabel))
    console.log(`Wrote ${frames.length} frames -> ${path}`)
  })
}
if (!reference) console.log('No reference found yet — run with --update-reference once every phase/run looks right.')
