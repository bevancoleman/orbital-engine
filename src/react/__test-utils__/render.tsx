/**
 * A minimal React DOM harness for these tests — @testing-library isn't a
 * dependency of this repo, and the handful of DOM-only components and
 * hooks tested here (toolbar, panels, the scene's own hooks) don't need
 * more than createRoot + act. Nothing here touches WebGL.
 */
import { act, type ComponentRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export interface Rendered {
  container: ComponentRef<'div'>
  rerender(node: ReactNode): void
  unmount(): void
}

export function render(node: ReactNode): Rendered {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  act(() => {
    root = createRoot(container)
    root.render(node)
  })
  return {
    container,
    rerender(next) {
      act(() => root!.render(next))
    },
    unmount() {
      act(() => root!.unmount())
      container.remove()
    },
  }
}

export interface HookHandle<T> {
  readonly current: T
  rerender(): void
  unmount(): void
}

/** Renders `useHook` inside a throwaway component and exposes its latest
 *  return value. */
export function renderHook<T>(useHook: () => T): HookHandle<T> {
  const latest: { value: T | undefined } = { value: undefined }
  function Probe(): null {
    latest.value = useHook()
    return null
  }
  const rendered = render(<Probe />)
  return {
    get current() {
      return latest.value as T
    },
    rerender: () => rendered.rerender(<Probe />),
    unmount: rendered.unmount,
  }
}

/** Every element matching `selector` whose trimmed text is exactly `text`. */
type QueryableElement = ComponentRef<'div'> | ComponentRef<'button'> | ComponentRef<'span'>

export function byText<T extends QueryableElement = ComponentRef<'div'>>(container: ComponentRef<'div'>, text: string, selector = '*'): T[] {
  return Array.from(container.querySelectorAll<T>(selector)).filter((el) => el.textContent?.trim() === text)
}

export { act }
