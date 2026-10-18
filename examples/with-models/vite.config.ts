import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/orbital-engine/with-models/' : '/',
  plugins: [react()],
  // Same `file:../..` link as examples/basic — see the note there.
  resolve: {
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  server: { port: 5174, strictPort: true },
})
