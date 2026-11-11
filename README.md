# Rate Limit Royale: frontend

A single-page React game. In each of 5 rounds you configure a rate-limit defense, deploy it to the real
Express API, and the browser fires a scripted mix of attacker and legitimate traffic at it. Every number
on screen comes from real HTTP responses.

## Run locally

1. **Backend** (in `../rate-limit-royale-backend`), on port 3000 with the demo endpoints enabled:
   ```sh
   DEMO_MODE=true npm run dev
   ```
2. **Frontend** (this folder):
   ```sh
   npm install
   npm run dev
   ```
   Open http://localhost:5173. Vite proxies `/api/*` to `http://localhost:3000`.

Quick check that the proxy works: `curl localhost:5173/api/health` returns `{ "status": "healthy", … }`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with the `/api` proxy |
| `npm run build` | Typecheck, then production build |
| `npm run typecheck` | Typecheck only |
| `npm run lint` | ESLint |

## Simulated client IPs

The browser simulates many clients by setting `X-Forwarded-For` per request. The Vite proxy (`xfwd: true`)
adds the loopback hop, and the backend trusts `X-Forwarded-For` **only** from loopback. This is a local demo
technique. Never trust client-supplied forwarding headers like this in production.
