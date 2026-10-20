/**
 * The star-lit materials: a body's surface (day/night terminator, eclipse
 * and ring shadows), its ring discs (lit by the star, shadowed by the
 * planet) and its atmosphere rim (brighter on the day side). Plain
 * ShaderMaterials with `lights: false` — they take the star from their
 * own uniforms, not three's scene lights, because a scene light's
 * position is in the compressed world (scale.ts), and a light from there
 * can't produce a true-geometry shadow. Three's lights still light every
 * other material (glTF models, stations, the built shapes) — see
 * StarLight.
 *
 * Everything is worked out in the mesh's OBJECT space — the body is the
 * unit sphere at the origin; rings are in body radii — with the uniforms
 * rotated into it on the CPU just before each draw (`applyBodyLight`, via
 * the mesh's onBeforeRender). See starLighting.ts for why that makes the
 * result independent of RenderPass's floating origin.
 *
 * The GLSL shadow functions are ports of shadows.ts, which is where the
 * maths is unit-tested; keep the two in step.
 *
 * Brightness: full sun at normal incidence is 1 × albedo — a texture
 * shows as photographed at noon. The night side gets
 * `nightSideBrightness` × albedo, a legibility floor (the real night side
 * of an airless body is black but for planetshine). Tone mapping and the
 * output colour space are applied the same way three's own materials do,
 * so these sit alongside them consistently.
 */
import * as THREE from 'three'
import type { StarLightingStore } from './starLighting'
import { MAX_OCCLUDERS, MAX_RING_BANDS, bodyPointToObjectSpace, directionToObjectSpace } from './starLighting'

const SHADOW_GLSL = /* glsl */ `
#define MAX_OCCLUDERS ${MAX_OCCLUDERS}
#define MAX_RING_BANDS ${MAX_RING_BANDS}
uniform vec3 uStarDir;
uniform float uStarAngularRadius;
uniform float uAmbient;
uniform vec4 uOccluders[MAX_OCCLUDERS];
uniform int uOccluderCount;
uniform vec3 uRingNormal;
uniform vec3 uRingBands[MAX_RING_BANDS];
uniform int uRingBandCount;

// shadows.ts discOverlapFraction, with every angle divided by the star's
// radius first so the arithmetic is around 1, not 1e-4, in float32.
float discOverlapFraction(float a, float b, float d) {
  if (a <= 0.0 || b <= 0.0) return 0.0;
  b /= a; d = abs(d) / a; a = 1.0;
  if (d >= a + b) return 0.0;
  if (d <= abs(a - b)) return b >= a ? 1.0 : b * b;
  float alpha = acos(clamp((d * d + a * a - b * b) / (2.0 * d * a), -1.0, 1.0));
  float beta = acos(clamp((d * d + b * b - a * a) / (2.0 * d * b), -1.0, 1.0));
  float kite = 0.5 * sqrt(max(0.0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)));
  return clamp((a * a * alpha + b * b * beta - kite) / PI, 0.0, 1.0);
}

// shadows.ts sphereShadowFactor.
float sphereShadowFactor(vec3 p, vec3 starDir, float starRadius, vec3 centre, float radius) {
  vec3 toOccluder = centre - p;
  float dist = length(toOccluder);
  if (dist <= radius) return 1.0;
  float separation = atan(length(cross(toOccluder, starDir)), dot(toOccluder, starDir));
  float occluderRadius = asin(radius / dist);
  if (separation >= starRadius + occluderRadius) return 1.0;
  return 1.0 - discOverlapFraction(starRadius, occluderRadius, separation);
}

// shadows.ts ringShadowTransmission.
float ringShadowTransmission(vec3 p, vec3 starDir, float starRadius) {
  float facing = dot(starDir, uRingNormal);
  if (abs(facing) < 1e-6) return 1.0;
  float t = -dot(p, uRingNormal) / facing;
  if (t <= 0.0) return 1.0;
  float r = length(p + starDir * t);
  float blur = max(starRadius * t, 1e-4);
  float transmission = 1.0;
  for (int i = 0; i < MAX_RING_BANDS; i++) {
    if (i >= uRingBandCount) break;
    vec3 band = uRingBands[i];
    float coverage = smoothstep(band.x - blur, band.x + blur, r) * (1.0 - smoothstep(band.y - blur, band.y + blur, r));
    transmission *= 1.0 - clamp(band.z, 0.0, 1.0) * coverage;
  }
  return transmission;
}

float eclipseFactor(vec3 p) {
  float light = 1.0;
  for (int i = 0; i < MAX_OCCLUDERS; i++) {
    if (i >= uOccluderCount) break;
    light *= sphereShadowFactor(p, uStarDir, uStarAngularRadius, uOccluders[i].xyz, uOccluders[i].w);
  }
  return light;
}
`

/** The brightness model every star-lit surface shares — the full-path
 *  bodies' and the instanced small bodies' (createLitInstancedMaterial),
 *  so a body promoted from one path to the other doesn't change shade. */
const STAR_LIGHT_GLSL = /* glsl */ `
// Lambert: a matte surface's brightness goes as the cosine of the sun's
// angle from overhead, reaching zero at the terminator.
float starLambert(vec3 normal, vec3 starDir) {
  return max(dot(normal, starDir), 0.0);
}
// Full sun at normal incidence is 1 × albedo; the night side keeps
// ambient (nightSideBrightness) × albedo.
vec3 starLitColor(vec3 albedo, float light, float ambient) {
  return albedo * (ambient + light);
}
// A flat-shaded face's normal, from the screen-space derivatives of the
// position (in whatever space the star direction is): three's
// flatShading, for the asteroid's faceted rock.
vec3 faceNormal(vec3 position) {
  return normalize(cross(dFdx(position), dFdy(position)));
}
`

const VERTEX_GLSL = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObjectPosition;
varying vec3 vObjectNormal;
varying vec2 vUv;
void main() {
  vObjectPosition = position;
  vObjectNormal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`

/** three ≥ 0.154 calls the output colour-space chunk colorspace_fragment;
 *  0.152–0.153 (the oldest supported peer) called it encodings_fragment. */
const OUTPUT_CHUNKS = `
#include <tonemapping_fragment>
#include <${'colorspace_fragment' in THREE.ShaderChunk ? 'colorspace_fragment' : 'encodings_fragment'}>
`

const SURFACE_FRAGMENT_GLSL = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SHADOW_GLSL}
${STAR_LIGHT_GLSL}
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uUseMap;
uniform float uEclipses;
uniform float uRingShadows;
varying vec3 vObjectPosition;
varying vec3 vObjectNormal;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  vec3 albedo = uColor;
  if (uUseMap > 0.5) albedo *= texture2D(uMap, vUv).rgb;
  #ifdef FLAT_SHADED
  vec3 normal = faceNormal(vObjectPosition);
  #else
  vec3 normal = normalize(vObjectNormal);
  #endif
  float light = starLambert(normal, uStarDir);
  if (light > 0.0) {
    if (uEclipses > 0.5) light *= eclipseFactor(vObjectPosition);
    if (uRingShadows > 0.5 && uRingBandCount > 0) light *= ringShadowTransmission(vObjectPosition, uStarDir, uStarAngularRadius);
  }
  gl_FragColor = vec4(starLitColor(albedo, light, uAmbient), 1.0);
  ${OUTPUT_CHUNKS}
}
`

/**
 * The instanced small bodies' version (InstancedBodies): Lambert and the
 * night-side floor, with each instance's own star direction from a
 * per-instance attribute (`instanceStarDirection`, render axes — the
 * floating origin's rebase is a scale and a translation, so it never
 * turns a direction) and its colour from instanceColor. Worked in render
 * space rather than object space: the instance matrix holds a rotation
 * and a uniform scale, so the normal is just its rotation part.
 *
 * No eclipse or ring shadows: an instanced body is by definition at its
 * lowest LOD, a few pixels across, where a shadow's edge can't be seen —
 * and picking each body's shadow casters every frame (the store's
 * per-body work) is exactly what thousands of instances can't afford.
 * Selected, hovered and large bodies are promoted to the full path, which
 * has them.
 */
const INSTANCED_VERTEX_GLSL = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 instanceStarDirection;
varying vec3 vRenderPosition;
varying vec3 vRenderNormal;
varying vec3 vStarDirection;
varying vec3 vAlbedo;
void main() {
  mat4 placement = modelMatrix * instanceMatrix;
  vec4 renderPosition = placement * vec4(position, 1.0);
  vRenderPosition = renderPosition.xyz;
  vRenderNormal = mat3(placement) * normal;
  vStarDirection = instanceStarDirection;
  vAlbedo = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * renderPosition;
  #include <logdepthbuf_vertex>
}
`

const INSTANCED_FRAGMENT_GLSL = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${STAR_LIGHT_GLSL}
uniform float uAmbient;
varying vec3 vRenderPosition;
varying vec3 vRenderNormal;
varying vec3 vStarDirection;
varying vec3 vAlbedo;
void main() {
  #include <logdepthbuf_fragment>
  #ifdef FLAT_SHADED
  vec3 normal = faceNormal(vRenderPosition);
  #else
  vec3 normal = normalize(vRenderNormal);
  #endif
  float light = starLambert(normal, normalize(vStarDirection));
  gl_FragColor = vec4(starLitColor(vAlbedo, light, uAmbient), 1.0);
  ${OUTPUT_CHUNKS}
}
`

const RING_FRAGMENT_GLSL = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SHADOW_GLSL}
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uPlanetShadow;
uniform vec3 uCameraPosition;
varying vec3 vObjectPosition;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D(uMap, vUv);
  // RingGeometry lies in its own XY plane: +Z is the ring normal here.
  float mu0 = uStarDir.z;
  float mu = normalize(uCameraPosition - vObjectPosition).z;
  // Lommel–Seeliger, the standard law for a dusty, particulate surface:
  // brightness ~ mu0 / (mu0 + mu) (normalized to 1 with star and viewer
  // both overhead). Seen from the side the star doesn't light, a band
  // shows only light leaking through its gaps — (1 - opacity) of it.
  float lit = 2.0 * abs(mu0) / max(abs(mu0) + abs(mu), 1e-4);
  if (mu0 * mu < 0.0) lit *= 1.0 - uOpacity;
  lit = min(lit, 1.0);
  if (uPlanetShadow > 0.5) lit *= sphereShadowFactor(vObjectPosition, uStarDir, uStarAngularRadius, vec3(0.0), 1.0);
  gl_FragColor = vec4(uColor * texel.rgb * (uAmbient + lit), uOpacity * texel.a);
  ${OUTPUT_CHUNKS}
}
`

const ATMOSPHERE_FRAGMENT_GLSL = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SHADOW_GLSL}
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vObjectPosition;
void main() {
  #include <logdepthbuf_fragment>
  // Lit limb: bright where the star is overhead, fading past the
  // terminator rather than at it — a real atmosphere scatters light into
  // the night side for a while (twilight), so the glow wraps a little
  // around. The band (-0.25 .. 0.35 in cos) is a visual heuristic.
  float day = smoothstep(-0.25, 0.35, dot(normalize(vObjectPosition), uStarDir));
  gl_FragColor = vec4(uColor, uOpacity * (uAmbient + (1.0 - uAmbient) * day));
  ${OUTPUT_CHUNKS}
}
`

function baseUniforms(): Record<string, THREE.IUniform> {
  return {
    uStarDir: { value: new THREE.Vector3(0, 1, 0) },
    uStarAngularRadius: { value: 0 },
    uAmbient: { value: 0 },
    uOccluders: { value: Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector4()) },
    uOccluderCount: { value: 0 },
    uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
    uRingBands: { value: Array.from({ length: MAX_RING_BANDS }, () => new THREE.Vector3()) },
    uRingBandCount: { value: 0 },
  }
}

export type StarLitKind = 'surface' | 'ring' | 'atmosphere'

export function createLitSurfaceMaterial(color: string, map: THREE.Texture | null, { flat = false }: { flat?: boolean } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: flat ? { FLAT_SHADED: '' } : {},
    uniforms: {
      ...baseUniforms(),
      uColor: { value: new THREE.Color(map ? '#ffffff' : color) },
      uMap: { value: map },
      uUseMap: { value: map ? 1 : 0 },
      uEclipses: { value: 1 },
      uRingShadows: { value: 1 },
    },
    vertexShader: VERTEX_GLSL,
    fragmentShader: SURFACE_FRAGMENT_GLSL,
  })
}

/** The instanced small bodies' star-lit material (see
 *  INSTANCED_VERTEX_GLSL). Needs an InstancedMesh with instanceColor and
 *  an `instanceStarDirection` attribute; `uAmbient` is the caller's to
 *  keep at nightSideBrightness. */
export function createLitInstancedMaterial({ flat = false }: { flat?: boolean } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: flat ? { FLAT_SHADED: '' } : {},
    uniforms: { uAmbient: { value: 0 } },
    vertexShader: INSTANCED_VERTEX_GLSL,
    fragmentShader: INSTANCED_FRAGMENT_GLSL,
  })
}

export function createLitRingMaterial(color: string, map: THREE.Texture, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...baseUniforms(),
      uColor: { value: new THREE.Color(color) },
      uMap: { value: map },
      uOpacity: { value: opacity },
      uPlanetShadow: { value: 1 },
      uCameraPosition: { value: new THREE.Vector3() },
    },
    vertexShader: VERTEX_GLSL,
    fragmentShader: RING_FRAGMENT_GLSL,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}

export function createLitAtmosphereMaterial(color: string, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...baseUniforms(), uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: VERTEX_GLSL,
    fragmentShader: ATMOSPHERE_FRAGMENT_GLSL,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  })
}

const scratch = new THREE.Vector3()
const cameraScratch = new THREE.Vector3()
const inverseScratch = new THREE.Matrix4()

/**
 * Copies `bodyId`'s current light state into `material`'s uniforms, in
 * `mesh`'s object space — called from the mesh's onBeforeRender, when its
 * matrixWorld (rebased or not) is the one being drawn.
 */
export function applyBodyLight(material: THREE.ShaderMaterial, store: StarLightingStore, bodyId: string, mesh: THREE.Object3D, camera: THREE.Camera): void {
  const u = material.uniforms
  const state = store.stateFor(bodyId)
  const { settings } = store
  const matrix = mesh.matrixWorld
  directionToObjectSpace(matrix, state.starDirection, (u.uStarDir!.value as THREE.Vector3))
  u.uStarAngularRadius!.value = state.starAngularRadius
  u.uAmbient!.value = settings.nightSideBrightness
  const occluders = u.uOccluders!.value as THREE.Vector4[]
  for (let i = 0; i < state.occluderCount; i++) {
    const o = state.occluders
    bodyPointToObjectSpace(matrix, [o[i * 4]!, o[i * 4 + 1]!, o[i * 4 + 2]!], scratch)
    occluders[i]!.set(scratch.x, scratch.y, scratch.z, o[i * 4 + 3]!)
  }
  u.uOccluderCount!.value = state.occluderCount
  if (u.uEclipses) u.uEclipses.value = settings.eclipseShadows ? 1 : 0
  if (u.uPlanetShadow) u.uPlanetShadow.value = settings.ringShadows ? 1 : 0
  if (u.uRingShadows) applyRingCasters(u, store, bodyId, matrix, settings.ringShadows)
  if (u.uCameraPosition) {
    // The camera in object space: what the ring's view angle needs.
    cameraScratch.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverseScratch.copy(matrix).invert())
    ;(u.uCameraPosition.value as THREE.Vector3).copy(cameraScratch)
  }
}

function applyRingCasters(u: Record<string, THREE.IUniform>, store: StarLightingStore, bodyId: string, matrix: THREE.Matrix4, enabled: boolean): void {
  const rings = store.ringsFor(bodyId)
  u.uRingShadows!.value = enabled && rings ? 1 : 0
  if (!rings) {
    u.uRingBandCount!.value = 0
    return
  }
  directionToObjectSpace(matrix, rings.normal, u.uRingNormal!.value as THREE.Vector3)
  const bands = u.uRingBands!.value as THREE.Vector3[]
  rings.bands.forEach((band, i) => bands[i]!.set(band.inner, band.outer, band.opacity))
  u.uRingBandCount!.value = rings.bands.length
}
