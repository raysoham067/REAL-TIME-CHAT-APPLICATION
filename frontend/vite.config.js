import { defineConfig } from 'vite';

export default defineConfig({
  // Dev server
  server: {
    port: 5173,
    proxy: {
      // Forward /api/* and /socket.io/* to the backend during development
      '/api': {
        target:    'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target:    'http://localhost:3000',
        ws:        true,           // proxy WebSocket upgrade
        changeOrigin: true,
      },
    },
  },
  // Production build
  build: {
    outDir:     'dist',
    sourcemap:  true,
    target:     'es2020',
  },
});
