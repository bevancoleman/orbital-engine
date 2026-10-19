---
"orbital-engine": patch
---

A selected body's label no longer goes missing for a few frames around a fly-to's landing. Labels are now plain DOM elements BodyLabel creates and positions itself, instead of drei `<Html>` elements, whose content was rendered through a separately scheduled React root and could appear several frames late.

Hovering or clicking a body that's drawn larger than the 28px snap radius now hits it anywhere inside its projected disc (the nearest disc to the camera wins where they overlap; a small body in front of a disc still snaps), so the edge of a body framed to fill the view is selectable.
