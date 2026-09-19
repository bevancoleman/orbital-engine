import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this repo's Pages site at /orbital-engine/, not the
// domain root — base must match that subpath or every asset URL in the
// built HTML resolves wrong. Root-relative locally (`npm run dev` doesn't
// care), only matters for the built output CI deploys.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/orbital-engine/' : '/',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
})
