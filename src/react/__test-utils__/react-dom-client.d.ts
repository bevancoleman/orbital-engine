// @types/react-dom isn't a dependency of this repo (the library itself
// never imports react-dom — only these tests' tiny render harness does),
// so this declares just the slice of react-dom/client that harness uses.
declare module 'react-dom/client' {
  import type { ReactNode } from 'react'
  export interface Root {
    render(children: ReactNode): void
    unmount(): void
  }
  export function createRoot(container: object): Root
}
