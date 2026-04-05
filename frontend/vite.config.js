import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': 'http://localhost:8000',
      '/expenses': 'http://localhost:8000',
      '/investments': 'http://localhost:8000',
      '/webhook': 'http://localhost:8000',
      '/setup': 'http://localhost:8000',
    }
  },
  build: {
    outDir: 'dist'
  }
})
