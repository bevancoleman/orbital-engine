# with-models

Demonstrates `CelestialBody.modelUrl` (a real 3D model) and `CelestialBody.textureUrl` (a real surface texture on the built-in placeholder sphere), toggled against the plain built-in placeholder shapes so you can compare both rendering paths side by side.

```bash
npm install
npm run dev
```

## What's real here

21 of `SOLAR_SYSTEM`'s 30 bodies have a real asset from NASA's public-domain [3D Resources](https://science.nasa.gov/3d-resources/) collection ([github.com/nasa/NASA-3D-Resources](https://github.com/nasa/NASA-3D-Resources)):

- **Real 3D models** (`.glb`, `public/models/`): ISS, Hubble Space Telescope — NASA's collection covers spacecraft/instruments, not planetary bodies, which is why this list is short.
- **Real surface textures** (`.jpg`, `public/textures/`): Earth, Moon, Venus, Mars, Phobos, Deimos, Jupiter, Io, Europa, Ganymede, Callisto, Saturn, Titan, Rhea, Titania, Neptune, Triton, Pluto, Charon.

Every other body (Sun, Mercury, Ceres, Vesta, Pallas, Hygiea, Uranus, Eris, Halley's Comet) has no real asset published in that collection, so it renders through the ordinary placeholder shape — the same fallback this whole component uses whenever `modelUrl`/`textureUrl` aren't set at all, or fail to load.

All assets are NASA public domain ("free to download and use, no copyright" — see the [NASA-3D-Resources README](https://github.com/nasa/NASA-3D-Resources/blob/master/README.md)).
