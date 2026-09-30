# Asset sources

Every texture and model in `public/`, where it comes from, and how it was processed. All are from NASA, USGS or NASA's Planetary Data System, and free to use; credit lines are given where the source asks for one. [`asset-tools/`](./asset-tools) rebuilds every asset marked **rebuilt** straight from its source: `cd asset-tools && npm install && npm run build`.

## Models (`public/models/`)

| File | Body | Source | Processing |
|---|---|---|---|
| `iss.glb`, `hubble.glb` | ISS, Hubble | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | As published |
| `vesta.glb` | 4 Vesta | [NASA — Vesta 3D model](https://science.nasa.gov/resource/vesta-3d-model/) (Dawn) | **Rebuilt**: textures resized to ≤2048 px, re-encoded as JPEG |
| `ceres.glb` | 1 Ceres | [NASA — Ceres 3D model](https://science.nasa.gov/resource/ceres-3d-model/) (Dawn) | **Rebuilt**, as above |
| `eros.glb` | 433 Eros | [NASA — Eros 3D model](https://science.nasa.gov/resource/eros-3d-model/) (NEAR Shoemaker) | **Rebuilt**, as above |
| `bennu.glb` | 101955 Bennu | [NASA — Bennu 3D model](https://science.nasa.gov/resource/bennu-3d-model/) (OSIRIS-REx) | **Rebuilt**, as above |
| `arrokoth.glb` | 486958 Arrokoth | [NASA — Arrokoth 3D model](https://science.nasa.gov/resource/arrokoth-3d-model/) (New Horizons) | **Rebuilt**, as above |
| `halley.glb` | 1P/Halley (nucleus) | [PDS SBN — Stooke small-body shape models](https://sbn.psi.edu/pds/resource/stkshape.html), from Giotto and Vega 1/2 images | **Rebuilt**: the 5° longitude/latitude radius grid is turned into a mesh; near-black material (Halley's albedo is ~0.04). *Credit: shape by P. Stooke, pointing by A. Abergel.* The model itself is marked very uncertain (±0.5–1 km) |

## Textures (`public/textures/`)

| File | Source | Processing |
|---|---|---|
| `earth.jpg` | [NASA Blue Marble Next Generation](https://visibleearth.nasa.gov/collection/1484/blue-marble), July 2004, with topography and bathymetry | **Rebuilt**: 5400 × 2700 → 4096 × 2048. True colour, cloud-free |
| `moon.jpg` | [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720), LRO LROC WAC colour mosaic with polar fill | **Rebuilt**: 4096 × 2048 |
| `mercury.jpg` | [USGS MESSENGER MDIS global colour mosaic, 665 m](https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_global_color_mosaic_665m) | **Rebuilt**: 4096 × 2048. The mosaic's bands are 1000/750/430 nm, so shown directly it's false colour; the 750 nm band alone (close to what the eye sees — Mercury is a neutral grey) is used with a faint warm tint. Small no-data gaps are filled from their surroundings |
| `enceladus.jpg`, `tethys.jpg`, `dione.jpg`, `rhea.jpg`, `iapetus.jpg` | USGS Cassini (+ Voyager) global mosaics: [Enceladus](https://astrogeology.usgs.gov/search/map/enceladus_cassini_iss_global_mosaic_hpf_110m), [Tethys](https://astrogeology.usgs.gov/search/map/Tethys/Cassini/Tethys_Cassini_mosaic_global_293m), [Dione](https://astrogeology.usgs.gov/search/map/dione_cassini_voyager_global_mosaic_154m), [Rhea](https://astrogeology.usgs.gov/search/map/rhea_cassini_voyager_global_mosaic_417m), [Iapetus](https://astrogeology.usgs.gov/search/map/iapetus_cassini_voyager_global_mosaic_803m) | **Rebuilt**: 2048 × 1024. The mosaics are high-pass filtered (landforms kept, overall brightness removed), so each is set back on a base tone from the moon's geometric albedo — and Iapetus on its broad dark/bright pattern from NASA 3D Resources' older map. Brightness is therefore approximate; the landforms are real |
| `miranda.jpg`, `ariel.jpg`, `umbriel.jpg`, `titania.jpg`, `oberon.jpg` | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources), from Voyager 2 | **Rebuilt**. Voyager 2 saw only these moons' southern hemispheres; the unimaged north (black in the source) is filled with each moon's average tone, so the **uniform band marks where no imagery exists** |
| `venus.jpg`, `mars.jpg`, `phobos.jpg`, `deimos.jpg`, `jupiter.jpg`, `io.jpg`, `europa.jpg`, `ganymede.jpg`, `callisto.jpg`, `saturn.jpg`, `titan.jpg`, `neptune.jpg`, `triton.jpg`, `pluto.jpg`, `charon.jpg` | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | As published |

Mimas is not included: no complete map of it is published.
