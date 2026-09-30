# with-models

Demonstrates `CelestialBody.modelUrl` (a real 3D model) and `CelestialBody.textureUrl` (a real surface texture on the built-in placeholder sphere), toggled against the plain built-in placeholder shapes so you can compare both rendering paths side by side.

```bash
npm install
npm run dev
```

## What's real here

Every body a spacecraft has mapped or shaped has a real asset — see [ASSETS.md](./ASSETS.md) for each one's source, credit and processing:

- **Real 3D models** (`.glb`, `public/models/`): the ISS and Hubble, and spacecraft shape models of Halley's Comet (Giotto/Vega), Vesta and Ceres (Dawn), Eros (NEAR Shoemaker), Bennu (OSIRIS-REx) and Arrokoth (New Horizons).
- **Real surface maps** (`.jpg`, `public/textures/`): Mercury, Venus, Earth (true-colour Blue Marble), the Moon (LRO), Mars and its moons, Jupiter and the Galilean moons, Saturn with Titan, Enceladus, Tethys, Dione, Rhea and Iapetus (Cassini), Uranus's five major moons (Voyager 2), Neptune, Triton, Pluto and Charon.

The rest (Sun, Pallas, Hygiea, Uranus, Eris) have no spacecraft map, so they render through the ordinary placeholder shape — the same fallback this whole component uses whenever `modelUrl`/`textureUrl` aren't set, or fail to load.

`asset-tools/` rebuilds the processed assets from their original sources.
