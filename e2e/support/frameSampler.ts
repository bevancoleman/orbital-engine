import type { Page } from '@playwright/test'

import { flightCount } from './scene'

/** A square region of the canvas, centred at normalized (cx, cy) in [0, 1],
 *  `sizeFraction` of the canvas's smaller dimension on a side. */
export interface CanvasRegion {
  cx: number
  cy: number
  sizeFraction: number
}

/** "Somewhere reasonably central" — camera framing settles a selected body
 *  close to centre, not dead-on-the-pixel. */
export const CENTRE: CanvasRegion = { cx: 0.5, cy: 0.5, sizeFraction: 0.3 }

/** Below this lit fraction a region is empty space (a few stars at most). */
export const EMPTY_SPACE_MAX_LIT = 0.005

export interface FrameSample {
  /** The scene root's `data-camera-state` when this frame was read. */
  cameraState: string
  flightCount: number
  /** Fraction of the region's pixels that aren't (near-)black empty space
   *  — the scene's background is always solid black, so a region with
   *  nothing in it reads ~0. */
  lit: number
  /** The zoom slider's value — a log-mapped proxy for the live camera-to-
   *  target distance (CameraRig's onDistanceChange). */
  zoom: number
  /** Where the body named `bodyName` is on screen, relative to the canvas
   *  centre and normalized by the canvas size (±0.5 is the edge), or null
   *  when its label isn't on screen this frame. Read from the body's
   *  in-canvas label, which BodyLabel projects from the body's own
   *  position with the same camera — minus the label's own upward offset
   *  above the body (BodyLabel's translateY, which grows with the body's
   *  projected radius), so this is the body's centre, not the text's. */
  body: { dx: number; dy: number } | null
  /** Whether the body named `bodyName` has a label element in the DOM at
   *  all this frame — even one hidden for sitting behind the camera
   *  (which `body` reports as null). */
  bodyLabelMounted: boolean
}

export interface SampleOptions {
  region?: CanvasRegion
  /** Name of a body (its exact label text) to locate on each frame. */
  bodyName?: string
  /** Keep sampling for at least this long. */
  minDurationMs?: number
  /** Keep sampling until `data-flight-count` reaches this and the camera
   *  is no longer flying (on top of minDurationMs). */
  untilFlightCount?: number
  /** Hard stop, so a stuck flight fails the assertions instead of hanging. */
  maxDurationMs?: number
}

declare global {
  interface Window {
    __frameSamples?: Promise<FrameSample[]>
  }
}

/**
 * Starts reading the rendered canvas on EVERY animation frame, in-page —
 * no Playwright round-trip per sample — and resolves the collected samples
 * via collectFrameSamples. Screenshots cost ~0.5s each on a software-
 * rendered canvas (several frames), so the old approach of screenshotting
 * "mid-flight" at a guessed wall-clock time landed at an arbitrary point
 * of the flight, or missed it entirely under parallel load.
 *
 * Why this isn't stale (an earlier in-page attempt was): the canvas is
 * created without preserveDrawingBuffer, so its pixels are only valid
 * between R3F rendering a frame and the browser compositing it; a plain
 * page.evaluate() runs as an ordinary task after compositing and read a
 * cleared buffer. This reads from inside a requestAnimationFrame callback
 * queued AFTER R3F's own (R3F re-queues its loop at the end of each frame,
 * before ours re-queues), so it sees exactly the frame about to be shown —
 * verified to agree with a page.screenshot() of the same region.
 */
export async function startFrameSampler(page: Page, options: SampleOptions = {}): Promise<void> {
  const { region = CENTRE, bodyName = null, minDurationMs = 0, untilFlightCount = 0, maxDurationMs = 15_000 } = options
  await page.evaluate(
    ({ region, bodyName, minDurationMs, untilFlightCount, maxDurationMs }) => {
      const canvas = document.querySelector('canvas')
      const root = document.querySelector<HTMLElement>('[data-camera-state]')
      const zoomSlider = document.querySelector<HTMLInputElement>('input[type=range][title^="Zoom"]')
      const gl = canvas?.getContext('webgl2')
      if (!canvas || !root || !zoomSlider || !gl) throw new Error('Scene canvas, WebGL2 context, root or zoom slider missing')

      function readLit(): number {
        const width = gl!.drawingBufferWidth
        const height = gl!.drawingBufferHeight
        const size = Math.max(4, Math.round(Math.min(width, height) * region.sizeFraction))
        const x = Math.min(Math.max(0, Math.round(width * region.cx - size / 2)), width - size)
        // WebGL's origin is bottom-left; the region's cy is top-down.
        const y = Math.min(Math.max(0, Math.round(height * (1 - region.cy) - size / 2)), height - size)
        const pixels = new Uint8Array(size * size * 4)
        gl!.readPixels(x, y, size, size, gl!.RGBA, gl!.UNSIGNED_BYTE, pixels)
        let lit = 0
        for (let i = 0; i < pixels.length; i += 4) {
          if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 40) lit++
        }
        return lit / (size * size)
      }

      function labelMounted(): boolean {
        if (bodyName === null) return false
        for (const el of document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')) if (el.textContent === bodyName) return true
        return false
      }

      function readBody(): { dx: number; dy: number } | null {
        if (bodyName === null) return null
        const box = canvas!.getBoundingClientRect()
        for (const el of document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')) {
          if (el.textContent !== bodyName) continue
          const rect = el.getBoundingClientRect()
          if (rect.width === 0) continue
          const labelOffset = Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? '0')
          return {
            dx: (rect.left + rect.width / 2 - (box.left + box.width / 2)) / box.width,
            dy: (rect.top + rect.height / 2 - labelOffset - (box.top + box.height / 2)) / box.height,
          }
        }
        return null
      }

      window.__frameSamples = new Promise((resolve) => {
        const samples: FrameSample[] = []
        const start = performance.now()
        const tick = (): void => {
          const cameraState = root.dataset.cameraState ?? ''
          const count = Number(root.dataset.flightCount ?? '0')
          samples.push({ cameraState, flightCount: count, lit: readLit(), zoom: Number(zoomSlider.value), body: readBody(), bodyLabelMounted: labelMounted() })
          const elapsed = performance.now() - start
          const flightPending = count < untilFlightCount || cameraState === 'flying'
          const keepGoing = elapsed < minDurationMs || (untilFlightCount > 0 && flightPending)
          if (keepGoing && elapsed < maxDurationMs) requestAnimationFrame(tick)
          else resolve(samples)
        }
        requestAnimationFrame(tick)
      })
    },
    { region, bodyName, minDurationMs, untilFlightCount, maxDurationMs }
  )
}

export async function collectFrameSamples(page: Page): Promise<FrameSample[]> {
  return page.evaluate(async () => {
    const pending = window.__frameSamples
    if (!pending) throw new Error('startFrameSampler was not called')
    return pending
  })
}

/** Samples every frame of the flight(s) `action` starts, from before the
 *  first one begins until the last has landed (plus `afterMs` more). */
export async function sampleFlight(
  page: Page,
  action: () => Promise<void>,
  options: Omit<SampleOptions, 'untilFlightCount' | 'minDurationMs'> & { flights?: number } = {}
): Promise<FrameSample[]> {
  const { flights = 1, ...rest } = options
  const target = (await flightCount(page)) + flights
  await startFrameSampler(page, { ...rest, untilFlightCount: target })
  await action()
  return collectFrameSamples(page)
}

/** Samples every frame for `durationMs`. */
export async function sampleFor(page: Page, durationMs: number, options: Omit<SampleOptions, 'minDurationMs'> = {}): Promise<FrameSample[]> {
  await startFrameSampler(page, { ...options, minDurationMs: durationMs })
  return collectFrameSamples(page)
}

/** One frame's lit fraction for `region`. */
export async function litFractionAt(page: Page, region: CanvasRegion = CENTRE): Promise<number> {
  const [sample] = await sampleFor(page, 0, { region })
  return sample!.lit
}

/** True when the sampled body is within `maxOffset` of the canvas size
 *  of its centre, either way. Camera framing puts a selected body close to
 *  centre, not dead-on-the-pixel. */
export function bodyNearCentre(sample: FrameSample, maxOffset = 0.15): boolean {
  return sample.body !== null && Math.abs(sample.body.dx) < maxOffset && Math.abs(sample.body.dy) < maxOffset
}

/**
 * Asserts the sampled body stayed centred: its label on screen, near the
 * centre, on EVERY frame. This used to accept the label missing on up to
 * half the frames — it was observed missing just after selection and
 * occasionally right after a flight landed, put down at the time to "a
 * label behaviour". It was a real bug (drei's <Html> rendered the label
 * through a separately scheduled React root — see BodyLabel), fixed, so a
 * missing frame now fails.
 */
export function bodyStaysCentred(samples: FrameSample[], maxOffset = 0.15): { ok: boolean; detail: string } {
  const located = samples.filter((s) => s.body !== null)
  const offCentre = located.filter((s) => !bodyNearCentre(s, maxOffset))
  const ok = samples.length > 0 && located.length === samples.length && offCentre.length === 0
  return { ok, detail: describeSamples(samples) }
}

/** Readable failure output: one line per frame. */
export function describeSamples(samples: FrameSample[]): string {
  return samples
    .map((s) => {
      const body = s.body ? `${s.body.dx.toFixed(3)},${s.body.dy.toFixed(3)}` : s.bodyLabelMounted ? 'hidden' : '-'
      return `#${s.flightCount} ${s.cameraState} lit=${s.lit.toFixed(3)} zoom=${s.zoom} body=${body}`
    })
    .join('\n')
}

export interface LabelTrackSample {
  /** requestAnimationFrame timestamp, ms. */
  t: number
  /** The label's centre in CSS px, or null when it isn't on screen. */
  x: number | null
  y: number | null
}

/**
 * Where `bodyName`'s label is on every animation frame for `durationMs` —
 * label positions only, no WebGL pixel reads: a readPixels stalls the GPU
 * pipeline every frame and on a software-rendered canvas roughly halves
 * the frame rate, which would hide exactly the per-frame-vs-100ms
 * difference some tests measure. Labels are positioned from the same
 * per-frame body positions the meshes are drawn from (see BodyLabel).
 */
export async function sampleLabelTrack(page: Page, bodyName: string, durationMs: number): Promise<LabelTrackSample[]> {
  return page.evaluate(
    ({ bodyName, durationMs }) =>
      new Promise<LabelTrackSample[]>((resolve) => {
        const samples: LabelTrackSample[] = []
        let start: number | null = null
        const tick = (t: number): void => {
          start ??= t
          let x: number | null = null
          let y: number | null = null
          for (const el of document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')) {
            if (el.textContent !== bodyName) continue
            const rect = el.getBoundingClientRect()
            if (rect.width === 0) continue
            x = rect.left + rect.width / 2
            y = rect.top + rect.height / 2
          }
          samples.push({ t, x, y })
          if (t - start < durationMs) requestAnimationFrame(tick)
          else resolve(samples)
        }
        requestAnimationFrame(tick)
      }),
    { bodyName, durationMs }
  )
}
