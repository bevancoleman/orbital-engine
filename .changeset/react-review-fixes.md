---
'orbital-engine': patch
---

React layer fixes: bodies behind the camera no longer cause phantom hovers or hide labels, and nothing is hovered while the pointer is off the canvas. Label hover, highlight and click now always agree, and a label is never drawn for a body whose dot was thinned out. Labels are centred over their body and offset by its on-screen size. Geometry is no longer rebuilt on every zoom step. Belt and particle buffers stay parent-relative and are only re-uploaded when they change. Ring and belt textures no longer leak, the action log's debounce timers are cleared on unmount, and dropdown ids containing ":" now work. The scene's controls have better accessibility. The public `orbital-engine/react` exports are unchanged.
