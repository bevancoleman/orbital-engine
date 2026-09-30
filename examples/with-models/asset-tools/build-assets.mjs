#!/usr/bin/env node
/**
 * Rebuilds the real-asset textures and models this example serves from
 * public/, straight from their original NASA / USGS / PDS sources — so
 * every asset can be traced back and regenerated, not just trusted. See
 * ../ASSETS.md for what each one is, where it comes from, and its credit.
 *
 * Kept in its own package (asset-tools/) so its heavy dependencies (sharp,
 * glTF tooling) never land in the example itself or its CI install. Source
 * downloads are cached in asset-tools/.cache/ (gitignored); the Mercury
 * mosaic alone is ~800 MB.
 *
 * Usage (from this folder):
 *   npm install
 *   node build-assets.mjs            # everything
 *   node build-assets.mjs earth moon # just these
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, textureCompress } from '@gltf-transform/functions'

import { buildHalleyGlb } from './halley.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CACHE = path.join(HERE, '.cache')
const TEXTURES = path.resolve(HERE, '../public/textures')
const MODELS = path.resolve(HERE, '../public/models')
const TEXTURE_SIZE = [4096, 2048]

sharp.cache(false)

async function cached(name, url) {
  const file = path.join(CACHE, name)
  if (fs.existsSync(file)) return file
  fs.mkdirSync(CACHE, { recursive: true })
  console.log(`downloading ${url}`)
  const response = await fetch(url, { headers: { 'User-Agent': 'orbital-engine-asset-tools' } })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  return file
}

async function writeJpeg(image, name) {
  const out = path.join(TEXTURES, `${name}.jpg`)
  await image.jpeg({ quality: 85, mozjpeg: true }).toFile(out)
  console.log(`wrote textures/${name}.jpg (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
}

/**
 * Fills no-data (0) pixels in a one-channel image from their surroundings
 * by normalised convolution: blur the image and the valid-pixel mask with
 * the same kernel and divide, so each gap takes the average of the real
 * pixels near it. Pixels too far from any real data (e.g. an unmapped
 * pole) fall back to the image's mean.
 */
async function fillNoData(gray, width, height) {
  const mask = Buffer.from(gray.map((v) => (v > 0 ? 255 : 0)))
  const raw = { raw: { width, height, channels: 1 } }
  const blurredValues = await sharp(gray, raw).blur(24).raw().toBuffer()
  const blurredMask = await sharp(mask, raw).blur(24).raw().toBuffer()
  let sum = 0
  let count = 0
  for (const v of gray) if (v > 0) (sum += v), count++
  const mean = sum / count
  const out = Buffer.from(gray)
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0) continue
    out[i] = blurredMask[i] > 8 ? Math.min(255, Math.round((blurredValues[i] * 255) / blurredMask[i])) : Math.round(mean)
  }
  return out
}

const STEPS = {
  /** NASA Blue Marble Next Generation, July 2004 (topography + bathymetry). */
  async earth() {
    const src = await cached('bluemarble-2004-07.jpg', 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg')
    await writeJpeg(sharp(src).resize(...TEXTURE_SIZE), 'earth')
  },

  /** NASA SVS CGI Moon Kit — LRO LROC WAC colour mosaic with polar fill. */
  async moon() {
    const src = await cached('lroc_color_poles_4k.tif', 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif')
    await writeJpeg(sharp(src).resize(...TEXTURE_SIZE), 'moon')
  },

  /**
   * USGS MESSENGER MDIS global colour mosaic (665 m/px). Its bands are
   * 1000/750/430 nm — near-infrared in red, so shown as-is it's false
   * colour. The 750 nm band alone is close to what the eye sees (Mercury is
   * a neutral grey), given a faint warm tint; the mosaic's small no-data
   * gaps are filled from their surroundings.
   */
  async mercury() {
    const src = await cached('mercury_messenger_clrmosaic_665m_v3.tif', 'https://planetarymaps.usgs.gov/mosaic/Mercury_MESSENGER_ClrMosaic_global_665m_v3.tif')
    const [width, height] = TEXTURE_SIZE
    const gray = await sharp(src, { limitInputPixels: false }).resize(width, height).extractChannel(1).raw().toBuffer()
    const filled = await fillNoData(gray, width, height)
    const tinted = sharp(filled, { raw: { width, height, channels: 1 } }).toColourspace('srgb').recomb([
      [1.0, 0, 0],
      [0.96, 0, 0],
      [0.9, 0, 0],
    ])
    await writeJpeg(tinted, 'mercury')
  },

  /** Comet 1P/Halley nucleus — Stooke/Abergel shape model (PDS SBN). */
  async halley() {
    const zip = await cached('stooke-shape-models.zip', 'https://sbnarchive.psi.edu/pds4/non_mission/small_bodies.stooke.shape-models.zip')
    const out = path.join(MODELS, 'halley.glb')
    await buildHalleyGlb(zip, out)
    console.log(`wrote models/halley.glb (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
  },

  /** NASA's own small-body models (science.nasa.gov 3D resources), with
   *  textures resized and re-encoded so each stays a reasonable download. */
  async smallBodies() {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    const models = {
      vesta: 'v/Vesta_1_100.glb',
      ceres: 'c/Ceres_1_1000.glb',
      eros: 'e/Eros_1_10.glb',
      bennu: 'b/Bennu_1_1.glb',
      arrokoth: 'a/Arrokoth.glb',
    }
    for (const [name, rel] of Object.entries(models)) {
      const src = await cached(`${name}.glb`, `https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/${rel}`)
      const doc = await io.read(src)
      await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [2048, 2048], quality: 85 }))
      const out = path.join(MODELS, `${name}.glb`)
      await io.write(out, doc)
      console.log(`wrote models/${name}.glb (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
    }
  },

  /**
   * Saturn's mid-sized moons — USGS global mosaics from Cassini (with
   * Voyager filling any gaps), complete coverage. Mimas is left out: no
   * complete map of it is published.
   *
   * These mosaics are high-pass filtered to bring out landforms, which
   * also strips each moon's overall brightness — every one comes out the
   * same mid-grey. The surface detail is kept and set back on a base tone
   * from the moon's geometric albedo (NASA planetary fact sheets):
   * Enceladus is the most reflective body in the Solar System, Rhea and
   * Dione rather less. Iapetus has no single tone — its leading hemisphere
   * is coal-dark and its trailing one bright — so its base is the broad
   * light/dark pattern from NASA 3D Resources' older Iapetus map.
   */
  async saturnMoons() {
    const mosaics = {
      enceladus: { rel: 'Enceladus/Cassini/Enceladus_Cassini_ISS_Global_Mosaic_100m_HPF.tif', tone: 240 },
      tethys: { rel: 'Tethys_Cassini_mosaic_global_293m.tif', tone: 225 },
      dione: { rel: 'Dione_Cassini_Voyager_mosaic_global_154m.tif', tone: 205 },
      rhea: { rel: 'Rhea_Cassini_Voyager_mosaic_global_417m.tif', tone: 200 },
      iapetus: { rel: 'Iapetus_Cassini_Voyager_mosaic_global_783m.tif', tone: null },
    }
    const [width, height] = [2048, 1024]
    const raw = { raw: { width, height, channels: 1 } }
    const iapetusBase = await this.iapetusBrightness(width, height)
    for (const [name, { rel, tone }] of Object.entries(mosaics)) {
      const src = await cached(`${name}_cassini.tif`, `https://planetarymaps.usgs.gov/mosaic/${rel}`)
      const gray = await sharp(src, { limitInputPixels: false }).resize(width, height).extractChannel(0).raw().toBuffer()
      const detail = await fillNoData(gray, width, height)
      let mean = 0
      for (const v of detail) mean += v / detail.length
      const out = Buffer.alloc(detail.length)
      for (let i = 0; i < out.length; i++) {
        const base = tone ?? iapetusBase[i]
        // Scale detail with the base, so dark ground keeps proportionally
        // dark shading rather than bright ridges on black.
        out[i] = Math.max(0, Math.min(255, Math.round(base + (detail[i] - mean) * 0.8 * (base / 200))))
      }
      await writeJpeg(sharp(out, raw), name)
    }
  },

  /** Iapetus's large-scale brightness (see saturnMoons): NASA 3D
   *  Resources' Iapetus map, heavily blurred so only the broad dark/bright
   *  hemispheres survive. */
  async iapetusBrightness(width, height) {
    const src = await cached('iapetus-nasa3d.jpg', 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/Saturn%20-%20Iapetus/Saturn%20-%20Iapetus.jpg')
    const pattern = await sharp(src).resize(width, height, { fit: 'fill' }).extractChannel(0).blur(30).raw().toBuffer()
    // Cassini Regio reflects about 4% of light — very dark, not black — so
    // the dark side keeps a floor where its craters still show.
    return pattern.map((v) => 28 + v * 0.85)
  },

  /**
   * Uranus's major moons — NASA 3D Resources maps from Voyager 2, which saw
   * only their southern hemispheres (the north was in darkness). The
   * unimaged north is black in the source; it's filled here with each
   * moon's own average surface tone, so the sphere reads as the moon rather
   * than as a hole — the uniform band marks where no imagery exists.
   */
  async uranusMoons() {
    const moons = { miranda: 'Uranus - Miranda', ariel: 'Uranus - Ariel', umbriel: 'Uranus - Umbriel', titania: 'Uranus - Titania', oberon: 'Uranus - Oberon' }
    for (const [name, folder] of Object.entries(moons)) {
      const dir = encodeURIComponent(folder)
      const src = await cached(`${name}.jpg`, `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/${dir}/${encodeURIComponent(`${folder}.jpg`)}`)
      const { width, height } = await sharp(src).metadata()
      // JPEG noise leaves the black area a few levels above 0 — treat
      // anything that dark as no data.
      const gray = (await sharp(src).extractChannel(0).raw().toBuffer()).map((v) => (v < 12 ? 0 : v))
      const filled = await fillNoData(gray, width, height)
      await writeJpeg(sharp(filled, { raw: { width, height, channels: 1 } }).resize({ width: 2048, height: 1024, fit: 'fill', withoutEnlargement: true }), name)
    }
  },
}

const requested = process.argv.slice(2)
for (const [name, step] of Object.entries(STEPS)) {
  if (name === 'iapetusBrightness') continue
  if (requested.length && !requested.includes(name)) continue
  await step.call(STEPS)
}
