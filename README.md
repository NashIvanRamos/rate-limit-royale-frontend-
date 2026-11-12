# Rate Limit Royale: frontend

A single-page React game. In each of 5 rounds you configure a rate-limit defense (algorithm, max requests,
window, key by IP or user), deploy it to the real Express API, and the browser fires a scripted mix of attacker
and legitimate traffic at it. Every number on screen comes from real HTTP responses: 200 accepted, 429 blocked,
401 rejected auth. The server's own tally (`GET /api/stats`) is shown next to it as a cross-check.

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
If the header pill says **Offline**, the backend isn't running. **Degraded** means a Redis-backed backend lost Redis
(see [Cluster mode](#cluster-mode)). If round 4 fails with "Backend not in DEMO_MODE",
restart it with `DEMO_MODE=true`.

Keep the tab in the foreground while a round fires: background tabs throttle timers.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with the `/api` proxy |
| `npm run build` | Typecheck, then production build |
| `npm run typecheck` | Typecheck only |
| `npm run lint` | ESLint |

## The rounds

| # | Round | Attack | Lesson |
|---|---|---|---|
| 1 | Steady Flood | One account, 20 req/s for 10s | Any algorithm contains a steady flood. |
| 2 | Edge Exploit | A full quota just before a fixed-window boundary and another just after | Fixed window lets ~2× through. Sliding and token don't. |
| 3 | Burst Attack | 100 requests in 5s | Token bucket: a burst, then the refill rate. Sliding: strict per window. |
| 4 | Credential Stuffing + Forged Tokens | Wrong passwords on `/api/login`; forged, `alg: none` and garbage tokens; carol's expired token | Login has its own limit. Bad tokens get 401 and never touch your limiter. Expired legit tokens cost nothing. |
| 5 | Account-Rotation Boss Wave | 50 stolen accounts from one IP, ~300 requests in 10s | Key by user: 50 budgets. Key by IP: one budget. |

Legit clients (alice, bob, carol) send a request every ~1.5s in every round. **A legit 429 costs XP; a legit 401
(expired token) never does.**

## Simulated client IPs

The browser simulates many clients by setting `X-Forwarded-For` per request. The Vite proxy (`xfwd: true`) adds
the loopback hop, and the backend trusts `X-Forwarded-For` **only from loopback**. This is a local demo
technique. **Never trust client-supplied forwarding headers like this in production.**

## Scoring

Each round is worth up to 500 XP: `500 × containment × (1 − 0.1 × legit blocks)`. Containment is 1 while the
attacker's 200s stay within 115% of the allowance: what a correct limiter of the chosen algorithm should let
one attacker IP through over the attack's span (fixed: one quota per window touched; sliding: one quota per
window length; token: the bucket plus its refill). Round 2 always allows a single quota, because both bursts
land within ~500ms. A round is cleared with zero legit blocks and containment ≥ 0.8. Coefficients live in
`SCORING` in `src/scoring.ts`.

## Verification matrix

Real runs against a single backend node, through the same `runRound` → `tally` → `score` code the UI uses.
"Server" compares the browser's `/api/resource` (and round 4's `/api/login`) counts with `GET /api/stats`.
First run on 2026-11-11; re-run on 2026-11-12 against the distributed-mode backend (backend tasks2 00–08, still on
a single node): every number below came out identical.

| Round | Config | Expect | Attacker passed / sent (allowance) | 200 / 429 / 401 | Legit blocks | Outcome | Server |
|---|---|---|---|---|---|---|---|
| 1 | fixed · 10/10s · ip | contained, 0 legit blocks | 10 / 200 (10) | 24 / 190 / 0 | 0 | Cleared, 500 XP | ✓ match |
| 1 | sliding · 10/10s · ip | contained, 0 legit blocks | 10 / 200 (10) | 24 / 190 / 0 | 0 | Cleared, 500 XP | ✓ match |
| 1 | token · 10/10s · ip | contained, 0 legit blocks | 19 / 200 (19) | 33 / 181 / 0 | 0 | Cleared, 500 XP | ✓ match |
| 2 | fixed · 10/3s · ip | ≈2× quota passes, Breached | 20 / 20 (10) | 28 / 0 / 0 | 0 | Breached, 288 XP | ✓ match |
| 2 | sliding · 10/3s · ip | ≈1× quota, Cleared | 10 / 20 (10) | 18 / 10 / 0 | 0 | Cleared, 500 XP | ✓ match |
| 3 | token · 10/1s · ip | differs from sliding | 59 / 100 (59) | 67 / 41 / 0 | 0 | Cleared, 500 XP | ✓ match |
| 3 | sliding · 10/1s · ip | differs from token | 50 / 100 (50) | 58 / 50 / 0 | 0 | Cleared, 500 XP | ✓ match |
| 4 | fixed · 10/10s · ip | login 5×401 then 429; forged/alg:none → invalid_signature; carol → expired; 0 legit blocks | 0 / 150 (0) | 8 / 55 / 99 (login 5×401, 55×429; invalid_signature 60, expired 4, malformed 30) | 0 (+4 expired, not penalised) | Cleared, 500 XP | ✓ match |
| 5 | fixed · 10/10s · **user** | attacker mostly passes, near 0 XP | 300 / 300 (20) | 320 / 0 / 0 | 0 | Breached, 38 XP | ✓ match |
| 5 | fixed · 10/10s · **ip** | contained, Cleared | 11 / 300 (20) | 31 / 289 / 0 | 0 | Cleared, 500 XP | ✓ match |
| 1 | fixed · 5/60s · ip | legit blocks → penalty | 5 / 200 (5) | 15 / 199 / 0 | 4 | Breached, 300 XP | ✓ match |

In round 5 the server's limiter also confirms the keying story: 53 keys under key by user (50 attacker + 3
legit) vs 4 under key by IP (1 + 3).

### Definition of done

- [x] Five rounds run end to end with real request results.
- [x] The keying toggle changes the outcome of round 5 (300 vs 11 attacker requests through).
- [x] 401s are reported separately from 429s and never count as legit blocks (round 4: 4 expired legit, 0 legit blocks).
- [x] Every number shown comes from a real run; the components contain no example data.

## Cluster mode

The backend can also run as 3 nodes behind NGINX (`npm run cluster` in the backend), with limiter state either
per node (`--store memory`) or shared in Redis (`--store redis`). Point the frontend at it:

```sh
# backend: pick one
npm run cluster -- --store memory                 # round robin, state per node (leaks)
npm run cluster -- --store redis                  # round robin, shared state in Redis (fixed)
npm run cluster -- --lb sticky --store memory     # sticky routing (looks fixed, isn't)

# frontend
API_TARGET=http://localhost:8080 \
API_NODES=http://localhost:3001,http://localhost:3002,http://localhost:3003 \
npm run dev
```

- `API_TARGET` is where game traffic goes (default `http://localhost:3000`, a single node).
- `API_NODES` (memory-mode clusters) lets the game deploy to **every** node and add up every node's `/api/stats`. A
  deploy through NGINX only reaches one node, so without it the other two keep the previous round's state, the
  game shows a warning, and the cross-check says "unavailable". In Redis mode one deploy covers the cluster.
- The header shows **Cluster · memory/redis**, results show which node served how many requests, and round 5 gets
  a **Scaling** panel explaining the result from that run's per-node numbers.
- **Limiter state toggle.** On a Redis-backed cluster (`--store redis`, backend tasks2/09 or later) the config panel
  shows **Limiter state across the cluster: Shared (Redis) / Per node**. It's chosen per round on deploy
  (`limiterStore` in `POST /api/defense`), so you can compare both without restarting anything. Per node = each node
  keeps its own counters and login lockouts for that round; config and stats stay shared, so the cross-check still
  covers the whole cluster. The toggle only appears when the backend advertises both stores, and the field is only
  sent then. It's hidden on a single node (plain `npm run dev` in the backend), where there's only one node's state
  to share, and on a memory-only cluster (`--store memory`), which can't run a shared round.
- If Redis goes down, the pill turns **Degraded**: API requests fail open (served without rate limiting, counted
  and reported on the results) or closed (503, counted as errors), and logins and deploys are refused. Deploy is
  disabled until Redis recovers.

### Round 5 on the cluster, measured from the browser (2026-11-12)

Fixed window, 10 per 10s, **key by IP**. Single node for comparison: 11–13 through.

| Cluster | Attacker through | Attacker requests per node (passed) | Outcome | Server |
|---|---|---|---|---|
| round robin + memory | **33** | node-1 101 (11) · node-2 99 (11) · node-3 100 (11) | Breached | ✓ sum of 3 nodes |
| round robin + Redis | **13** | node-1 99 (4) · node-2 100 (4) · node-3 101 (5) | Cleared | ✓ |
| sticky + memory | **12** | node-2 300 (12) | Cleared | ✓ sum of 3 nodes |

Round 4 on the memory cluster also leaks: 15 failed logins before lockout (5 per node) instead of 5.

The same comparison with the **toggle**, on one Redis-backed cluster (`npm run cluster -- --store redis`), 2026-11-12:

| Limiter state | Round 5 attacker through | Round 4 failed logins before lockout | Server |
|---|---|---|---|
| Per node | **32** (node-1 10 · node-2 11 · node-3 11), Breached | **15** | ✓ |
| Shared (Redis) | **12** (4 · 4 · 4), Cleared | 5 | ✓ |

The backend's own `npm run experiment` (its `docs/experiment-results.md`, 2026-11-12) measured 33 / 13 / 13 for the
same three setups, and **23** for sticky + memory when the attacker's node is killed halfway through (13 with Redis).

### Interview notes

- **What happens with multiple servers?** Measured: with round robin and in-memory counters the attacker gets ~3×
  through (one budget per node). Moving the counters to Redis (atomic Lua scripts) brings it back to the
  single-node number.
- **Why not sticky sessions?** They look fixed (12–13 through) until a node dies: the attacker lands on a fresh node
  with a fresh budget (23 through in the backend's experiment).
- **What if Redis goes down?** Resource requests fail open with a degraded header (available but unprotected; the
  game reports how many), logins fail closed (no unlimited password guessing), and it recovers on its own.

## Demo script (under 5 minutes)

1. **Round 2, the algorithm story.** Set the window to **3s**, keep **Fixed Window**, deploy: both bursts pass
   (20 of 20, 2× quota), **Breached**. The timeline shows one burst on each side of the window boundary.
   Click **Retry this round**, switch to **Sliding Window**, deploy: 10 of 20, **Cleared**.
2. **Round 5, the keying story.** Choose **Key by user**, deploy: all 50 account cells light up green, ~300
   requests through, **Breached**. Click **Retry this round**, switch to **Key by IP**, deploy: the single
   `10.6.6.6` cell turns red after its quota, **Cleared**.

A retry replaces the round's earlier attempt, so its XP is only counted once.

3. **Optional, the scaling story (+30–45s).** Start the backend cluster once with `npm run cluster -- --store redis`
   and the frontend with `API_TARGET=http://localhost:8080` (see [Cluster mode](#cluster-mode)). In round 5, keyed
   by IP, set **Limiter state: Per node** and deploy: ~33 through, spread over 3 nodes, **Breached**, and the Scaling
   panel shows one budget per node. Click **Retry this round**, switch to **Shared (Redis)**: ~13 through,
   **Cleared**. One sentence on sticky routing: it looks fixed until a node dies.

Keep the tab in the foreground while recording.
