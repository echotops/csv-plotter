import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/csv-plotter/',
  plugins: [react()],
  // Plotly alone is ~1.5 MB gzipped; it's the whole point of the app, so don't warn about it.
  build: { chunkSizeWarningLimit: 6000 },
})
