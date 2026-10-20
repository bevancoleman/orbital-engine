import type { Page } from '@playwright/test'

// Reading the rendered canvas at chosen points, for checks on what the
// GPU actually drew (the batched orbit lines have no per-orbit object or
// DOM element to inspect — only pixels). Read in-page from inside a
// requestAnimationFrame, for the reason frameSampler.ts's
// startFrameSampler gives: the canvas has no preserveDrawingBuffer, so its
// pixels are only valid between R3F drawing a frame and the browser
// compositing it.

export interface ScreenPoint {
  /** CSS px, relative to the page (as getBoundingClientRect). */
  x: number
  y: number
}

/** Where `bodyName`'s body is on the page — its label's centre less the
 *  label's own upward offset (BodyLabel's translateY, see frameSampler.ts's
 *  readBody) — and its projected radius in CSS px; null when the label
 *  isn't on screen. */
export async function bodyOnScreen(page: Page, bodyName: string): Promise<(ScreenPoint & { radius: number }) | null> {
  return page.evaluate((name) => {
    for (const el of document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')) {
      if (el.textContent !== name) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0) continue
      const offset = Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? '0')
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 - offset, radius: Math.max(0, -offset - 14) }
    }
    return null
  }, bodyName)
}

/**
 * Samples where `bodyName`'s body is on every animation frame for
 * `durationMs` — the path it traces across the screen (null frames, its
 * label hidden, left out).
 */
export async function traceBody(page: Page, bodyName: string, durationMs: number): Promise<ScreenPoint[]> {
  return page.evaluate(
    ({ name, durationMs }) =>
      new Promise<ScreenPoint[]>((resolve) => {
        const points: ScreenPoint[] = []
        let start: number | null = null
        const tick = (t: number): void => {
          start ??= t
          for (const el of document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')) {
            if (el.textContent !== name) continue
            const rect = el.getBoundingClientRect()
            if (rect.width === 0) continue
            const offset = Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? '0')
            points.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 - offset })
          }
          if (t - start < durationMs) requestAnimationFrame(tick)
          else resolve(points)
        }
        requestAnimationFrame(tick)
      }),
    { name: bodyName, durationMs }
  )
}

/** One frame's brightness (0–255, max of R/G/B) at each point: the
 *  brightest pixel within `reach` CSS px of it. */
export async function brightnessAt(page: Page, points: ScreenPoint[], reach = 1): Promise<number[]> {
  return page.evaluate(
    ({ points, reach }) =>
      new Promise<number[]>((resolve, reject) => {
        const canvas = document.querySelector('canvas')
        const gl = canvas?.getContext('webgl2')
        if (!canvas || !gl) {
          reject(new Error('Scene canvas or WebGL2 context missing'))
          return
        }
        requestAnimationFrame(() => {
          const box = canvas.getBoundingClientRect()
          const width = gl.drawingBufferWidth
          const height = gl.drawingBufferHeight
          const pixels = new Uint8Array(width * height * 4)
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          const scale = width / box.width
          const span = Math.ceil(reach * scale)
          resolve(
            points.map((p) => {
              const cx = Math.round((p.x - box.left) * scale)
              // WebGL rows run bottom-up.
              const cy = Math.round(height - 1 - (p.y - box.top) * scale)
              let best = 0
              for (let y = cy - span; y <= cy + span; y++) {
                for (let x = cx - span; x <= cx + span; x++) {
                  if (x < 0 || y < 0 || x >= width || y >= height) continue
                  const i = (y * width + x) * 4
                  best = Math.max(best, pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)
                }
              }
              return best
            })
          )
        })
      }),
    { points, reach }
  )
}

/**
 * The brightest line running straight out through `centre`: for each
 * whole degree round it, the DIMMEST of the points at `radii` along that
 * bearing, and the brightest of those. A line through the centre — an
 * orbit through the body sitting on it — is lit at every radius on its
 * bearing; a star, or a line passing elsewhere, isn't, so it doesn't count.
 */
export async function radialLinePeak(page: Page, centre: ScreenPoint, radii: number[]): Promise<number> {
  const bearings = Array.from({ length: 360 }, (_, degree) => (degree * Math.PI) / 180)
  const points = bearings.flatMap((angle) => radii.map((r) => ({ x: centre.x + r * Math.cos(angle), y: centre.y + r * Math.sin(angle) })))
  const brightness = await brightnessAt(page, points, 1)
  let peak = 0
  for (let b = 0; b < bearings.length; b++) peak = Math.max(peak, Math.min(...brightness.slice(b * radii.length, (b + 1) * radii.length)))
  return peak
}
