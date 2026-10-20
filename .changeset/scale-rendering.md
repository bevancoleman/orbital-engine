---
"orbital-engine": minor
---

Large systems stay fast. Orbit lines and fixed bodies' reference rings are drawn on the GPU, all of them in one instanced draw call per level-of-detail tier, with the same look (1px, the body's colour, evenly spaced points); the selected body's orbit is now drawn brighter. Each orbit's detail now follows its own distance from the camera rather than the camera's distance to its target, and an orbit framed from right beside it (the ISS's, at the ISS) stays on its body instead of sagging off it between points, sometimes off the screen. Small placeholder bodies (no model, texture, rings or atmosphere, and small on screen) are drawn as one instanced mesh per shape, and switch back to their own marker when selected, hovered or large on screen. Labels, hover, selection and the visibility fade work as before.

On a 2,000-body synthetic system this takes the scene from ~1,050 draw calls and ~3,000 per-frame callbacks to 8 draw calls and ~40 callbacks, and a zoom step's re-render from ~36ms to ~1.5ms. Body positions are resolved each frame with ~10x less garbage.
