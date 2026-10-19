---
"orbital-engine": patch
---

Camera fixes: settled tracking now anchors on the live body (no permanent drift after a flight), keeps manual orbit/dolly damping while following a moving body, and applies writes the same frame; the context bulge, slerp and adaptive tracking smoothing are continuous; the zoom slider mid-flight re-anchors on the destination; collider exclusions survive mid-flight retargets and are released once the camera is clear (including after a deselect); guards for zero trajectory samples and NaN radii.
