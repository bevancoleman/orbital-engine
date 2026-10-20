---
"orbital-engine": minor
---

More zoom for small bodies: the ISS and Hubble now arrive framed like any other body, filling about 40% of the view, and the camera can get much closer still. The scene is drawn camera-relative and normalized by the viewing distance (the "floating origin" — positions, the camera and camera-controls stay in world coordinates; only the draw call is rebased), which removes the GPU depth-precision limit behind the old floor. `ABSOLUTE_MIN_CAMERA_DISTANCE` drops from `1e-6` to `1e-10`; the camera's near clip plane now follows the viewing distance every frame. Flights that span the deeper zoom take longer, so the default `flightPacing.maxMs` is now 5000 (was 4000), and a flight's duration also allows for its fastest mid-flight turn, not just the turn between its ends.
