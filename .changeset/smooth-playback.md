---
"orbital-engine": patch
---

A selected body's label no longer goes missing for a few frames around a fly-to's landing. Labels are now plain DOM elements BodyLabel creates and positions itself, instead of drei `<Html>` elements, whose content was rendered through a separately scheduled React root and could appear several frames late.

Hovering or clicking a body that's drawn larger than the 28px snap radius now hits it anywhere inside its projected disc (the nearest disc to the camera wins where they overlap; a small body in front of a disc still snaps), so the edge of a body framed to fill the view is selectable.

Playback is smooth: the simulated time is advanced, and every body's position resolved, on every frame — bodies, orbit lines, belts (a co-orbital belt now rotates rather than rebuilding its buffer), route lines, the star light, the tracking camera and hover all move per frame, instead of in the ~100ms steps of the React `simDate` state, which now only drives UI text. A new flight's arrival prediction starts from that per-frame time too.
