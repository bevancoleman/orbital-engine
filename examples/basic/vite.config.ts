import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this repo's Pages site at /orbital-engine/, not the
// domain root — base must match that subpath or every asset URL in the
// built HTML resolves wrong. Root-relative locally (`npm run dev` doesn't
// care), only matters for the built output CI deploys.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/orbital-engine/' : '/',
  plugins: [react()],
  // orbital-engine is linked via `file:../..`, so its dist/ resolves
  // three / react / @react-three/* from the repo root's node_modules while
  // this app resolves them from its own — two copies of three (broken
  // instanceof checks, "multiple instances" warnings) and two Reacts
  // (invalid hook calls). Dedupe forces one copy, this app's own.
  resolve: {
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  server: { port: 5173, strictPort: true },
})
