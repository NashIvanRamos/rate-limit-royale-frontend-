# Backend hand-off: what's new and what to do next in the frontend

The frontend (tasks 00–15) was built against the backend as it was on 2026-11-11. Since then the backend added
**distributed mode** (backend `tasks2/00–08`): 3 nodes behind NGINX, optional Redis, and fail-open/closed. This file
is the starting point for the next frontend session.

**TL;DR:** Nothing breaks on a single node. Run the backend exactly as before and the game works. Three small
compatibility fixes are worth making (task 16), and there's an optional cluster demo (tasks 17–18) if you want to
show the scaling story in the video.

---

## 0. Backend status

- **Done:** backend tasks 00–10 (game API) and tasks2 00–08 (distributed mode). 267 backend tests pass.
- **Pending: merging.** Backend PRs #6–#15 are open and stacked. Until they're merged, run the backend from the
  branch `t2/08-readme-update`, which contains everything, or merge them in order first. When merging: retarget
  the next PR to `main` before merging the previous one, and don't delete branches mid-stack.
- **Reference:** the backend `README.md`, especially "Scaling out: 3 nodes behind NGINX", and the appendix at the end
  of the backend's `Frontend-Steps.md`.

## 1. Run it

**Single node (default, unchanged):**
```sh
# backend (../rate-limit-royale-backend): .env already has DEMO_MODE=true
npm run dev                      # :3000
# frontend (this folder)
npm run dev                      # :5173, proxies /api → :3000
```

**Cluster (optional, for the scaling demo):**
```sh
brew install nginx redis                          # one time
# backend
npm run cluster -- --store redis                  # NGINX :8080 → nodes :3001-3003, Redis :6379
npm run cluster -- --store memory                 # same, without Redis (shows the leak)
npm run cluster -- --lb sticky --store memory     # sticky routing (looks fixed, isn't)
# frontend: point the proxy at :8080 instead of :3000 (task 17 makes this an env var)
```
Stop `npm run dev` on the backend first if it's using a port you need. The cluster uses 8080, 3001–3003 and 6379.

## 2. What changed in the backend contract

All changes are **additive**. Nothing the frontend relies on was removed or renamed.

| Where | Change |
|---|---|
| Every response | New header `X-Node-Id` (`single` on one node, `node-1..3` in the cluster). Exposed via CORS. |
| `GET /api/health` | New fields: `nodeId`, `store` (`memory` \| `redis`). In Redis mode, also `redis` (`up` \| `down`) and `failureMode`. **`status` can now be `"degraded"`** (Redis down, still HTTP 200), and then `algorithm`/`keyBy` are `null`. |
| `GET /api/stats` | New fields: `nodeId`, `store`. In Redis mode **any node returns the whole cluster's numbers**. In a memory-mode cluster each node only knows its own traffic. |
| New statuses (Redis mode, Redis down only) | `/api/resource` → 200 + `X-RateLimit-Degraded: true` (default `REDIS_FAILURE_MODE=open`) or **503** `{ error: "limiter_unavailable" }`. `/api/login`, `/api/defense`, `/api/stats` → **503** `{ error: "store_unavailable" }`. |
| Scoring reference | The backend's `src/scenarios/results.ts` uses a single allowance formula (`max × (1 + duration / window)`). **The frontend's per-algorithm allowance in `src/scoring.ts` stays the source of truth for XP.** No change needed. The backend's version is only a tested reference. |

## 3. Compatibility findings in the current frontend code

Checked against the frontend source:

1. **`src/hooks/useServerHealth.ts`:** `onStatus(res.ok && res.data.status === "healthy")`. A Redis outage
   (`status: "degraded"`) shows as **Offline** and blocks deploys. Arguably right, since deploys would 503, but a
   distinct **Degraded** pill tells the truth.
2. **`src/api.ts` `HealthResponse`:** typed as `status: "healthy"` with non-null `algorithm`/`keyBy`. Add the new
   fields and widen the types.
3. **`src/scoring.ts` `tally()`:** a backend 503 has a JSON body, so `apiRequest` returns `status: 503`, and `tally()`
   puts it in **no bucket**: it isn't counted as accepted, blocked, rejected or an error. The brief's rule
   (Frontend-Steps §5) is "network error → `errors`, never accepted or blocked". Count any `status >= 500` as `errors` too.
4. **`src/crossCheck.ts`:** compares the browser tally with **one** `/api/stats`. On a memory-mode cluster that's
   one node's slice, so it would show a false mismatch. Use `stats.store`: if it's `memory` and `nodeId` isn't
   `single`, show "per-node stats: cross-check unavailable" instead of a red ✗. (In Redis mode it just works.)
5. **`vite.config.ts`:** the proxy target is hard-coded to `http://localhost:3000`.

---

## 4. Next tasks

Same workflow as before (`CLAUDE.md`): one branch per group, validate, commit, push.

### Task 16: Compatibility fixes (do this first) · small
- **Done when:**
  - `HealthResponse` has `nodeId`, `store`, optional `redis` and `failureMode`, `status: "healthy" | "degraded"`, and nullable `algorithm`/`keyBy`.
  - The header pill has three states: **Online** / **Degraded** (`status === "degraded"`, with a tooltip like "Redis down: limits are fail-open") / **Offline**. Deploy stays disabled while degraded.
  - `tally()` counts `status >= 500` as `errors`, and the results card's error row shows them.
  - The cross-check shows "per-node stats" rather than a mismatch when `store === "memory"` behind a cluster.
  - `npm run typecheck` and `npm run lint` are clean. Rounds 1–5 still play end to end on a single-node backend.

### Task 17: Cluster target + node split · small
- `vite.config.ts`: `target: process.env.API_TARGET ?? "http://localhost:3000"`, so `API_TARGET=http://localhost:8080 npm run dev` points at the cluster. Document it in the README.
- Record `X-Node-Id` on each `RequestRecord` (the scheduler already has the `Response`).
- The results card shows a small "served by: node-1 106 · node-2 107 · node-3 107" line when more than one node answered.
- Show `store` (memory / redis) next to the header pill when it isn't a single node.
- **Done when:** in cluster mode the node split appears and adds up to the request total. On a single node nothing changes.

### Task 18 (optional): The scaling story in the UI · small–medium
The browser can't restart the cluster, so this is about **showing** what the backend measured, not switching modes:
- Play round 5 keyed by IP three times: once each on `--store memory` (round robin), `--store redis`, and
  `--lb sticky --store memory`. The attacker should get about 33 / 13 / 13 through, matching the backend's
  `npm run experiment`.
- Optional: a "Scaling" info panel on the final summary that explains the three results, with the backend's measured table.
- **Done when:** the three runs match the backend's `docs/experiment-results.md` within a few requests.

### Task 19: Re-verify and update the video plan · small
- Re-run the frontend verification matrix (README) against the merged backend on a single node. The numbers
  should be unchanged.
- If you're including the scaling story: add about 30–45s to the video after round 5. Show the cluster, play round 5
  on memory (leaks about 3×), then on Redis (fixed), with one sentence on sticky routing.

**Cut order if short on time:** 18 → 17 → (keep 16 and 19).

---

## 5. Interview notes this unlocks

- **"What happens with multiple servers?"** You measured it: about 3× leak with round robin and in-memory state, fixed
  by Redis with atomic Lua scripts, back to the single-node numbers.
- **"Why not sticky sessions?"** They look fixed until a node dies: 13 → 23 through, because the attacker gets a fresh
  budget on the next node.
- **"What if Redis goes down?"** Resource requests fail open with a degraded header (available but unprotected).
  Login fails closed (no unlimited password guessing). It recovers on its own.
