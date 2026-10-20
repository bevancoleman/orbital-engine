---
"orbital-engine": minor
---

Fly-tos now read as smooth, deliberate travel instead of a 900ms lunge. The camera follows van Wijk & Nuij's optimal zoom-and-pan path — zooming out until the start and the destination are both in view, panning, then zooming in — eased in and out so it starts and ends at rest, with the view's turn spread over the whole flight. Each flight's duration is proportional to that path's length (constant perceived speed), clamped to 1.2–4s, and a moving destination's arrival is predicted for that same duration. New optional `flightPacing` prop on `OrbitalSystemScene` (`{ speed?, minMs?, maxMs? }`; also exported as the `FlightPacing` type, with `DEFAULT_FLIGHT_PACING`) tunes the pace. The shared-parent context bulge now fades in and out with zero slope, so a flight bulged out to keep Earth in frame no longer zooms into its close-up at full speed on its last frame.
