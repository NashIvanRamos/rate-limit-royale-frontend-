// THROWAWAY (tasks 03–04): runs round 1 from scenarios.ts through runRound() and prints the real tally.
// Removed in task 15 with the rest of src/debug/.
import { useEffect, useRef, useState } from "react";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { DistributionBar } from "../components/ui/DistributionBar";
import { MetricRow } from "../components/ui/MetricRow";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Tag } from "../components/ui/Tag";
import { DeployError, OfflineError, RoundAbortedError, runRound, SetupError, type StageEvent } from "../runRound";
import type { FiringProgress } from "../scheduler";
import { tally } from "../scoring";
import { scenarioFor } from "../scenarios";
import type { DefenseConfig, Tally } from "../types";

const ROUND_1_CONFIG: DefenseConfig = { algorithm: "fixed", maxRequests: 10, windowMs: 10_000, keyBy: "ip" };
const INVALID_CONFIG: DefenseConfig = { ...ROUND_1_CONFIG, maxRequests: 3 };

interface RunSummary {
  key: number;
  configLabel: string;
  tally: Tally;
  ms: number;
}

const configLabel = (c: DefenseConfig) => `${c.algorithm} · ${c.maxRequests}/${c.windowMs / 1000}s · ${c.keyBy}`;

function stageLabel(e: StageEvent): string {
  switch (e.stage) {
    case "deploying":
      return "Deploying…";
    case "logging-in":
      return `Logging in ${e.done}/${e.total}`;
    case "waiting-boundary":
      return `Waiting for window boundary (fires at ${new Date(e.firesAt).toLocaleTimeString()})`;
    case "firing":
      return "Firing";
    case "draining":
      return "Draining…";
  }
}

function errorText(err: unknown): { title: string; body?: string } {
  if (err instanceof DeployError) return { title: `Deploy rejected (${err.status})`, body: err.details.map((d) => `${d.field}: ${d.message}`).join(" · ") || err.message };
  if (err instanceof SetupError) return { title: "Setup failed", body: err.message };
  if (err instanceof OfflineError) return { title: "Backend offline", body: "Start it with DEMO_MODE=true npm run dev on :3000." };
  if (err instanceof RoundAbortedError) return { title: "Round aborted", body: "Nothing recorded." };
  return { title: "Unexpected error", body: String(err) };
}

export function RoundHarness() {
  const controller = useRef<AbortController | null>(null);
  const nextKey = useRef(0);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<string[]>([]);
  const [progress, setProgress] = useState<FiringProgress | null>(null);
  const [error, setError] = useState<{ title: string; body?: string } | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);

  // Abort an in-flight round if the panel unmounts.
  useEffect(() => () => controller.current?.abort(), []);

  async function start(config: DefenseConfig) {
    if (controller.current) return; // a round is already running: double clicks start nothing
    const ac = new AbortController();
    controller.current = ac;
    setRunning(true);
    setStages([]);
    setProgress(null);
    setError(null);
    const t0 = performance.now();
    try {
      const run = await runRound({
        scenario: scenarioFor(1),
        config,
        signal: ac.signal,
        onStage: (e) =>
          setStages((prev) => {
            const label = stageLabel(e);
            // Collapse repeated logging-in updates into one line.
            return e.stage === "logging-in" && prev.at(-1)?.startsWith("Logging in") ? [...prev.slice(0, -1), label] : [...prev, label];
          }),
        onProgress: setProgress,
      });
      const summary: RunSummary = { key: nextKey.current++, configLabel: configLabel(run.deployed.config), tally: tally(run.records), ms: performance.now() - t0 };
      setRuns((prev) => [summary, ...prev].slice(0, 10));
    } catch (err) {
      setError(errorText(err));
    } finally {
      controller.current = null;
      setRunning(false);
    }
  }

  const latest = runs[0];
  const atk = latest?.tally.byClient.attacker;
  const atkPassed = atk?.s200 ?? 0;
  const meetsRound1 = latest !== undefined && atkPassed >= 10 && atkPassed <= 20 && latest.tally.legitBlocks === 0 && latest.tally.errors === 0;

  return (
    <Card label="Round 1 via runRound (tasks 03–04)" aside={<span className="num muted">{configLabel(ROUND_1_CONFIG)}</span>}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Button variant="primary" loading={running} onClick={() => start(ROUND_1_CONFIG)}>
          Run round 1
        </Button>
        <Button disabled={running} onClick={() => start(INVALID_CONFIG)}>
          Run with invalid config (maxRequests 3)
        </Button>
        <Button variant="ghost" disabled={!running} onClick={() => controller.current?.abort()}>
          Abort
        </Button>
      </div>

      {stages.length > 0 && (
        <ol className="num muted" style={{ margin: 0, paddingLeft: 20 }}>
          {stages.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}

      {progress && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row spread">
            <span className="label">Responses</span>
            <span className="num">
              {progress.done}/{progress.total} · <span className="tone-accepted">{progress.counts.s200}</span> /{" "}
              <span className="tone-blocked">{progress.counts.s429}</span> / <span className="tone-auth">{progress.counts.s401}</span>
              {progress.counts.errors > 0 && <span className="muted"> · {progress.counts.errors} errors</span>}
            </span>
          </div>
          <ProgressBar value={progress.total ? progress.done / progress.total : 0} tone="accepted" label="Responses received" />
        </div>
      )}

      {error && (
        <Banner tone="blocked" title={error.title} onDismiss={() => setError(null)}>
          {error.body}
        </Banner>
      )}

      {latest && (
        <>
          <div className="row spread">
            <span className="label">Latest tally · {latest.configLabel}</span>
            <Tag tone={meetsRound1 ? "accepted" : "blocked"}>{meetsRound1 ? "Meets round 1 check" : "Check failed"}</Tag>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Expect: attacker 200s between 10 and 20, the rest 429, 0 legit blocks, 0 errors.
          </p>
          <div className="metric-list">
            <MetricRow label="Accepted (200)" tone="accepted" value={latest.tally.accepted} />
            <MetricRow label="Blocked (429)" tone="blocked" value={latest.tally.blocked} />
            <MetricRow label="Rejected auth (401)" tone="auth" value={latest.tally.rejectedAuth} />
            {latest.tally.errors > 0 && <MetricRow label="Errors (network)" value={latest.tally.errors} />}
            <MetricRow label="Avg latency" value={`${latest.tally.avgLatencyMs.toFixed(1)} ms`} />
            <MetricRow
              label="Legit blocks"
              tone={latest.tally.legitBlocks > 0 ? "blocked" : undefined}
              value={latest.tally.legitBlocks}
              note={latest.tally.legitExpired > 0 ? `expired-token legit: ${latest.tally.legitExpired} (not penalised)` : undefined}
            />
            <MetricRow
              label="Attacker"
              value={`${latest.tally.attackTotal} sent · ${latest.tally.attackStopped} stopped · ${latest.tally.attackPassed} passed`}
            />
          </div>
          <DistributionBar
            label="Response distribution"
            segments={[
              { label: "200", value: latest.tally.accepted, tone: "accepted" },
              { label: "429", value: latest.tally.blocked, tone: "blocked" },
              { label: "401", value: latest.tally.rejectedAuth, tone: "auth" },
            ]}
          />
          <details>
            <summary className="label">Raw tally JSON</summary>
            <pre className="num" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {JSON.stringify(latest.tally, null, 2)}
            </pre>
          </details>
        </>
      )}

      {runs.length > 1 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Previous runs (same config → similar tally, since deploy resets state)</span>
          {runs.map((r) => (
            <span key={r.key} className="num muted">
              #{r.key + 1} {r.configLabel}: attacker {r.tally.byClient.attacker?.s200 ?? 0}×200 / {r.tally.byClient.attacker?.s429 ?? 0}×429 · legit blocks{" "}
              {r.tally.legitBlocks} · {(r.ms / 1000).toFixed(1)}s
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
