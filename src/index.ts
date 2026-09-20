// Data contract
export type {
  BodyType,
  OrbitalElements,
  FixedPosition,
  CelestialBody,
  BeltRegion,
  StarSystemData,
} from './types'

// Real astronomy: Keplerian propagation
export type { Vec3Km } from './kepler'
export { positionAtTime, orbitPath } from './kepler'

// Reference Solar System data (validation set / demo data)
export { SOLAR_SYSTEM } from './solarSystemData'

// World-position resolution (orbit + fixedPosition, hierarchical)
export type { WorldVec } from './render'
export {
  compressVec,
  compressVecByRatio,
  compressionRatio,
  orbitCompressionRatio,
  resolveWorldPosition,
  resolveAllWorldPositions,
} from './render'
export { resolveAbsolutePosition, resolveAllPositions, coOrbitalReferenceAngle } from './resolve'

// True-scale compression + the pixel-floor visibility system
export { compressDistance, trueRadius } from './scale'
export { minVisibleWorldRadius, renderRadius } from './pixelFloor'

// Camera framing / fly-to targets
export {
  DEFAULT_CAMERA_DISTANCE,
  MIN_CAMERA_DISTANCE,
  DEFAULT_NEAR_PLANE,
  ABSOLUTE_MIN_CAMERA_DISTANCE,
  MAX_CAMERA_DISTANCE,
  VERTICAL_FOV_DEG,
  nearPlaneForRadius,
  minCameraDistanceForRadius,
  distanceToFit,
  computeFocusForBody,
  computeFocusForSystem,
  computeFocusForBelt,
} from './camera'
export type { FocusTarget } from './camera'

// Visibility / level of detail
export { MAX_VISIBLE_SECONDARY, computeVisibleBodyIds, isAlwaysVisible } from './visibility'
export { apparentSize, sphereDetailFor, icosahedronDetailFor, torusDetailFor, orbitDetailFor } from './levelOfDetail'
export type { SphereDetail } from './levelOfDetail'

// Bubble-cursor proximity selection + label decluttering
export { findNearestCandidate } from './proximitySelection'
export type { ProximityCandidate } from './proximitySelection'
export { computeOrbitalDepth, computeVisibleLabels, thinByScreenProximity } from './labelDeclutter'
export type { LabelCandidate, ScreenCandidate } from './labelDeclutter'

// Misc utilities
export { formatDistanceKm } from './units'
export { routeSegments } from './routeSegments'
export { sliderPositionToDistance, distanceToSliderPosition } from './zoomSlider'

// Dev-mode performance overlay (object-count/LOD half — see
// OrbitalSystemScene's devMode prop, 'orbital-engine/react'). The
// renderer-stats half (FPS/draw calls/triangles) lives entirely inside
// that Canvas-bound component and isn't exported standalone.
export { computeObjectCounts, lodSummaryFor } from './devStats'
export type { ObjectCounts } from './devStats'

// The React / react-three-fiber renderer (OrbitalSystemScene) is a
// separate entry point — 'orbital-engine/react' — not re-exported here.
// It carries a 'use client' directive for Next.js/RSC-aware bundlers;
// keeping it out of this entry means everything above stays usable from
// server code / non-React contexts without pulling in a client boundary.
