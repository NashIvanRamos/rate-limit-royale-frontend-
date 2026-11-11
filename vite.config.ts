import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin /api calls are forwarded to the backend. `xfwd: true` appends the proxy hop
      // (127.0.0.1) to X-Forwarded-For, so Express (trust proxy = loopback) sees the simulated
      // client IP each request sets. Never trust X-Forwarded-For like this in production.
      '/api': { target: 'http://localhost:3000', xfwd: true },
    },
  },
})
