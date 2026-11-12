import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

// API_TARGET: where /api goes. Default: a single backend node on :3000.
//   API_TARGET=http://localhost:8080 npm run dev   → play through the 3-node cluster's NGINX.
// API_NODES (optional): the cluster's nodes, comma-separated, e.g.
//   API_NODES=http://localhost:3001,http://localhost:3002,http://localhost:3003
// Each node gets a /__node/<i>/api/* route, so on a memory-mode cluster the game can deploy to every node and
// add up their stats (a deploy through NGINX reaches only one node). Game traffic still goes through API_TARGET.
const target = process.env.API_TARGET || 'http://localhost:3000'
const nodes = (process.env.API_NODES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// `xfwd: true` appends the proxy hop (127.0.0.1) to X-Forwarded-For, so Express (trust proxy = loopback) sees the
// simulated client IP each request sets. Never trust X-Forwarded-For like this in production.
const proxy: Record<string, ProxyOptions> = { '/api': { target, xfwd: true } }
nodes.forEach((url, i) => {
  const prefix = `/__node/${i + 1}`
  proxy[prefix] = { target: url, xfwd: true, rewrite: (path) => path.slice(prefix.length) }
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __API_NODE_COUNT__: JSON.stringify(nodes.length) },
  server: { proxy },
})
