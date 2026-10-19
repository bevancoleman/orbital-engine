---
"orbital-engine": minor
---

Flying to a body now frames the body itself: its diameter fills about 40% of the view (`BODY_VIEW_FILL`), with rings kept in frame, instead of fitting its whole moon system — planets no longer arrive as small dots. Clicking the selected body again flies out to its moon-system view and back. New `arrivalFraming` prop on `OrbitalSystemScene` (`'body'`, the default, or `'system'` for the previous behaviour) and a `data-framing` attribute on its root. `computeFocusForBody` takes an optional `BodyFraming` (`'body'` by default; `computeFocusForSystem` is unchanged), and the new `distanceToFillView` and `RING_VIEW_FILL` are exported. When the close-up body would hide its parent from the look-back angle a fly-to ends on, the view turns just far enough to show it (`FocusTarget.lookBiasClearanceDeg`). Satellites below the precision floor (ISS, Hubble) arrive at the same distance as before.
