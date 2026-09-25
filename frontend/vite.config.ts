import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/questionbank/',
  plugins: [react()],
  build: {
    // The backend serves this build directly and already uses /assets/ for
    // uploaded question images/diagrams — rename Vite's own bundle output
    // directory so the two never collide.
    assetsDir: 'app-assets',
  },
})
