---
'orbital-engine': patch
---

`OrbitalSystemScene`'s root element now carries read-only data attributes describing what the scene is doing, so browser tests (and consumers) can wait on real state instead of fixed sleeps: `data-camera-state` (`flying`, `tracking` or `idle`), `data-flight-count` (fly-tos started since mount, only ever increases), `data-focused-id` (the selected body or belt id, absent when nothing is selected) and `data-sim-playing` (`true`/`false`). Also fixes a fast-orbiting body (e.g. the ISS while time plays) flashing off-centre for a frame or more right as a fly-to lands: the landing frame now anchors on the body's live position, and tracking smoothing no longer reads a camera distance that still lags the flight.
