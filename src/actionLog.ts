/**
 * A recordable log of user interactions with OrbitalSystemScene, aimed
 * squarely at turning a bug report into an exact reproduction script. This
 * session's own camera bugs (see camera.ts/CameraRig.tsx) repeatedly only
 * reproduced at specific orbital phases or playback speeds — "clicked the
 * ISS" is not enough to reproduce one of those; "clicked the ISS at
 * simulated date X, Y ms after the session started, while playing at Z
 * days/second" is. Each entry therefore carries both `atMs` (relative to
 * when logging started, NOT wall-clock time — a reproduction script cares
 * about elapsed time between actions, not the real-world clock) and
 * `simDateISO` (the simulated date at the moment of the action).
 *
 * Deliberately recording-only: this module (and the React wiring that
 * produces these entries) has no notion of replaying a log back through
 * the UI. Turning a log into an actual reproduction is a browser-
 * automation concern (e.g. a Playwright script) for whoever consumes the
 * exported text, not something this library does to itself.
 */

export type ActionLogEntry =
  | { type: 'session-start'; atMs: number; simDateISO: string; systemId: string; initialPlaying: boolean; initialDaysPerSecond: number }
  | { type: 'select-body'; atMs: number; simDateISO: string; bodyId: string }
  | { type: 'select-belt'; atMs: number; simDateISO: string; beltId: string }
  | { type: 'up'; atMs: number; simDateISO: string }
  | { type: 'down'; atMs: number; simDateISO: string }
  | { type: 'recenter'; atMs: number; simDateISO: string }
  | { type: 'reset'; atMs: number; simDateISO: string }
  | { type: 'play'; atMs: number; simDateISO: string }
  | { type: 'pause'; atMs: number; simDateISO: string }
  | { type: 'set-speed'; atMs: number; simDateISO: string; daysPerSecond: number }
  | { type: 'set-zoom'; atMs: number; simDateISO: string; sliderPosition: number }

/** One line: `+<atMs>ms <type> <payload> @<simDateISO>`, payload omitted
 *  entirely (no trailing ` {}`) for entry types with nothing beyond
 *  type/atMs/simDateISO — a line reading "+2750ms pause {}" carries no more
 *  information than one without the braces, just noise in the log. */
export function formatActionLogEntry(entry: ActionLogEntry): string {
  const { type, atMs, simDateISO, ...rest } = entry
  const payload = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''
  return `+${atMs}ms ${type}${payload} @${simDateISO}`
}

export function formatActionLog(entries: ActionLogEntry[]): string {
  return entries.map(formatActionLogEntry).join('\n')
}
