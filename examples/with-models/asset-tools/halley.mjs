/**
 * Builds a glTF model of Comet 1P/Halley's nucleus from the Stooke shape
 * model in the PDS Small Bodies Node (small_bodies.stooke.shape-models,
 * derived from Giotto and Vega 1/2 images by Philip Stooke, with pointing
 * by Alain Abergel — both to be credited).
 *
 * The model is a table of (longitude, latitude, radius km) on a 5° grid,
 * longitude east-positive. Each grid point becomes a vertex at that radius
 * along its direction; neighbouring points are joined into quads. Y is up
 * (glTF convention), towards the model's north — its "big end".
 *
 * Halley's nucleus is one of the darkest objects known (geometric albedo
 * about 0.04), so it gets a near-black, fully rough material.
 */
import fs from 'fs'
import AdmZip from 'adm-zip'
import { Document, NodeIO } from '@gltf-transform/core'

const TABLE = 'small_bodies.stooke.shape-models/data/1682q1halley.tab'

/** Parses the table into a map keyed `lon,lat` → radius km. */
function parseGrid(text) {
  const grid = new Map()
  for (const line of text.split('\n')) {
    const [lon, lat, radius] = line.trim().split(/\s+/).map(Number)
    if (Number.isFinite(radius)) grid.set(`${lon},${lat}`, radius)
  }
  return grid
}

function vertexAt(grid, lon, lat) {
  // 0° and 360° are the same meridian; the table lists only one of them.
  const radius = grid.get(`${lon},${lat}`) ?? grid.get(`${lon === 0 ? 360 : lon === 360 ? 0 : lon},${lat}`)
  if (radius === undefined) throw new Error(`Halley grid has no point at lon ${lon}, lat ${lat}`)
  const [phi, lambda] = [(lat * Math.PI) / 180, (lon * Math.PI) / 180]
  return [radius * Math.cos(phi) * Math.cos(lambda), radius * Math.sin(phi), -radius * Math.cos(phi) * Math.sin(lambda)]
}

/** Per-vertex normals averaged from the faces around each vertex, so the
 *  lumpy surface shades smoothly rather than as flat facets. */
function vertexNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3]
    const u = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]]
    const v = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    for (const k of [a, b, c]) for (let j = 0; j < 3; j++) normals[k + j] += n[j]
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    for (let j = 0; j < 3; j++) normals[i + j] /= len
  }
  return normals
}

export async function buildHalleyGlb(zipPath, outPath) {
  const grid = parseGrid(new AdmZip(zipPath).readAsText(TABLE))
  const lons = Array.from({ length: 73 }, (_, i) => i * 5)
  const lats = Array.from({ length: 37 }, (_, i) => -90 + i * 5)

  const positions = new Float32Array(lons.length * lats.length * 3)
  lats.forEach((lat, row) => lons.forEach((lon, col) => positions.set(vertexAt(grid, lon, lat), (row * lons.length + col) * 3)))

  const indices = []
  for (let row = 0; row < lats.length - 1; row++) {
    for (let col = 0; col < lons.length - 1; col++) {
      const a = row * lons.length + col
      const b = a + 1
      const c = a + lons.length
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const index = new Uint32Array(indices)

  const doc = new Document()
  const buffer = doc.createBuffer()
  const material = doc.createMaterial('HalleyNucleus').setBaseColorFactor([0.09, 0.085, 0.08, 1]).setRoughnessFactor(1).setMetallicFactor(0)
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(vertexNormals(positions, index)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(index).setBuffer(buffer))
    .setMaterial(material)
  const mesh = doc.createMesh('Halley').addPrimitive(primitive)
  doc.createScene().addChild(doc.createNode('Halley').setMesh(mesh))
  fs.writeFileSync(outPath, await new NodeIO().writeBinary(doc))
}
