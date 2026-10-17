import { readFile, writeFile } from 'node:fs/promises'

import { defineConfig } from 'tsup'

const USE_CLIENT = '"use client";'
const USE_STRICT = '"use strict";'

/**
 * With CJS code splitting, tsup's ESM→CJS pass emits interop helpers ahead
 * of the entry's `"use client"` directive, which turns it into a plain
 * expression statement that React Server Component bundlers ignore. Move it
 * back into the directive prologue (straight after `"use strict"`) — same
 * line, so the sourcemap's line mappings are untouched.
 */
async function hoistUseClientDirective(file: string): Promise<void> {
  const code = await readFile(file, 'utf8')
  if (!code.startsWith(USE_STRICT)) throw new Error(`${file}: expected a "use strict" prologue`)
  const at = code.indexOf(USE_CLIENT)
  if (at === -1) throw new Error(`${file}: "use client" directive missing`)
  if (at === USE_STRICT.length) return
  const without = code.slice(0, at) + code.slice(at + USE_CLIENT.length)
  await writeFile(file, USE_STRICT + USE_CLIENT + without.slice(USE_STRICT.length))
}

export default defineConfig({
  entry: { index: 'src/index.ts', react: 'src/react/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Shared core goes into one chunk that both entries import, so an app
  // using `orbital-engine` and `orbital-engine/react` ships (and
  // instantiates) the core once, not twice.
  splitting: true,
  external: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  onSuccess: () => hoistUseClientDirective('dist/react.cjs'),
})
