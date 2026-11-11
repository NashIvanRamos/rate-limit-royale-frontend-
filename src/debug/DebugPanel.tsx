// THROWAWAY (tasks 01–02): proves the simulated-IP plumbing and the attack tokens against the real backend.
// Every line printed here is a real HTTP response. Removed in task 15 with the rest of src/debug/.
import { useRef, useState } from "react";
import * as api from "../api";
import type { ApiResult } from "../api";
import { ATTACKER_IPS, LEGIT_IPS } from "../clients";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { RoundHarness } from "./RoundHarness";
import { algNoneToken, forgedToken, garbageToken } from "../tokens";
import type { DefenseConfig } from "../types";

const DEBUG_CONFIG: DefenseConfig = { algorithm: "fixed", maxRequests: 10, windowMs: 10_000, keyBy: "ip" };

interface Session {
  aliceToken?: string;
}

interface Outcome {
  pass: boolean;
  result: ApiResult<unknown>;
}

interface Check {
  id: string;
  label: string;
  expect: string;
  run: (session: Session) => Promise<Outcome>;
}

interface LogEntry {
  key: number;
  label: string;
  expect: string;
  pass: boolean;
  output: string;
}

const is401 = (r: ApiResult<unknown>, reason: string) => !r.ok && r.status === 401 && r.error.reason === reason;

async function aliceToken(session: Session): Promise<ApiResult<api.LoginResponse> | string> {
  if (session.aliceToken) return session.aliceToken;
  const res = await api.login("alice", api.passwordFor("alice"), LEGIT_IPS.alice);
  if (!res.ok) return res;
  session.aliceToken = res.data.token;
  return res.data.token;
}

const CHECKS: Check[] = [
  {
    id: "health",
    label: "Health",
    expect: '200 { status: "healthy" }',
    run: async () => {
      const r = await api.health();
      return { pass: r.ok && r.data.status === "healthy", result: r };
    },
  },
  {
    id: "whoami",
    label: "Whoami as 10.0.0.7",
    expect: '200 { ip: "10.0.0.7" }',
    run: async () => {
      const r = await api.whoami("10.0.0.7");
      return { pass: r.ok && r.data.ip === "10.0.0.7", result: r };
    },
  },
  {
    id: "deploy",
    label: "Deploy fixed · 10/10s · ip",
    expect: "200 { config, deployedAt, windowEpochMs } (resets limiter + lockouts)",
    run: async () => {
      const r = await api.deploy(DEBUG_CONFIG);
      return { pass: r.ok && r.data.config.maxRequests === 10, result: r };
    },
  },
  {
    id: "deploy-invalid",
    label: "Deploy invalid (maxRequests: 3)",
    expect: "400 invalid_config with details[] for maxRequests",
    run: async () => {
      const r = await api.deploy({ ...DEBUG_CONFIG, maxRequests: 3 });
      const pass =
        !r.ok && r.status === 400 && r.error.error === "invalid_config" &&
        (r.error.details ?? []).some((d) => d.field === "maxRequests");
      return { pass, result: r };
    },
  },
  {
    id: "login-alice",
    label: "Login alice from 10.0.0.1",
    expect: '200 { token, sub: "alice" }',
    run: async (session) => {
      const r = await api.login("alice", api.passwordFor("alice"), LEGIT_IPS.alice);
      if (r.ok) session.aliceToken = r.data.token;
      return { pass: r.ok && r.data.sub === "alice" && r.data.token.length > 0, result: r };
    },
  },
  {
    id: "resource-alice",
    label: "Resource with alice's token",
    expect: '200 { ok: true, sub: "alice" } + RateLimit headers',
    run: async (session) => {
      const token = await aliceToken(session);
      if (typeof token !== "string") return { pass: false, result: token };
      const r = await api.resource(token, LEGIT_IPS.alice);
      const rl = api.readRateLimitHeaders(r.headers);
      return { pass: r.ok && r.data.sub === "alice" && rl.limit !== undefined && rl.remaining !== undefined, result: r };
    },
  },
  {
    id: "resource-none",
    label: "Resource with no token",
    expect: "401 missing_token",
    run: async () => {
      const r = await api.resource(undefined, LEGIT_IPS.alice);
      return { pass: is401(r, "missing_token"), result: r };
    },
  },
  {
    id: "forged",
    label: "Forged token (sub user02) from 10.6.6.7",
    expect: "401 invalid_signature",
    run: async () => {
      const r = await api.resource(forgedToken("user02"), ATTACKER_IPS.forged);
      return { pass: is401(r, "invalid_signature"), result: r };
    },
  },
  {
    id: "alg-none",
    label: "alg: none token (sub user03) from 10.6.6.8",
    expect: "401 invalid_signature",
    run: async () => {
      const r = await api.resource(algNoneToken("user03"), ATTACKER_IPS.algNone);
      return { pass: is401(r, "invalid_signature"), result: r };
    },
  },
  {
    id: "garbage",
    label: "Garbage token from 10.6.6.9",
    expect: "401 malformed",
    run: async () => {
      const r = await api.resource(garbageToken(), ATTACKER_IPS.garbage);
      return { pass: is401(r, "malformed"), result: r };
    },
  },
  {
    id: "expired",
    label: "Expired token for carol from 10.0.0.3",
    expect: "expired-token 200, then resource 401 expired",
    run: async () => {
      const e = await api.expiredToken("carol", api.passwordFor("carol"), LEGIT_IPS.carol);
      if (!e.ok) return { pass: false, result: e };
      const r = await api.resource(e.data.token, LEGIT_IPS.carol);
      return { pass: e.data.expired === true && is401(r, "expired"), result: r };
    },
  },
  {
    id: "get-defense",
    label: "Get current defense",
    expect: "200 { config, deployedAt, windowEpochMs }",
    run: async () => {
      const r = await api.getDefense();
      return { pass: r.ok && typeof r.data.windowEpochMs === "number", result: r };
    },
  },
];

function describe(result: ApiResult<unknown>): string {
  const rl = api.readRateLimitHeaders(result.headers);
  const hasRl = rl.limit !== undefined || rl.remaining !== undefined || rl.retryAfterS !== undefined;
  const shown = {
    status: result.status,
    ...(result.ok ? { data: result.data } : { error: result.error }),
    ...(hasRl ? { rateLimit: rl } : {}),
  };
  return JSON.stringify(shown, null, 2);
}

export function DebugPanel() {
  const session = useRef<Session>({});
  const nextKey = useRef(0);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<{ passed: number; total: number } | null>(null);

  async function runChecks(checks: Check[]) {
    setBusy(true);
    const entries: LogEntry[] = [];
    try {
      for (const check of checks) {
        let entry: LogEntry;
        try {
          const { pass, result } = await check.run(session.current);
          entry = { key: nextKey.current++, label: check.label, expect: check.expect, pass, output: describe(result) };
        } catch (err) {
          entry = { key: nextKey.current++, label: check.label, expect: check.expect, pass: false, output: String(err) };
        }
        entries.push(entry);
      }
    } finally {
      if (checks.length > 1) setSummary({ passed: entries.filter((e) => e.pass).length, total: checks.length });
      setLog((prev) => [...entries.reverse(), ...prev].slice(0, 50));
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <p className="label">Debug panel (tasks 01–04): real responses only</p>

      <Card label="Checks" aside={log.length > 0 && <span className="num muted">{log.length} logged</span>}>
        <Button variant="primary" fullWidth loading={busy} onClick={() => runChecks(CHECKS)}>
          Run all checks
        </Button>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {CHECKS.map((check) => (
            <Button key={check.id} disabled={busy} onClick={() => runChecks([check])}>
              {check.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            disabled={busy || log.length === 0}
            onClick={() => {
              setLog([]);
              setSummary(null);
            }}
          >
            Clear
          </Button>
        </div>
        {summary && (
          <p className={summary.passed === summary.total ? "num tone-accepted" : "num tone-blocked"} style={{ margin: 0 }}>
            Last full run: {summary.passed}/{summary.total} passed
          </p>
        )}
      </Card>

      <RoundHarness />

      {log.map((entry) => (
        <Card
          key={entry.key}
          label={entry.label}
          aside={<span className={entry.pass ? "num tone-accepted" : "num tone-blocked"}>{entry.pass ? "PASS" : "FAIL"}</span>}
        >
          <p className="muted" style={{ margin: 0 }}>Expect: {entry.expect}</p>
          <pre className="num" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12 }}>
            {entry.output}
          </pre>
        </Card>
      ))}
    </main>
  );
}
