// Thin typed wrappers over the backend contract (brief §1). Nothing here throws on HTTP errors: every call
// resolves to a discriminated ApiResult. Paths are relative (/api/...) so they go through the Vite proxy,
// which is what makes the simulated X-Forwarded-For IPs work.

import type { Algorithm, DefenseConfig, KeyBy, LoginBody, ValidationIssue } from "./types";

// ─── Result shape ────────────────────────────────────────────────────────────

export interface ApiError {
  /** Backend error code ("unauthorized", "rate_limited", …) or a client-side one (see below). */
  error: string;
  /** 401 only: missing_token | invalid_signature | expired | malformed. */
  reason?: string;
  /** 429 only. */
  retryAfterMs?: number;
  /** 400 invalid_config only. */
  details?: ValidationIssue[];
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T; headers: Headers }
  | { ok: false; status: number; error: ApiError; headers: Headers };

/** Client-side error codes. Network and aborted results have status 0. */
export const CLIENT_ERRORS = Object.freeze({
  /** Backend unreachable: fetch failed, or the Vite proxy answered 5xx without a JSON body. */
  network: "network",
  /** The caller's AbortSignal fired. The scheduler must not tally these. */
  aborted: "aborted",
  /** The backend answered, but the body wasn't the JSON object we expected. */
  badResponse: "bad_response",
});

// ─── Response bodies ─────────────────────────────────────────────────────────

export interface HealthResponse {
  status: "healthy";
  service: string;
  uptimeS: number;
  algorithm: Algorithm;
  keyBy: KeyBy;
}

export interface WhoamiResponse {
  ip: string;
}

export interface DefenseSnapshot {
  config: DefenseConfig;
  deployedAt: number;
  /** Fixed-window boundaries are at windowEpochMs + k × windowMs. */
  windowEpochMs: number;
}

export interface LoginResponse {
  token: string;
  tokenType: "Bearer";
  sub: string;
  expiresIn: number;
}

export interface ExpiredTokenResponse {
  token: string;
  tokenType: "Bearer";
  sub: string;
  expired: true;
}

export interface ResourceResponse {
  ok: true;
  sub: string;
  servedAt: number;
}

// ─── Core request ────────────────────────────────────────────────────────────

export interface RequestOptions {
  method?: "GET" | "POST";
  /** JSON-encoded. Sets Content-Type: application/json. */
  body?: unknown;
  /** Simulated client IP, sent as X-Forwarded-For. */
  ip?: string;
  /** Sent as Authorization: Bearer <token>. */
  token?: string;
  signal?: AbortSignal;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function failure<T>(status: number, error: ApiError, headers: Headers = new Headers()): ApiResult<T> {
  return { ok: false, status, error, headers };
}

function toApiError(body: Record<string, unknown>): ApiError {
  const error: ApiError = { error: typeof body.error === "string" ? body.error : "unknown" };
  if (typeof body.reason === "string") error.reason = body.reason;
  if (typeof body.retryAfterMs === "number") error.retryAfterMs = body.retryAfterMs;
  if (Array.isArray(body.details)) {
    error.details = body.details.filter(
      (d): d is ValidationIssue => isObject(d) && typeof d.field === "string" && typeof d.message === "string",
    );
  }
  return error;
}

/**
 * One request to the backend. Also used directly by the scheduler for scenario events, so every request
 * in the game goes through the same error handling.
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = "GET", body, ip, token, signal } = opts;
  const headers: Record<string, string> = {};
  if (ip) headers["X-Forwarded-For"] = ip;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch {
    return failure(0, { error: signal?.aborted ? CLIENT_ERRORS.aborted : CLIENT_ERRORS.network });
  }

  const parsed: unknown = await res.json().catch(() => null);

  if (!isObject(parsed)) {
    if (signal?.aborted) return failure(0, { error: CLIENT_ERRORS.aborted }, res.headers);
    // The backend always answers JSON, even for its own 500s. A 5xx with no JSON body comes from the
    // Vite proxy (502 when :3000 is down), so it means the same as an unreachable server.
    if (res.status >= 500) return failure(0, { error: CLIENT_ERRORS.network }, res.headers);
    return failure(res.status, { error: CLIENT_ERRORS.badResponse }, res.headers);
  }

  if (res.ok) return { ok: true, status: res.status, data: parsed as T, headers: res.headers };
  return failure(res.status, toApiError(parsed), res.headers);
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

/** Demo password convention. The only place it's defined on the frontend. */
export const passwordFor = (username: string): string => `pass-${username}`;

/** GET /api/health: never rate limited. No IP header. */
export function health(signal?: AbortSignal) {
  return apiRequest<HealthResponse>("/api/health", { signal });
}

/** GET /api/demo/whoami: the IP the server sees. 404 when the backend isn't in DEMO_MODE. */
export function whoami(ip: string, signal?: AbortSignal) {
  return apiRequest<WhoamiResponse>("/api/demo/whoami", { ip, signal });
}

/** GET /api/defense: the currently deployed defense. */
export function getDefense(signal?: AbortSignal) {
  return apiRequest<DefenseSnapshot>("/api/defense", { signal });
}

/**
 * POST /api/defense: deploys a defense and resets the limiter and the login lockouts.
 * Sends exactly the four fields (the server rejects unknown ones). Values are NOT clamped here: the UI
 * clamps, and a bad value must surface as the server's 400 `details[]`.
 */
export function deploy(config: DefenseConfig, signal?: AbortSignal) {
  const body: DefenseConfig = {
    algorithm: config.algorithm,
    maxRequests: config.maxRequests,
    windowMs: config.windowMs,
    keyBy: config.keyBy,
  };
  return apiRequest<DefenseSnapshot>("/api/defense", { method: "POST", body, signal });
}

/** POST /api/login. 401 invalid_credentials, or 429 once the IP has 5 failures in 60s. */
export function login(username: string, password: string, ip: string, signal?: AbortSignal) {
  const body: LoginBody = { username, password };
  return apiRequest<LoginResponse>("/api/login", { method: "POST", body, ip, signal });
}

/** POST /api/demo/expired-token: correctly signed but already expired. Shares the login failure counter. */
export function expiredToken(username: string, password: string, ip: string, signal?: AbortSignal) {
  const body: LoginBody = { username, password };
  return apiRequest<ExpiredTokenResponse>("/api/demo/expired-token", { method: "POST", body, ip, signal });
}

/** GET /api/resource: the protected endpoint. No token → 401 missing_token. */
export function resource(token: string | undefined, ip: string, signal?: AbortSignal) {
  return apiRequest<ResourceResponse>("/api/resource", { token, ip, signal });
}

// ─── Headers ─────────────────────────────────────────────────────────────────

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Retry-After, in whole seconds (429 only). */
  retryAfterS?: number;
}

function intHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** RateLimit-Limit, RateLimit-Remaining and Retry-After from a /api/resource response. */
export function readRateLimitHeaders(headers: Headers): RateLimitInfo {
  return {
    limit: intHeader(headers, "RateLimit-Limit"),
    remaining: intHeader(headers, "RateLimit-Remaining"),
    retryAfterS: intHeader(headers, "Retry-After"),
  };
}
