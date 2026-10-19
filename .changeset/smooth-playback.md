---
"orbital-engine": patch
---

A selected body's label no longer goes missing for a few frames around a fly-to's landing. Labels are now plain DOM elements BodyLabel creates and positions itself, instead of drei `<Html>` elements, whose content was rendered through a separately scheduled React root and could appear several frames late.
