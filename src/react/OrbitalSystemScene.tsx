'use client'

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementRef,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls, Points, PointMaterial, useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { orbitPath } from '../kepler'
import { coOrbitalReferenceAngle } from '../resolve'
import { compressVec, compressVecByRatio, orbitCompressionRatio, resolveAllWorldPositions, resolveWorldPosition, type WorldVec } from '../render'
import { compressDistance, trueRadius } from '../scale'
import {
  DEFAULT_CAMERA_DISTANCE,
  DEFAULT_NEAR_PLANE,
  MAX_CAMERA_DISTANCE,
  VERTICAL_FOV_DEG,
  computeFocusForBelt,
  computeFocusForBody,
  computeFocusForSystem,
  minCameraDistanceForRadius,
  nearPlaneForRadius,
  type FocusTarget,
} from '../camera'
import { computeVisibleBodyIds } from '../visibility'
import { findNearestCandidate, type ProximityCandidate } from '../proximitySelection'
import { computeOrbitalDepth, computeVisibleLabels, type LabelCandidate } from '../labelDeclutter'
import { apparentSize, icosahedronDetailFor, orbitDetailFor, sphereDetailFor, torusDetailFor } from '../levelOfDetail'
import { renderRadius } from '../pixelFloor'
import { formatDistanceKm } from '../units'
import { routeSegments } from '../routeSegments'
import { distanceToSliderPosition, sliderPositionToDistance } from '../zoomSlider'
import type { BeltRegion, CelestialBody, StarSystemData } from '../types'

type Selection = { kind: 'body'; id: string } | { kind: 'belt'; id: string } | null

// This component's own chrome (toolbar, zoom slider, info panels) is styled
// with plain inline styles rather than CSS classes — a published library
// has no guarantee its consumer uses Tailwind (or any particular design
// system), so it can't depend on utility classes or theme tokens the way
// this engine's own internal dev app does. Colors are a standard dark
// UI palette (Tailwind's own gray/cyan scale, as literal hex), not tied to
// any host app's theme.
const UI_COLORS = {
  panelBg: '#111827', // gray-900
  surfaceBg: '#1f2937', // gray-800
  elevatedBg: '#374151', // gray-700
  elevatedHoverBg: '#4b5563', // gray-600
  text: '#f3f4f6', // gray-100
  textMuted: '#9ca3af', // gray-400
  accent: '#22d3ee', // cyan-400
} as const

const uiStyles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'system-ui, sans-serif' } as const,
  toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12 } as const,
  select: {
    background: UI_COLORS.surfaceBg,
    border: `1px solid ${UI_COLORS.elevatedBg}`,
    borderRadius: 4,
    padding: '6px 8px',
    color: UI_COLORS.text,
  } as const,
  button: {
    padding: '6px 8px',
    borderRadius: 4,
    background: UI_COLORS.elevatedBg,
    color: UI_COLORS.text,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
  } as const,
  buttonDisabled: { opacity: 0.3, cursor: 'default' } as const,
  zoomLabel: { display: 'flex', alignItems: 'center', gap: 8, color: UI_COLORS.textMuted, marginLeft: 'auto' } as const,
  canvasWrap: {
    position: 'relative',
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
    background: '#000',
    touchAction: 'none',
  } as const,
  timeBar: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 12,
    background: 'rgba(17, 24, 39, 0.8)', // panelBg/80
    borderRadius: 4,
    padding: '8px 12px',
  } as const,
  infoPanel: {
    position: 'absolute',
    top: 8,
    right: 8,
    background: 'rgba(17, 24, 39, 0.9)', // panelBg/90
    border: `1px solid ${UI_COLORS.elevatedBg}`,
    borderRadius: 8,
    padding: 12,
    fontSize: 12,
    color: UI_COLORS.text,
    maxWidth: 260,
  } as const,
  infoPanelTitle: { fontWeight: 600, fontSize: 14, marginBottom: 4 } as const,
  muted: { color: UI_COLORS.textMuted } as const,
  mutedItalic: { color: UI_COLORS.textMuted, marginTop: 4, fontStyle: 'italic' } as const,
} as const

function buttonStyle(disabled?: boolean) {
  return disabled ? { ...uiStyles.button, ...uiStyles.buttonDisabled } : uiStyles.button
}

// True volumetric (raymarched-density) fog is a lot of machinery for what's
// actually needed here: belts reading as a soft haze instead of vanishing
// into sub-pixel dots once zoomed out. A soft radial-gradient sprite (drawn
// once to a canvas, reused for every belt) plus additive blending gets the
// same practical effect much more cheaply — overlapping glows merge into a
// hazy cloud exactly the way a real dust belt photograph looks, and unlike
// a hard-edged dot, a glow sprite still reads as "something's there" even
// well under a pixel in true size, at zoom levels where a plain dot would
// have already disappeared entirely.
let glowSpriteCache: THREE.CanvasTexture | null = null
function glowSprite(): THREE.CanvasTexture {
  if (glowSpriteCache) return glowSpriteCache
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.4)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  glowSpriteCache = new THREE.CanvasTexture(canvas)
  return glowSpriteCache
}

/** A soft-edged radial-gradient ring texture — transparent at the centre,
 *  rising to the belt's own colour across [innerRatio, 1] of the radius,
 *  fading back out past the outer edge. Used for the full-ring glow layer
 *  (see BeltGlowRing) so a belt still reads as a visible, soft-edged band
 *  even when zoomed out far enough that individual particles fall below a
 *  pixel — a flat, filled shape doesn't disappear between pixel samples
 *  the way sparse points can. */
function ringGlowTexture(innerRatio: number): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const r = size / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  const fadeIn = Math.max(0, innerRatio - 0.08)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(fadeIn, 'rgba(255,255,255,0)')
  gradient.addColorStop(innerRatio, 'rgba(255,255,255,0.18)')
  gradient.addColorStop((innerRatio + 1) / 2, 'rgba(255,255,255,0.3)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

/** A flat, soft-edged glow disc spanning a belt's full inner-to-outer
 *  radius — only makes sense for a belt spread around the whole circle
 *  (the main asteroid belt, Kuiper belt, Saturn's rings), not a co-orbital
 *  cluster like the Trojans, which only occupies a narrow arc. */
function BeltGlowRing({ belt, system, simDate }: { belt: BeltRegion; system: StarSystemData; simDate: Date }) {
  const parent = system.bodies.find((b) => b.id === belt.parentId)
  const [x, y, z] = parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)
  const outerWorldRadius = compressDistance(belt.outerRadiusKm)
  const innerRatio = belt.innerRadiusKm / belt.outerRadiusKm
  const texture = useMemo(() => ringGlowTexture(innerRatio), [innerRatio])

  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[outerWorldRadius, 64]} />
      <meshBasicMaterial
        map={texture}
        color={belt.color ?? '#a8a29e'}
        transparent
        opacity={0.28}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

const BODY_TYPE_COLOR_FALLBACK: Record<string, string> = {
  star: '#fde68a',
  planet: '#60a5fa',
  dwarf_planet: '#f0abfc',
  moon: '#d4d4d8',
  station: '#22d3ee',
  jump_point: '#c084fc',
  nav_point: '#94a3b8',
  asteroid: '#a8a29e',
  comet: '#a5f3fc',
}

/** Body types that are markers rather than genuine orbiting bodies — no
 *  reference orbit ring for these (see SceneContent). */
const NON_ORBITING_MARKER_TYPES = new Set(['station', 'jump_point', 'nav_point'])

/** Deterministic per-body pseudo-random seed, from the id string — used to
 *  give asteroids/stations/etc. a fixed, non-perfectly-aligned orientation
 *  (an irregular rock reads as a rock, not a shrunken sphere) without
 *  re-randomising on every re-render, which would visibly "pop"/jitter. */
function hashSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

function OrbitPathLine({
  body,
  color,
  parentWorldPos,
  cameraDistance,
}: {
  body: CelestialBody
  color: string
  parentWorldPos: WorldVec
  /** Drives how many points the path samples — see orbitDetailFor. */
  cameraDistance: number
}) {
  const points = useMemo(() => {
    if (!body.orbit) return null
    // Every sampled point compresses by the SAME ratio (the orbit's own,
    // fixed by its semi-major axis — see orbitCompressionRatio), not each
    // one independently by its own instantaneous radius (compressVec) —
    // periapsis and apoapsis sit at different true radii for any real
    // eccentricity, and compressDistance is a log curve, not linear, so
    // per-point ratios visibly warp the ellipse into the wrong shape. This
    // is also exactly the ratio resolveWorldPosition now uses for this
    // same body's own live position, so the moving marker stays on this
    // line instead of drifting off it. Then anchor the whole path at the
    // parent's actual current world position — without that offset, a
    // moon's orbit ring would be drawn centred on the origin instead of
    // around its planet.
    const ratio = orbitCompressionRatio(body.orbit)
    // The ring's own world-space scale (its semi-major axis, compressed)
    // is what apparentSize needs here — this is a large loop the camera
    // views from outside, not a solid body the camera zooms into, so
    // "large apparent size" means the ring's curve spans a lot of the
    // view, exactly when a fixed segment count starts showing as visible
    // straight facets rather than a smooth curve (see orbitDetailFor).
    const ringWorldRadius = compressDistance(body.orbit.semiMajorAxisKm)
    const segments = orbitDetailFor(apparentSize(ringWorldRadius, cameraDistance))
    return orbitPath(body.orbit, segments).map((p) => {
      const [rx, ry, rz] = compressVecByRatio(p, ratio)
      return [parentWorldPos[0] + rx, parentWorldPos[1] + ry, parentWorldPos[2] + rz] as WorldVec
    })
  }, [body.orbit, parentWorldPos, cameraDistance])
  if (!points) return null
  return <Line points={points} color={color} opacity={0.25} transparent lineWidth={1} />
}

/**
 * A body with only a `fixedPosition` (see CelestialBody — a single known
 * snapshot has no orbital elements to draw a true path from) still has a
 * real, known distance from its parent. Drawing a flat circle at that radius,
 * passing exactly through the body's own current position, gives the same
 * "this is roughly where it orbits" reference the real Keplerian orbit path
 * gives for the Solar System — honest about being a simplification (flat,
 * not tilted to whatever the body's true — currently unknown — inclination
 * is) rather than omitting the reference entirely.
 */
function ReferenceOrbitRing({
  position,
  parentWorldPos,
  color,
  cameraDistance,
}: {
  position: WorldVec
  parentWorldPos: WorldVec
  color: string
  /** Drives how many points the ring samples — see orbitDetailFor. */
  cameraDistance: number
}) {
  const points = useMemo(() => {
    const dx = position[0] - parentWorldPos[0]
    const dz = position[2] - parentWorldPos[2]
    const radius = Math.hypot(dx, dz)
    if (radius < 1e-4) return null
    const y = position[1]
    const segments = orbitDetailFor(apparentSize(radius, cameraDistance))
    const pts: WorldVec[] = []
    for (let i = 0; i <= segments; i++) {
      const a = (2 * Math.PI * i) / segments
      pts.push([parentWorldPos[0] + radius * Math.cos(a), y, parentWorldPos[2] + radius * Math.sin(a)])
    }
    return pts
  }, [position, parentWorldPos, cameraDistance])
  if (!points) return null
  return <Line points={points} color={color} opacity={0.18} transparent lineWidth={1} />
}

/**
 * Draws a planned route (see lib/routing.ts's routeWaypointIds) as a
 * polyline through whichever of its waypoints are actual bodies in the
 * CURRENTLY DISPLAYED system — the map only ever shows one system at a
 * time, so a route that crosses into another system necessarily has a gap
 * here for the part that's off-screen. Split into separate Line segments
 * at each such gap (rather than one line that silently jumps across the
 * missing stretch) so a multi-system route reads as "this much is drawn,
 * the rest continues elsewhere," not as a single continuous path that
 * happens to have a weird kink in it.
 */
function RoutePreviewLine({
  waypointIds,
  positions,
  color,
  dashed,
}: {
  waypointIds: string[]
  positions: Map<string, WorldVec>
  color: string
  dashed?: boolean
}) {
  const segments = useMemo(() => routeSegments(waypointIds, positions), [waypointIds, positions])

  return (
    <>
      {segments.map((points, i) => (
        <Line
          key={i}
          points={points}
          color={color}
          transparent
          opacity={dashed ? 0.55 : 0.9}
          lineWidth={dashed ? 1.5 : 2.5}
          dashed={dashed}
          dashScale={dashed ? 6 : undefined}
          gapSize={dashed ? 3 : undefined}
        />
      ))}
    </>
  )
}

/** Per-particle (radiusKm, angleOffsetRad, phiRad) — generated once and
 *  reused every frame, so a co-orbital population's particles keep their
 *  own fixed slot in the cluster and just carry it around as the reference
 *  angle moves, rather than re-randomising (visibly "sparkling") every tick. */
function useBeltShape(belt: BeltRegion): Float32Array {
  return useMemo(() => {
    const spreadRad = (belt.inclinationSpreadDeg * Math.PI) / 180
    const angularSpreadRad = belt.coOrbital ? (belt.coOrbital.angularSpreadDeg * Math.PI) / 180 : Math.PI * 2
    const arr = new Float32Array(belt.particleCount * 3)
    for (let i = 0; i < belt.particleCount; i++) {
      arr[i * 3] = belt.innerRadiusKm + Math.random() * (belt.outerRadiusKm - belt.innerRadiusKm)
      arr[i * 3 + 1] = belt.coOrbital ? (Math.random() - 0.5) * angularSpreadRad : Math.random() * Math.PI * 2
      arr[i * 3 + 2] = (Math.random() - 0.5) * spreadRad
    }
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [belt.id])
}

function BeltPoints({ belt, system, simDate }: { belt: BeltRegion; system: StarSystemData; simDate: Date }) {
  // Only build the synthetic scatter shape when there's no real data to use
  // instead — calling the hook unconditionally (not inside the branch
  // below) keeps hook order stable across renders either way.
  const syntheticShape = useBeltShape(belt)

  const positions = useMemo(() => {
    const parent = system.bodies.find((b) => b.id === belt.parentId)
    const parentWorld = parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)

    // Real individual positions (see BeltRegion.realPositions) — e.g. Star
    // Citizen's asteroid fields, where every rock's exact position is known
    // from the game's own data. Used directly, not as a radius range to
    // scatter synthetic points across.
    if (belt.realPositions) {
      const arr = new Float32Array(belt.realPositions.length * 3)
      for (let i = 0; i < belt.realPositions.length; i++) {
        const p = belt.realPositions[i]!
        const [rx, ry, rz] = compressVec({ x: p.xKm, y: p.yKm, z: p.zKm })
        arr[i * 3] = parentWorld[0] + rx
        arr[i * 3 + 1] = parentWorld[1] + ry
        arr[i * 3 + 2] = parentWorld[2] + rz
      }
      return arr
    }

    // A co-orbital population (e.g. Jupiter's Trojans) clusters around an
    // angle measured from its reference body's CURRENT position, not a
    // fixed spot — this is what makes it visibly travel with Jupiter as
    // time advances rather than sitting static in space.
    const refAngle = coOrbitalReferenceAngle(belt, system, simDate)

    const arr = new Float32Array(belt.particleCount * 3)
    for (let i = 0; i < belt.particleCount; i++) {
      const radiusKm = syntheticShape[i * 3]!
      const theta = refAngle + syntheticShape[i * 3 + 1]!
      const phi = syntheticShape[i * 3 + 2]!
      // Compress the OFFSET from the parent independently, then add to the
      // parent's own (already hierarchically-compressed) world position —
      // same reasoning as render.ts's resolveWorldPosition: compressing a
      // combined absolute-style vector would flatten a ring's real spread
      // for any parent far from the star (e.g. Saturn's rings).
      const [rx, ry, rz] = compressVec({
        x: radiusKm * Math.cos(theta) * Math.cos(phi),
        y: radiusKm * Math.sin(theta) * Math.cos(phi),
        z: radiusKm * Math.sin(phi),
      })
      arr[i * 3] = parentWorld[0] + rx
      arr[i * 3 + 1] = parentWorld[1] + ry
      arr[i * 3 + 2] = parentWorld[2] + rz
    }
    return arr
  }, [belt, system, syntheticShape, simDate])

  return (
    <Points positions={positions}>
      <PointMaterial
        map={glowSprite()}
        color={belt.color ?? '#a8a29e'}
        size={4}
        // Fixed screen size rather than shrinking with camera distance —
        // sizeAttenuation is exactly why a belt used to vanish once zoomed
        // out far enough that each particle's true projected size dropped
        // under a pixel. A belt's whole point is to be visible as a hazy
        // band from any distance, not to shrink like an ordinary 3D object.
        sizeAttenuation={false}
        transparent
        opacity={0.3}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </Points>
  )
}

/**
 * The generic, always-available geometry for a body, distinct by type — a
 * sphere reads fine for a real celestial body (star/planet/moon/dwarf
 * planet), but every type here shares the exact same placeholder radius as
 * every other of its kind (a consuming app's own data source may not
 * publish real sizes for every body type), so shape is the only
 * cue that actually distinguishes "a station" from "a jump point" from "a
 * bare nav marker" at a glance, not size. No real texture imagery exists in
 * any current data source for planets/the star either (same
 * placeholder-only situation as radius) — what's rendered here is lit
 * shading (a directional light, added in the Canvas below) and glow, both
 * of which are honest ("this is a lit sphere") rather than a fabricated
 * surface texture standing in for real imagery this pipeline doesn't have.
 * This is what every body renders as by default, and what a specific body
 * with a real `modelUrl` (see BodyShape) falls back to if that model fails
 * to load.
 */
function PlaceholderBodyShape({
  body,
  radius,
  color,
  detailSize,
}: {
  body: CelestialBody
  radius: number
  color: string
  /** How much of the view this body fills right now — see
   *  levelOfDetail.ts's apparentSize. Drives polygon count so a body only
   *  gets expensive detail when actually zoomed in close enough to need
   *  it, not as a fixed per-type constant. */
  detailSize: number
}) {
  const seed = useMemo(() => hashSeed(body.id), [body.id])
  const rotation = useMemo(
    () => [(seed % 620) / 100, ((seed * 7) % 620) / 100, ((seed * 13) % 620) / 100] as [number, number, number],
    [seed]
  )
  const sphere = sphereDetailFor(detailSize)
  const icosahedronSubdivisions = icosahedronDetailFor(detailSize)
  const torus = torusDetailFor(detailSize)

  switch (body.type) {
    case 'star':
      return (
        <>
          <mesh>
            <sphereGeometry args={[radius, sphere.widthSegments, sphere.heightSegments]} />
            <meshBasicMaterial color={color} />
          </mesh>
          <sprite scale={[radius * 6, radius * 6, 1]}>
            <spriteMaterial
              map={glowSprite()}
              color={color}
              transparent
              opacity={0.55}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </sprite>
        </>
      )

    case 'planet':
    case 'dwarf_planet':
      return (
        <>
          <mesh>
            <sphereGeometry args={[radius, sphere.widthSegments, sphere.heightSegments]} />
            <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
          </mesh>
          {/* A soft additive rim just outside the surface — reads as a thin
              atmosphere without claiming any real atmospheric data. */}
          <mesh>
            <sphereGeometry args={[radius * 1.2, sphere.widthSegments, sphere.heightSegments]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.12}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.BackSide}
            />
          </mesh>
        </>
      )

    case 'moon':
      return (
        <mesh>
          <sphereGeometry args={[radius, sphere.widthSegments, sphere.heightSegments]} />
          <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
      )

    case 'asteroid':
      // A low-poly, flat-shaded icosahedron has an inherently irregular,
      // faceted silhouette — an actual rock shape, not a smooth sphere —
      // for free, with no procedural mesh-deformation cost. Subdivision 0
      // (the default, everyday case) is a deliberate stylistic choice, not
      // just cheapness — it only climbs when zoomed in close enough that
      // "very few polygons" would otherwise be genuinely visible (the
      // real, reported case: 10 Hygiea at true scale, see
      // levelOfDetail.ts).
      return (
        <mesh rotation={rotation}>
          <icosahedronGeometry args={[radius, icosahedronSubdivisions]} />
          <meshStandardMaterial color={color} roughness={1} flatShading />
        </mesh>
      )

    case 'comet':
      return (
        <>
          <mesh rotation={rotation}>
            <icosahedronGeometry args={[radius, Math.max(icosahedronSubdivisions, 1)]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
          {/* A faint trailing streak — comets are the one body type whose
              defining visual feature isn't its own shape at all. Not aimed
              away from the parent star (this engine has no per-frame "sun
              direction" concept for a fixed body), just a fixed, recognisable
              tail rather than omitting the feature entirely. */}
          <sprite scale={[radius * 9, radius * 2.4, 1]} position={[radius * 3.5, 0, 0]}>
            <spriteMaterial
              map={glowSprite()}
              color={color}
              transparent
              opacity={0.25}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </sprite>
        </>
      )

    case 'station':
      // A ring/hab-torus is a recognisable "built structure" silhouette —
      // clearly artificial against every natural sphere/rock shape nearby.
      // The tube radius is deliberately purely proportional to the main
      // radius (radius * 0.35), with no absolute floor — an absolute floor
      // was the actual bug behind a real, observed one: at true scale (see
      // scale.ts's trueRadius), the ISS's/Hubble's own radius is ~5×10⁻⁸
      // world units, vanishingly smaller than a fixed 0.02 floor this used
      // to have — so the torus's tube (0.02) ended up enormously larger
      // than its own ring (~5×10⁻⁸), degenerating into a distorted,
      // oversized blob rather than a thin ring, one roughly 4x Earth's own
      // true radius — completely swallowing Earth from any zoom level
      // close enough to also frame the ISS. An absolute floor breaks
      // proportionality for anything genuinely tiny; letting it shrink
      // freely is what a real, honest scale requires.
      return (
        <mesh rotation={rotation}>
          <torusGeometry args={[radius, radius * 0.35, torus.radialSegments, torus.tubularSegments]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
        </mesh>
      )

    case 'jump_point':
      // A hollow, glowing ring — a hole in space, not a structure — visually
      // distinct from a station's solid torus.
      return (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[radius * 0.65, radius * 1.15, torus.tubularSegments]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.85}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <sprite scale={[radius * 5, radius * 5, 1]}>
            <spriteMaterial
              map={glowSprite()}
              color={color}
              transparent
              opacity={0.4}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </sprite>
        </>
      )

    case 'nav_point':
      // The least substantial marker — a wireframe diamond, since a
      // NavPoint isn't a physical structure at all, just a labelled point.
      // Deliberately NOT detail-scaled: it's a wireframe symbol, not
      // something meant to read as smooth/rounded even up close.
      return (
        <mesh rotation={rotation}>
          <octahedronGeometry args={[radius, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.9} />
        </mesh>
      )

    default:
      return (
        <mesh>
          <sphereGeometry args={[radius, sphere.widthSegments, sphere.heightSegments]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )
  }
}

/** Catches a failed/broken model load (a 404, a corrupt file, an
 *  unsupported format) and renders the ordinary placeholder shape instead —
 *  a class component because React error boundaries can't be written as
 *  hooks. Without this, one body with a bad `modelUrl` would take down the
 *  whole scene rather than just falling back for that one body. */
class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Loads a real model (see CelestialBody.modelUrl) and uniformly scales it
 *  so its own bounding sphere matches this body's rendered `radius` —
 *  models come in whatever arbitrary real-world units/scale their source
 *  used, not this engine's compressed world units, so a fixed scale
 *  wouldn't work consistently across different models. */
function LoadedBodyModel({ url, radius }: { url: string; radius: number }) {
  const { scene } = useGLTF(url)
  const prepared = useMemo(() => {
    const clone = scene.clone(true)
    const box = new THREE.Box3().setFromObject(clone)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const scale = sphere.radius > 1e-6 ? radius / sphere.radius : 1
    clone.scale.setScalar(scale)
    clone.position.sub(sphere.center.multiplyScalar(scale))
    return clone
  }, [scene, radius])
  return <primitive object={prepared} />
}

/** Body types a sphere-with-real-texture actually makes sense for — the
 *  same set PlaceholderBodyShape renders as a sphereGeometry to begin
 *  with. Texturing an icosahedron/torus/octahedron would just look wrong,
 *  so textureUrl is silently ignored for those types (see CelestialBody.
 *  textureUrl). */
const TEXTURABLE_BODY_TYPES = new Set(['planet', 'dwarf_planet', 'moon'])

/** Loads a real surface texture (see CelestialBody.textureUrl) and wraps it
 *  around a sphere — real imagery standing in for the full 3D model this
 *  body doesn't have, rather than a flat colour. */
function TexturedSphereBody({ radius, textureUrl, detailSize }: { radius: number; textureUrl: string; detailSize: number }) {
  const texture = useTexture(textureUrl)
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace
  }, [texture])
  const sphere = sphereDetailFor(detailSize)
  return (
    <mesh>
      <sphereGeometry args={[radius, sphere.widthSegments, sphere.heightSegments]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0.05} />
    </mesh>
  )
}

/**
 * The rendered shape for a body, in priority order:
 * 1. A real 3D model (CelestialBody.modelUrl — e.g. a real ISS model
 *    instead of the generic station torus), if set and it loads.
 * 2. A real surface texture wrapped around a sphere (CelestialBody.
 *    textureUrl), if set, it loads, and the body's type is one
 *    PlaceholderBodyShape would otherwise render as a plain sphere.
 * 3. The generic per-type placeholder (PlaceholderBodyShape) — the
 *    default for every body, and the fallback if 1 or 2 were set but
 *    failed to load.
 */
function BodyShape({
  body,
  radius,
  color,
  detailSize,
}: {
  body: CelestialBody
  radius: number
  color: string
  detailSize: number
}) {
  const placeholder = <PlaceholderBodyShape body={body} radius={radius} color={color} detailSize={detailSize} />

  if (body.modelUrl) {
    return (
      <ModelErrorBoundary fallback={placeholder}>
        <Suspense fallback={placeholder}>
          <LoadedBodyModel url={body.modelUrl} radius={radius} />
        </Suspense>
      </ModelErrorBoundary>
    )
  }

  if (body.textureUrl && TEXTURABLE_BODY_TYPES.has(body.type)) {
    return (
      <ModelErrorBoundary fallback={placeholder}>
        <Suspense fallback={placeholder}>
          <TexturedSphereBody radius={radius} textureUrl={body.textureUrl} detailSize={detailSize} />
        </Suspense>
      </ModelErrorBoundary>
    )
  }

  return placeholder
}

function BodyMarker({
  body,
  position,
  radius,
  cameraDistance,
  selected,
  hovered,
  visible,
  showLabel,
  onSelect,
  onHoverLabel,
}: {
  body: CelestialBody
  position: [number, number, number]
  /** Precomputed by SceneContent via trueRadius (scale.ts), floored to a
   *  minimum on-screen pixel size via renderRadius (pixelFloor.ts) so a
   *  genuinely sub-pixel true-scale body still reads as a visible dot. Only
   *  the VISUAL geometry uses this floored value — camera-fit and
   *  hit-testing math elsewhere still use the real trueRadius directly. */
  radius: number
  /** Live camera-to-target distance (see CameraRig) — an approximation of
   *  the distance to THIS specific body (exact only when it's the one
   *  selected/focused), used purely to drive geometry detail (see
   *  levelOfDetail.ts). Good enough for that: LOD only needs "are we
   *  zoomed in a lot right now," not a pixel-perfect per-body distance,
   *  and avoids an expensive live camera-position query for every body
   *  every frame. */
  cameraDistance: number
  selected: boolean
  /** True when this is the current bubble-cursor proximity target (see
   *  ProximitySelector) — recomputed continuously from the pointer's
   *  screen-space distance to every visible body, not just this one's own
   *  label. A direct hover on the label itself (below) feeds the exact same
   *  shared state, so the two cooperate rather than compete — hovering the
   *  label is just a second, always-reliable way to reach the same result
   *  proximity selection already gives you when the pointer's simply near
   *  this body. */
  hovered: boolean
  /** LOD gate (see SceneContent) — a selected body is always shown
   *  regardless, so a zoomed-out selection doesn't disappear on you. */
  visible: boolean
  /** Label declutter (see labelDeclutter.ts/ProximitySelector) — this
   *  body's own dot/shape still renders regardless (unaffected by label
   *  crowding), but its TEXT label only draws when nothing structurally
   *  higher-priority (shallower in the real orbital hierarchy — the Sun
   *  over a planet, a planet over its own moon) already claimed the same
   *  screen-space spot. Selected/hovered are always exempt (forced to top
   *  priority before declutter runs — see ProximitySelector), so a
   *  suppressed label never hides the one you're actually interacting
   *  with. The body stays selectable either way — proximity selection
   *  works from the body's own position, not its label. */
  showLabel: boolean
  onSelect: (body: CelestialBody) => void
  onHoverLabel: (id: string | null) => void
}) {
  const color = body.color ?? BODY_TYPE_COLOR_FALLBACK[body.type] ?? '#94a3b8'
  const isHighlighted = selected || hovered
  // Selection/hover highlighting is a LABEL-only signal — the body's own
  // shape always renders its real colour (see color, above), never
  // overridden to white on selection. Label text deliberately does NOT use
  // the body's own render colour by default either — a neutral, always-
  // legible grey, same as before hover support existed — reserving colour
  // changes for actual state (selected/hovered) so "the text changes colour
  // on mouseover/select" reads as a clear signal, not lost among labels
  // that were already all different colours, and without altering how the
  // body itself actually looks.
  const labelColor = selected ? '#ffffff' : hovered ? '#22d3ee' : '#cbd5e1'

  if (!visible && !selected) return null

  function handleSelect(e: { stopPropagation: () => void }) {
    e.stopPropagation()
    onSelect(body)
  }

  const detailSize = apparentSize(radius, cameraDistance)

  return (
    <group position={position}>
      <BodyShape body={body} radius={radius} color={color} detailSize={detailSize} />
      {(showLabel || isHighlighted) && (
      <Html center style={{ transform: `translateY(${-(radius * 8 + 14)}px)` }}>
        <div
          onClick={handleSelect}
          onMouseEnter={() => onHoverLabel(body.id)}
          onMouseLeave={() => onHoverLabel(null)}
          style={{
            fontSize: 11,
            color: labelColor,
            fontWeight: isHighlighted ? 700 : 400,
            whiteSpace: 'nowrap',
            textShadow: '0 1px 2px rgba(0,0,0,0.9)',
            cursor: 'pointer',
            pointerEvents: 'auto',
            // This label exists purely as a click/hover target for body
            // selection (backed up by bubble-cursor proximity selection —
            // see ProximitySelector) — it was never meant to be readable,
            // copyable body text. Without this, clicking or dragging near
            // it could start the browser's native text-selection gesture
            // instead of registering as a body-select click, which is what
            // "hovering the text stops me selecting it" actually was: the
            // two interactions competing for the same mouse-down.
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {body.name}
        </div>
      </Html>
      )}
    </group>
  )
}

interface SceneContentProps {
  system: StarSystemData
  simDate: Date
  selectedId: string | null
  hoveredId: string | null
  visibleLabelIds: Set<string>
  cameraDistance: number
  wholeSystemDistance: number
  onSelect: (body: CelestialBody) => void
  onHoverLabel: (id: string | null) => void
  onVisibleLabelsChange: (ids: Set<string>) => void
  /** Mutable, read at click time by OrbitalSystemScene's onPointerMissed
   *  (see ProximitySelector) — a ref rather than state, since it needs to
   *  update every frame without triggering a React re-render each time. */
  hoveredIdRef: MutableRefObject<string | null>
  /** Ordered location-id chains for the route planner's currently-picked
   *  route (see lib/routing.ts's routeWaypointIds) — primary always drawn,
   *  alternate (if any) drawn dimmer/dashed alongside it to read as "also
   *  real, just not the one currently picked." Null when nothing's plotted. */
  routePreview: { primaryIds: string[]; alternateIds: string[] | null } | null
}

function SceneContent({
  system,
  simDate,
  selectedId,
  hoveredId,
  visibleLabelIds,
  cameraDistance,
  wholeSystemDistance,
  onSelect,
  onHoverLabel,
  onVisibleLabelsChange,
  hoveredIdRef,
  routePreview,
}: SceneContentProps) {
  const { size: viewportSize } = useThree()
  const positions = useMemo(() => resolveAllWorldPositions(system, simDate), [system, simDate])
  const visibleIds = useMemo(
    () => computeVisibleBodyIds(system, cameraDistance, wholeSystemDistance, selectedId),
    [system, cameraDistance, wholeSystemDistance, selectedId]
  )
  // Orbital depth (Sun=0, a planet=1, a moon=2, ...) — purely structural,
  // from parentId chains, not body.type — see labelDeclutter.ts. Only
  // depends on the system's own hierarchy, not zoom/selection, so it's
  // computed once per system rather than every frame.
  const depthById = useMemo(() => computeOrbitalDepth(system.bodies), [system])
  const proximityCandidates = useMemo(
    () =>
      system.bodies
        .filter((b) => visibleIds.has(b.id))
        .map((b) => ({ id: b.id, position: positions.get(b.id)!, priority: depthById.get(b.id) ?? 0 }))
        .filter((c) => c.position),
    [system, visibleIds, positions, depthById]
  )

  return (
    <>
      <ProximitySelector
        candidates={proximityCandidates}
        selectedId={selectedId}
        hoveredIdRef={hoveredIdRef}
        onHoverChange={onHoverLabel}
        onVisibleLabelsChange={onVisibleLabelsChange}
      />
      {/* Alternate drawn first (and dimmer/dashed) so the primary route —
          the one actually picked — always renders on top of it where the
          two would otherwise overlap. */}
      {routePreview?.alternateIds && (
        <RoutePreviewLine waypointIds={routePreview.alternateIds} positions={positions} color="#a855f7" dashed />
      )}
      {routePreview?.primaryIds && (
        <RoutePreviewLine waypointIds={routePreview.primaryIds} positions={positions} color="#22d3ee" />
      )}
      {system.bodies.map((body) => {
        const pos = positions.get(body.id)
        if (!pos) return null
        const parentWorldPos = (body.parentId && positions.get(body.parentId)) || ([0, 0, 0] as WorldVec)
        const bodyVisible = visibleIds.has(body.id)
        // A ring for every station/jump point/nav marker would be
        // unreadable clutter (a planet can have dozens) — reserved for
        // genuine celestial bodies, the same scope the old 2D map's own
        // orbit rings used.
        const showsOrbitReference = !NON_ORBITING_MARKER_TYPES.has(body.type) && body.parentId
        return (
          <group key={body.id}>
            {body.orbit && (
              <OrbitPathLine
                body={body}
                color={body.color ?? '#64748b'}
                parentWorldPos={parentWorldPos}
                cameraDistance={cameraDistance}
              />
            )}
            {!body.orbit && bodyVisible && showsOrbitReference && (
              <ReferenceOrbitRing
                position={pos}
                parentWorldPos={parentWorldPos}
                color={body.color ?? '#64748b'}
                cameraDistance={cameraDistance}
              />
            )}
            <BodyMarker
              body={body}
              position={pos}
              radius={renderRadius(trueRadius(body.radiusKm), cameraDistance, viewportSize.height)}
              cameraDistance={cameraDistance}
              selected={selectedId === body.id}
              hovered={hoveredId === body.id}
              visible={bodyVisible}
              showLabel={visibleLabelIds.has(body.id)}
              onSelect={onSelect}
              onHoverLabel={onHoverLabel}
            />
          </group>
        )
      })}
      {system.belts?.map((belt) => (
        <group key={belt.id}>
          {/* A flat glow disc only makes sense for something genuinely
              flat and full-circle — a 'cloud' (e.g. Oort) is a spherical
              shell, not a ring, and a co-orbital cluster only occupies a
              narrow arc, so both would look actively misleading here. */}
          {!belt.coOrbital && belt.type === 'belt' && <BeltGlowRing belt={belt} system={system} simDate={simDate} />}
          <BeltPoints belt={belt} system={system} simDate={simDate} />
        </group>
      ))}
    </>
  )
}

// How close (in actual screen pixels, not normalized device coordinates —
// see findNearestCandidate) the pointer has to be to a body's own
// projected point before bubble-cursor selection snaps to it. Generous
// enough to comfortably cover a trackpad/touch-imprecise click, small
// enough that two genuinely distant bodies never both compete for the same
// pointer position.
const PROXIMITY_SNAP_PX = 28

// How close two labels can sit before the lower-priority one (see
// computeOrbitalDepth) gets suppressed — wide enough to cover a typical
// short label's own width/height (the exact case this exists for: the ISS
// and Hubble's labels landing almost exactly on Earth's own, all three
// real bodies genuinely that close together on screen at true scale).
const LABEL_MIN_SEPARATION_PX = 32

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/**
 * Bubble-cursor proximity selection AND label decluttering — both are the
 * R3F-side wiring for lib/orbital-engine/proximitySelection.ts and
 * labelDeclutter.ts (see those modules for the algorithms and why they
 * exist), sharing one per-frame screen-space projection of every visible
 * body since both need exactly that. Every frame:
 *
 *  - finds whichever visible body's projected point is nearest the
 *    pointer, within PROXIMITY_SNAP_PX — that drives the hover highlight
 *    and, read from hoveredIdRef by OrbitalSystemScene's Canvas
 *    onPointerMissed, what a click selects (no mesh in this scene is
 *    itself raycastable any more — this replaces that entirely);
 *  - decides which bodies' TEXT labels actually draw, preferring
 *    structurally shallower bodies (the Sun over a planet, a planet over
 *    its own moon — see computeOrbitalDepth) when two labels would
 *    otherwise overlap. The selected body and the current proximity hover
 *    target are always forced to the front of that priority order, so
 *    decluttering never hides the label of whatever you're actually
 *    looking at or about to click.
 */
function ProximitySelector({
  candidates,
  selectedId,
  hoveredIdRef,
  onHoverChange,
  onVisibleLabelsChange,
}: {
  candidates: { id: string; position: WorldVec; priority: number }[]
  selectedId: string | null
  hoveredIdRef: MutableRefObject<string | null>
  onHoverChange: (id: string | null) => void
  onVisibleLabelsChange: (ids: Set<string>) => void
}) {
  const { camera, size } = useThree()
  const lastReportedHover = useRef<string | null>(null)
  const lastReportedLabels = useRef<Set<string>>(new Set())
  const projected = useRef(new THREE.Vector3())

  useFrame((state) => {
    const pointerPx = {
      x: (state.pointer.x * 0.5 + 0.5) * size.width,
      y: (-state.pointer.y * 0.5 + 0.5) * size.height,
    }
    const screenCandidates = candidates.map(({ id, position, priority }) => {
      projected.current.set(position[0], position[1], position[2]).project(camera)
      return {
        id,
        x: (projected.current.x * 0.5 + 0.5) * size.width,
        y: (-projected.current.y * 0.5 + 0.5) * size.height,
        priority,
      }
    })

    const proximityInput: ProximityCandidate[] = screenCandidates
    const nearest = findNearestCandidate(pointerPx.x, pointerPx.y, proximityInput, PROXIMITY_SNAP_PX)
    const nextHoverId = nearest?.id ?? null
    hoveredIdRef.current = nextHoverId
    if (nextHoverId !== lastReportedHover.current) {
      lastReportedHover.current = nextHoverId
      onHoverChange(nextHoverId)
    }

    // Selected/hovered are forced ahead of every real structural priority
    // (which starts at 0 for the star) so decluttering can never suppress
    // the label of whatever's actually selected or about to be clicked.
    const declutterInput: LabelCandidate[] = screenCandidates.map((c) => ({
      ...c,
      priority: c.id === selectedId ? -2 : c.id === nextHoverId ? -1 : c.priority,
    }))
    const visibleLabels = computeVisibleLabels(declutterInput, LABEL_MIN_SEPARATION_PX)
    if (!setsEqual(visibleLabels, lastReportedLabels.current)) {
      lastReportedLabels.current = visibleLabels
      onVisibleLabelsChange(visibleLabels)
    }
  })

  return null
}

/** Owns the OrbitControls target and smoothly flies the camera to a new
 *  focus (position + distance) when one is set — moving the camera only
 *  radially (along its current viewing direction) so the view doesn't
 *  suddenly reorient, just pans and zooms. */
interface FlyAnimation {
  startCameraPos: THREE.Vector3
  startTarget: THREE.Vector3
  endCameraPos: THREE.Vector3
  endTarget: THREE.Vector3
  startTimeMs: number
  /** The tracked body's live position at the moment this flight started —
   *  null if nothing trackable is selected (e.g. flying to a belt). Lets
   *  the flight keep endTarget/endCameraPos chasing the body's real motion
   *  while the animation is still in progress — see the tracking block in
   *  useFrame below for why a fixed endpoint isn't good enough here. */
  trackingStart: THREE.Vector3 | null
}

const FLY_DURATION_MS = 900

/** Ease-out cubic — fast at the start, settling gently into place, rather
 *  than a constant speed that feels abrupt when it stops. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function CameraRig({
  focus,
  trackedPosition,
  manualDistance,
  onDistanceChange,
  minDistance,
  nearPlane,
}: {
  focus: FocusTarget | null
  /** The currently-selected body's LIVE world position — recomputed by
   *  OrbitalSystemScene every time simDate advances — or null when nothing
   *  real is selected (a belt, or nothing at all). This is the fix for a
   *  real, observed bug: `focus` is a one-time snapshot (computed once
   *  when a body is selected), but a body with real orbital motion (see
   *  CelestialBody.orbit) keeps moving after that snapshot, including
   *  while the simulation plays on with nothing paused. At the extremely
   *  tight zoom a true-scale body needs (see scale.ts's trueRadius), even
   *  a small compressed-position drift sweeps the body clean out of frame
   *  within a couple of seconds — confirmed: camera position, target, AND
   *  orientation were all independently verified mathematically correct
   *  (0° angle to the target) immediately after a flight completed, yet
   *  the body was nowhere on screen, because by the time the flight
   *  finished the body had already moved on from the fixed point the
   *  flight was aimed at. Once a flight isn't actively in progress, this
   *  keeps the camera (and its target) shifted by exactly the body's own
   *  per-frame movement, so a completed selection tracks its target
   *  indefinitely instead of drifting away from it. */
  trackedPosition: readonly [number, number, number] | null
  /** Set by the zoom slider (see OrbitalSystemScene) — an immediate jump to
   *  this distance along the current viewing direction, bypassing the
   *  smooth fly-to animation entirely. A ref, not state: the slider fires
   *  on every drag/input event, and each one needs to apply straight away
   *  for the "zoom in and out very fast" the slider exists for — going
   *  through React state/props would add a render's worth of latency per
   *  step and there's no reason to pay it here. */
  manualDistance: MutableRefObject<number | null>
  onDistanceChange: (d: number) => void
  /** Per-selection camera-distance floor (see camera.ts's
   *  minCameraDistanceForRadius) — replaces a single fixed constant so a
   *  tiny true-scale body isn't held at arm's length by a floor sized for
   *  a whole solar system. */
  minDistance: number
  /** The near clip plane to match `minDistance` (see camera.ts's
   *  nearPlaneForRadius) — applied imperatively to the live camera below,
   *  since the Canvas's own `camera` prop only sets this once at mount. */
  nearPlane: number
}) {
  const { camera } = useThree()

  // The Canvas's `camera` prop only applies at mount — R3F doesn't
  // reactively re-apply it on prop changes — so keeping the near plane in
  // sync with whatever's selected (see nearPlane's own comment) has to
  // happen here, imperatively, whenever it changes.
  useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    if (perspectiveCamera.near !== nearPlane) {
      perspectiveCamera.near = nearPlane
      perspectiveCamera.updateProjectionMatrix()
    }
  }, [camera, nearPlane])
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null)
  // The last known-good unit viewing direction — used as a starting
  // direction for a new flight when the camera and target genuinely
  // coincide (only ever true on the very first frame, before anything's
  // been framed yet).
  const lastGoodDirection = useRef(new THREE.Vector3(0, 0.447, 0.894)) // matches the initial [0,60,120] camera offset
  const flight = useRef<FlyAnimation | null>(null)
  // The tracked body's world position as of the last frame — compared
  // against the current trackedPosition each frame to derive how far it
  // moved, which is then applied equally to both camera.position and
  // controls.target (see the tracking block in useFrame below).
  const lastTrackedPosition = useRef<THREE.Vector3 | null>(null)

  // Computed ONCE per new focus, from the camera/target's own CURRENT
  // (stable, pre-flight) state — not recomputed reactively every frame
  // during the flight itself. That reactive-recomputation design is what
  // three separate real, observed bugs this turn all traced back to: a
  // direction/distance computed fresh each frame from wherever the camera
  // and target currently sat could read a degenerate, coincidentally-close,
  // or otherwise transient in-flight state and permanently corrupt the
  // rest of the animation from there (camera colliding with a body,
  // landing looking at empty space, etc). A start/end pair fixed at flight
  // start and a straightforward eased interpolation between them has no
  // such feedback loop: the destination is exactly where distanceToFit
  // computed it to be, guaranteed by construction, regardless of how
  // convoluted the path to get there is.
  useEffect(() => {
    if (!focus) return
    const controls = controlsRef.current
    if (!controls) return
    const startTarget = (controls.target as THREE.Vector3).clone()
    const startCameraPos = camera.position.clone()
    const rawDir = startCameraPos.clone().sub(startTarget)
    const rawLength = rawDir.length()
    const direction = rawLength > 1e-6 ? rawDir.divideScalar(rawLength) : lastGoodDirection.current.clone()
    lastGoodDirection.current = direction.clone()
    const endTarget = new THREE.Vector3(...focus.position)
    const endCameraPos = endTarget.clone().addScaledVector(direction, focus.distance)
    const trackingStart = trackedPosition ? new THREE.Vector3(...trackedPosition) : null
    flight.current = { startCameraPos, startTarget, endCameraPos, endTarget, startTimeMs: performance.now(), trackingStart }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const lastReportedDistance = useRef(-1)
  useFrame(() => {
    const controls = controlsRef.current
    if (!controls) return
    const controlsTarget = controls.target as THREE.Vector3

    // A slider drag takes priority over any in-progress flight and jumps
    // straight there — no smooth interpolation, since the whole point of
    // the slider is an immediate, direct response, the same way scrolling
    // to zoom is immediate. Consumed once (reset to null) so it only
    // fires for genuinely new slider input, not every subsequent frame.
    if (manualDistance.current !== null) {
      flight.current = null
      camera.position.copy(controlsTarget).addScaledVector(lastGoodDirection.current, manualDistance.current)
      manualDistance.current = null
    }

    const anim = flight.current
    if (anim) {
      // If the target is a moving body (trackingStart set at flight start —
      // see FlyAnimation's own comment), shift the flight's endpoint by
      // however far the body has moved since the flight began, every frame,
      // BEFORE lerping toward it. Without this, a body under simulated
      // motion keeps moving during the ~900ms flight while the flight aims
      // at a fixed snapshot of where it was at selection time — at the
      // extremely tight zoom a true-scale body needs, even the body's
      // ordinary motion over less than a second is enough to land the
      // camera pointed at empty space the instant the flight completes,
      // the exact bug this fixes: the body visibly vanishing right as the
      // camera finishes arriving.
      if (anim.trackingStart && trackedPosition) {
        const live = new THREE.Vector3(...trackedPosition)
        const movedSinceLastFrame = live.clone().sub(anim.trackingStart)
        anim.endTarget.copy(live)
        anim.endCameraPos.add(movedSinceLastFrame)
        anim.trackingStart.copy(live)
      }
      const t = Math.min(1, (performance.now() - anim.startTimeMs) / FLY_DURATION_MS)
      const eased = easeOutCubic(t)
      controlsTarget.lerpVectors(anim.startTarget, anim.endTarget, eased)
      camera.position.lerpVectors(anim.startCameraPos, anim.endCameraPos, eased)
      if (t >= 1) flight.current = null
      // A fresh flight always starts from wherever the body currently is
      // (computeFocusForBody, in OrbitalSystemScene, is called with the
      // live simDate) — resetting this here means tracking below picks up
      // cleanly from the flight's own real endpoint, not from wherever the
      // body was when a previous selection last tracked it.
      lastTrackedPosition.current = null
    } else if (trackedPosition) {
      // No flight in progress and something real is selected: keep the
      // camera locked onto it. See this prop's own comment for why this
      // exists — a completed fly-to targets a fixed point, but a real
      // orbiting body doesn't stay at that point.
      const live = new THREE.Vector3(...trackedPosition)
      if (lastTrackedPosition.current) {
        const delta = live.clone().sub(lastTrackedPosition.current)
        if (delta.lengthSq() > 0) {
          controlsTarget.add(delta)
          camera.position.add(delta)
        }
      }
      lastTrackedPosition.current = live
    } else {
      lastTrackedPosition.current = null
    }

    // Explicit, every frame this loop touches camera.position/target at all
    // (during a flight, a manual zoom, or the safety-net clamp below) — not
    // left to OrbitControls' own update() to infer. Moving camera.position
    // doesn't rotate the camera to face it; only the camera's own
    // quaternion controls what it's actually pointed at, and an abrupt
    // external position change (exactly what a flight or a slider jump is)
    // isn't guaranteed to leave OrbitControls' own internal orientation
    // tracking in a state that still points at the new target. This was a
    // real, observed bug: the camera's reported position/distance were
    // numerically correct — confirmed by logging them — while the
    // rendered view showed nothing anywhere near the selected body,
    // because the camera was still facing whatever direction it was
    // oriented in before the jump.
    camera.lookAt(controlsTarget)

    // Hard safety net, independent of whatever bug might otherwise cause
    // it: this loop writes camera.position directly every frame, which
    // completely bypasses OrbitControls' own minDistance (that only
    // constrains ITS dolly/zoom handlers, not external position writes).
    // Floored at `minDistance` (matched to the near plane set above via
    // nearPlane — see camera.ts's minCameraDistanceForRadius), not some
    // larger "comfortable" distance — a comfortable-for-a-planet distance
    // is a hard wall for a true-scale body like the ISS (see scale.ts's
    // trueRadius), which is smaller than Earth's own radius by 8+ orders
    // of magnitude; the whole point of true scale + bubble-cursor
    // selection is being able to get arbitrarily close to a tiny object,
    // so the only distance that's ever actually unsafe is one that clips
    // the (per-selection) near plane or collapses to zero.
    const liveOffset = camera.position.clone().sub(controlsTarget)
    const liveLength = liveOffset.length()
    if (liveLength < minDistance) {
      const pushBackDirection = liveLength > 1e-6 ? liveOffset.divideScalar(liveLength) : lastGoodDirection.current
      camera.position.copy(controlsTarget).addScaledVector(pushBackDirection, minDistance)
    }

    controls.update()

    // Report the live camera-to-target distance for LOD (see BodyMarker) —
    // epsilon-throttled so a continuous drag/zoom gesture doesn't trigger a
    // full re-render every single frame, only when it's moved enough to
    // matter.
    const liveDistance = camera.position.distanceTo(controlsTarget)
    if (Math.abs(liveDistance - lastReportedDistance.current) > liveDistance * 0.02) {
      lastReportedDistance.current = liveDistance
      onDistanceChange(liveDistance)
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.1}
      minDistance={minDistance}
      maxDistance={2000}
    />
  )
}

function TimeDriver({
  playing,
  daysPerSecond,
  onTick,
}: {
  playing: boolean
  daysPerSecond: number
  onTick: (advanceMs: number) => void
}) {
  const accumulator = useRef(0)
  useFrame((_, delta) => {
    if (!playing) return
    accumulator.current += delta
    // Update ~10x/second rather than every frame — plenty smooth for
    // orbital motion, far cheaper than a full state update at 60fps.
    if (accumulator.current < 0.1) return
    const advanceMs = accumulator.current * daysPerSecond * 86_400_000
    accumulator.current = 0
    onTick(advanceMs)
  })
  return null
}

/** An externally-requested selection (e.g. a "jump to this object" button
 *  elsewhere in a host app) — a body id plus a token that changes on every
 *  request, even a repeat of the same id, so requesting a focus on X again
 *  while already there still re-flies the camera there instead of being a
 *  no-op. `system` is switched by the CALLER before/alongside this (this
 *  component only knows about whatever `system` it's currently given). */
export interface ExternalFocusRequest {
  bodyId: string
  token: number
}

/** Ordered location-id chains for a currently-picked route, drawn as a line
 *  on the map (see RoutePreviewLine) — only the portion whose waypoints are
 *  bodies in THIS system actually renders, since the map only ever shows
 *  one system at a time. */
export interface RoutePreview {
  primaryIds: string[]
  alternateIds: string[] | null
}

export interface OrbitalSystemSceneProps {
  system: StarSystemData
  /** Notified whenever a body is selected (map click or dropdown) — lets a
   *  caller cross-reference the body id against its own data without this
   *  component needing to know anything about that data. */
  onSelectBody?: (body: CelestialBody) => void
  /** See ExternalFocusRequest. Null/undefined is a no-op. */
  externalFocus?: ExternalFocusRequest | null
  /** See RoutePreview. Null draws nothing. */
  routePreview?: RoutePreview | null
}

export function OrbitalSystemScene({
  system,
  onSelectBody,
  externalFocus,
  routePreview,
}: OrbitalSystemSceneProps) {
  const [simDate, setSimDate] = useState(() => new Date())
  const [playing, setPlaying] = useState(true)
  const [daysPerSecond, setDaysPerSecond] = useState(2)
  const [selection, setSelection] = useState<Selection>(null)
  const [focus, setFocus] = useState<FocusTarget | null>(null)
  // Live camera-to-target distance (see CameraRig), used purely for the LOD
  // gate in SceneContent — wholeSystemDistance is the reference "zoomed all
  // the way out" distance for whatever system is currently loaded, so the
  // reveal threshold scales with each system's own real size instead of a
  // fixed absolute number.
  const [cameraDistance, setCameraDistance] = useState(DEFAULT_CAMERA_DISTANCE)
  // Written by the zoom slider's onChange, read+consumed once by CameraRig
  // — see that ref's own comment for why this is a ref (immediate effect
  // on every drag step) rather than state. The slider's own displayed
  // position is derived directly from cameraDistance (below) rather than
  // tracked separately, so it always reflects reality regardless of
  // whether the camera got there by flying to a selection, a mouse-wheel
  // scroll, or the slider itself.
  const manualZoomDistanceRef = useRef<number | null>(null)
  // Current bubble-cursor proximity target (see ProximitySelector) — state
  // drives the visual hover highlight; the ref is read by the Canvas's own
  // onPointerMissed below, since a plain click handler there can't read
  // React state captured at render time (it'd be stale by the time a click
  // actually happens, given the target changes every frame via useFrame,
  // not via a re-render).
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  // Which bodies' text labels are actually shown right now — recomputed
  // continuously by ProximitySelector as the camera moves (see
  // labelDeclutter.ts). Starts empty; the first frame after mount fills it
  // in, same as hoveredId.
  const [visibleLabelIds, setVisibleLabelIds] = useState<Set<string>>(new Set())
  // Deliberately not re-derived every simDate tick — this is a reference
  // scale for LOD, not a live position; recomputing it as bodies drift
  // slightly over time would just add churn for no visible benefit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wholeSystemDistance = useMemo(() => computeFocusForSystem(system, simDate).distance, [system])
  // A system built entirely from fixed position snapshots (e.g. Star
  // Citizen data — see CelestialBody.fixedPosition) has no real orbital
  // motion to animate; showing play/speed controls that visibly do nothing
  // would be actively confusing rather than just unnecessary.
  const hasOrbitalMotion = useMemo(() => system.bodies.some((b) => b.orbit), [system])

  const selectedBody = selection?.kind === 'body' ? (system.bodies.find((b) => b.id === selection.id) ?? null) : null
  const selectedBelt = selection?.kind === 'belt' ? (system.belts?.find((b) => b.id === selection.id) ?? null) : null
  // Both derived from the selected body's own true-scale radius (see
  // camera.ts's nearPlaneForRadius/minCameraDistanceForRadius) — replacing
  // one fixed floor everywhere with a per-selection one is the actual fix
  // for zoom feeling capped: a fixed floor sized for a whole solar system
  // held the camera at arm's length from anything true-scale-tiny (the ISS
  // is ~5x10⁻⁸ world units — a "comfortable" floor for Earth is 300,000x
  // that). null (nothing selected) falls back to the old fixed defaults.
  const selectedBodyRadius = selectedBody ? trueRadius(selectedBody.radiusKm) : null
  const dynamicNearPlane = nearPlaneForRadius(selectedBodyRadius)
  // The zoom slider's own effective minimum, and the camera's hard floor
  // (see CameraRig's minDistance prop) — shared so the slider's displayed
  // position always agrees with what range [0, 1] actually spans.
  const zoomSliderMinDistance = minCameraDistanceForRadius(selectedBodyRadius)
  // The selected body's LIVE world position, recomputed every time simDate
  // advances — see CameraRig's trackedPosition prop for why this exists
  // (a real orbiting body doesn't stay where it was when first selected).
  const trackedPosition = selectedBody ? resolveWorldPosition(selectedBody, system.bodies, simDate) : null

  // Split from selectBody (below) on purpose: this updates the scene's own
  // selection/camera state only, without notifying onSelectBody — used by
  // the externalFocus effect further down, so that flying the camera to an
  // ALREADY-CHOSEN location (the route planner's "jump to this object"
  // button) doesn't ALSO re-fire onSelectBody as if the user had just
  // freshly clicked a body on the map. Real, observed bug this fixes: the
  // route planner's onSelectBody handler fills whichever of
  // origin/destination is "active" and then flips which one is active —
  // exactly right for a genuine map click, but firing that same logic
  // again right after a jump-to-location click (which already knows
  // exactly which field it's for) stomped the field the jump had just set
  // and silently flipped the active slot out from under the user.
  function focusOnBody(body: CelestialBody) {
    setSelection({ kind: 'body', id: body.id })
    setFocus(computeFocusForBody(body, system, simDate))
  }
  function selectBody(body: CelestialBody) {
    focusOnBody(body)
    onSelectBody?.(body)
  }
  function selectBelt(belt: BeltRegion) {
    setSelection({ kind: 'belt', id: belt.id })
    setFocus(computeFocusForBelt(belt, system, simDate))
  }
  // Fires for every canvas click that doesn't hit a raycastable object —
  // which, now that body selection goes entirely through bubble-cursor
  // proximity (see ProximitySelector), is every click: no mesh in this
  // scene has its own onClick any more. Selects whatever proximity
  // selection currently has as its nearest target, if anything's within
  // the snap radius; a click in genuinely empty space is a no-op.
  function handleCanvasClick() {
    const id = hoveredIdRef.current
    if (!id) return
    const body = system.bodies.find((b) => b.id === id)
    if (body) selectBody(body)
  }
  function handleDropdownChange(value: string) {
    if (!value) return
    const [kind, id] = value.split(':') as ['body' | 'belt', string]
    if (kind === 'body') {
      const body = system.bodies.find((b) => b.id === id)
      if (body) selectBody(body)
    } else {
      const belt = system.belts?.find((b) => b.id === id)
      if (belt) selectBelt(belt)
    }
  }

  // "Up" always lands on a body — a belt's parent is a body, and a body's
  // parent (if any) is a body. Disabled once there's nowhere further up to
  // go (the star itself, whose parentId is null).
  function goUp() {
    const parentId = selectedBody?.parentId ?? selectedBelt?.parentId ?? null
    if (!parentId) return
    const parent = system.bodies.find((b) => b.id === parentId)
    if (parent) selectBody(parent)
  }
  // "Down" descends into the first real child of the selected body (its
  // own list order — e.g. a planet's moons appear right after it in the
  // dataset) — a body can have several children, so this is a reasonable
  // single choice, not the only possible one. No-op for a belt (nothing
  // orbits a belt) or a childless body.
  function goDown() {
    if (!selectedBody) return
    const child = system.bodies.find((b) => b.parentId === selectedBody.id)
    if (child) selectBody(child)
  }
  function recenter() {
    if (selectedBody) setFocus(computeFocusForBody(selectedBody, system, simDate))
    else if (selectedBelt) setFocus(computeFocusForBelt(selectedBelt, system, simDate))
  }
  function reset() {
    setSelection(null)
    setFocus(computeFocusForSystem(system, simDate))
  }

  // Slider input is [0, 1], log-mapped to the camera's real distance range
  // (see zoomSlider.ts for why logarithmic — this engine's distances span
  // ~5 orders of magnitude, from a true-scale body like the ISS out to the
  // whole system). Written straight to the ref CameraRig reads, not state
  // — see that ref's own comment for why: a slider is dragged continuously,
  // and each step needs to move the camera immediately, the same way
  // scrolling to zoom does, not after a render round-trip.
  //
  // Floored via zoomSliderMinDistance (camera.ts's
  // minCameraDistanceForRadius, keyed to the SELECTED body's own
  // true-scale radius) rather than one fixed constant — two real, observed
  // bugs this fixes: a big body like Jupiter (own radius ~0.061) or the Sun
  // (~0.6) used to let the slider's fixed floor put the camera literally
  // inside the body's own solid sphere (backface culling made it render as
  // empty space), while a true-scale-tiny body like the ISS or a station
  // used to be held at arm's length by that same fixed floor, never able to
  // get meaningfully close. Deriving the floor from whatever's actually
  // selected fixes both at once.
  function handleZoomSliderChange(sliderPosition: number) {
    manualZoomDistanceRef.current = sliderPositionToDistance(sliderPosition, zoomSliderMinDistance, MAX_CAMERA_DISTANCE)
  }

  // Frame the whole system on first load, and again whenever a different
  // system is loaded in (e.g. switching between star systems in a
  // multi-system app) — without
  // this, a newly-loaded system keeps whatever camera position the
  // previous one left behind, which is almost never a sane framing for it.
  useEffect(() => {
    setSelection(null)
    setFocus(computeFocusForSystem(system, simDate))
    setHoveredId(null)
    hoveredIdRef.current = null
    setVisibleLabelIds(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.id])

  // An externally-requested selection (see this prop's own comment) —
  // deliberately registered AFTER the system-reset effect above, so on a
  // cross-system jump (system.id AND externalFocus changing together in one
  // commit) this runs second and wins, landing on the actually-requested
  // body instead of getting overwritten back to "nothing selected, whole
  // system framed."
  useEffect(() => {
    if (!externalFocus) return
    const body = system.bodies.find((b) => b.id === externalFocus.bodyId)
    // focusOnBody, not selectBody — see focusOnBody's own comment: this is
    // an already-chosen location's camera catching up, not a fresh user
    // pick, so it must not re-fire onSelectBody.
    if (body) focusOnBody(body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFocus?.bodyId, externalFocus?.token, system.id])

  const canGoUp = !!(selectedBody?.parentId ?? selectedBelt?.parentId)
  const canGoDown = !!selectedBody && system.bodies.some((b) => b.parentId === selectedBody.id)

  return (
    <div style={uiStyles.root}>
      <div style={uiStyles.toolbar}>
        <select
          value={selection ? `${selection.kind}:${selection.id}` : ''}
          onChange={(e) => handleDropdownChange(e.target.value)}
          style={uiStyles.select}
        >
          <option value="">— select an object —</option>
          <optgroup label="Bodies">
            {system.bodies.map((b) => (
              <option key={b.id} value={`body:${b.id}`}>
                {b.name}
              </option>
            ))}
          </optgroup>
          {system.belts && system.belts.length > 0 && (
            <optgroup label="Belts / clusters">
              {system.belts.map((b) => (
                <option key={b.id} value={`belt:${b.id}`}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <button onClick={goUp} disabled={!canGoUp} title="Zoom out to the parent body" style={buttonStyle(!canGoUp)}>
          ↑ Up
        </button>
        <button
          onClick={goDown}
          disabled={!canGoDown}
          title="Zoom in to the first orbiting object"
          style={buttonStyle(!canGoDown)}
        >
          ↓ Down
        </button>
        <button
          onClick={recenter}
          disabled={!selection}
          title="Snap back to the correct zoom for the selected object"
          style={buttonStyle(!selection)}
        >
          ⟲ Recenter
        </button>
        <button onClick={reset} title="Clear selection and return to the whole-system overview" style={buttonStyle()}>
          Reset
        </button>

        <label style={uiStyles.zoomLabel}>
          Zoom
          <input
            type="range"
            min={0}
            max={1000}
            step={1}
            value={distanceToSliderPosition(cameraDistance, zoomSliderMinDistance, MAX_CAMERA_DISTANCE) * 1000}
            onChange={(e) => handleZoomSliderChange(Number(e.target.value) / 1000)}
            title="Zoom in/out directly — logarithmic, so a small drag near either end reaches a true-scale object or the whole system just as fast as the middle of the slider does"
            style={{ width: 160 }}
          />
        </label>
      </div>

      <div style={uiStyles.canvasWrap}>
        <Canvas
          camera={{ position: [0, 60, 120], fov: VERTICAL_FOV_DEG, near: DEFAULT_NEAR_PLANE, far: 100000 }}
          onPointerMissed={handleCanvasClick}
          gl={{ logarithmicDepthBuffer: true }}
        >
          <color attach="background" args={['#000000']} />
          <ambientLight intensity={0.45} />
          {/* A single fixed-direction light so lit bodies (planets/moons/
              asteroids/stations — see BodyShape) read as shaded 3D spheres
              instead of flat colour discs. Not tied to any body's real
              position (this engine has no per-frame "which way is the
              star" concept for a fixed-position body) — a plain, honest
              legibility aid, not a claim about real lighting direction. */}
          <directionalLight position={[40, 60, 30]} intensity={1.1} />
          {hasOrbitalMotion && (
            <TimeDriver
              playing={playing}
              daysPerSecond={daysPerSecond}
              onTick={(ms) => setSimDate((d) => new Date(d.getTime() + ms))}
            />
          )}
          <SceneContent
            system={system}
            simDate={simDate}
            selectedId={selectedBody?.id ?? null}
            hoveredId={hoveredId}
            visibleLabelIds={visibleLabelIds}
            cameraDistance={cameraDistance}
            wholeSystemDistance={wholeSystemDistance}
            onSelect={selectBody}
            onHoverLabel={setHoveredId}
            onVisibleLabelsChange={setVisibleLabelIds}
            hoveredIdRef={hoveredIdRef}
            routePreview={routePreview ?? null}
          />
          <CameraRig
            focus={focus}
            trackedPosition={trackedPosition}
            manualDistance={manualZoomDistanceRef}
            onDistanceChange={setCameraDistance}
            minDistance={zoomSliderMinDistance}
            nearPlane={dynamicNearPlane}
          />
        </Canvas>

        {hasOrbitalMotion && (
          <div style={uiStyles.timeBar}>
            <button onClick={() => setPlaying((p) => !p)} style={uiStyles.button}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: UI_COLORS.textMuted }}>
              Speed
              <input
                type="range"
                min={0}
                max={50}
                step={0.5}
                value={daysPerSecond}
                onChange={(e) => setDaysPerSecond(Number(e.target.value))}
              />
              <span style={{ color: UI_COLORS.text, fontFamily: 'monospace', width: 64 }}>
                {daysPerSecond.toFixed(1)} d/s
              </span>
            </label>
            <span style={{ color: UI_COLORS.textMuted, marginLeft: 'auto', fontFamily: 'monospace' }}>
              {simDate.toISOString().slice(0, 10)}
            </span>
          </div>
        )}

        {selectedBody && (
          <div style={uiStyles.infoPanel}>
            <div style={uiStyles.infoPanelTitle}>{selectedBody.name}</div>
            <div style={uiStyles.muted}>{selectedBody.type.replace('_', ' ')}</div>
            <div style={uiStyles.muted}>
              radius: {hasOrbitalMotion ? `${selectedBody.radiusKm.toLocaleString()} km` : formatDistanceKm(selectedBody.radiusKm)}
            </div>
            {selectedBody.orbit && (
              <>
                <div style={uiStyles.muted}>a: {(selectedBody.orbit.semiMajorAxisKm / 149_597_870.7).toFixed(3)} AU</div>
                <div style={uiStyles.muted}>e: {selectedBody.orbit.eccentricity}</div>
                <div style={uiStyles.muted}>i: {selectedBody.orbit.inclinationDeg}°</div>
                <div style={uiStyles.muted}>period: {selectedBody.orbit.orbitalPeriodDays.toLocaleString()} days</div>
              </>
            )}
            {selectedBody.note && <div style={uiStyles.mutedItalic}>{selectedBody.note}</div>}
          </div>
        )}

        {selectedBelt && (
          <div style={uiStyles.infoPanel}>
            <div style={uiStyles.infoPanelTitle}>{selectedBelt.name}</div>
            <div style={uiStyles.muted}>{selectedBelt.type}</div>
            <div style={uiStyles.muted}>
              {hasOrbitalMotion
                ? `${(selectedBelt.innerRadiusKm / 149_597_870.7).toFixed(2)}–${(selectedBelt.outerRadiusKm / 149_597_870.7).toFixed(2)} AU`
                : `${formatDistanceKm(selectedBelt.innerRadiusKm, 1)}–${formatDistanceKm(selectedBelt.outerRadiusKm, 1)}`}
            </div>
            {selectedBelt.coOrbital && (
              <div style={uiStyles.muted}>
                co-orbital with {system.bodies.find((b) => b.id === selectedBelt.coOrbital!.bodyId)?.name ?? selectedBelt.coOrbital.bodyId},{' '}
                {selectedBelt.coOrbital.leadAngleDeg > 0 ? '+' : ''}
                {selectedBelt.coOrbital.leadAngleDeg}°
              </div>
            )}
            {selectedBelt.note && <div style={uiStyles.mutedItalic}>{selectedBelt.note}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
