import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { BriefingCard } from "./components/BriefingCard";
import { ConfigPanel } from "./components/ConfigPanel";
import { DefensePreview } from "./components/DefensePreview";
import { DeployButton } from "./components/DeployButton";
import { ClusterDeployWarning, DegradedBanner, ErrorBanner, OfflineBanner, TabHiddenBanner } from "./components/ErrorBanner";
import { FinalSummary } from "./components/FinalSummary";
import { Header } from "./components/Header";
import { LiveFiring } from "./components/LiveFiring";
import { ResultsCard } from "./components/ResultsCard";
import { Button } from "./components/ui/Button";
import { crossCheck } from "./crossCheck";
import { useServerHealth } from "./hooks/useServerHealth";
import { API_NODE_COUNT } from "./api";
import { DeployError, OfflineError, RoundAbortedError, runRound, SetupError, StoreUnavailableError, type RoundRun } from "./runRound";
import { edgeExploitTiming, ROUND_COUNT, scenarioFor } from "./scenarios";
import { score, tally } from "./scoring";
import { canToggleLimiterStore, initialState, reducer, type AppError, type ServerState } from "./state";
import type { BoundaryTimeline, DefenseConfig, Scenario } from "./types";

/** Maps a runRound failure to what the player sees. null = aborted on purpose (no message). */
function toAppError(err: unknown): AppError | null {
  if (err instanceof RoundAbortedError) return null;
  if (err instanceof OfflineError) return { kind: "offline", message: err.message };
  if (err instanceof StoreUnavailableError) {
    return { kind: "degraded", message: `${err.message}. The backend's Redis store is down; try again once it recovers.` };
  }
  if (err instanceof DeployError) {
    return err.status === 400
      ? { kind: "invalid_config", message: "The server rejected this defense.", details: err.details }
      : { kind: "unknown", message: err.message };
  }
  if (err instanceof SetupError) {
    if (err.status === 404 && err.endpoint.startsWith("/api/demo/")) {
      return { kind: "setup", message: "Backend not in DEMO_MODE: restart it with DEMO_MODE=true." };
    }
    return { kind: "setup", message: `Couldn't log in ${err.username} (${err.status}). Redeploy to reset lockouts.` };
  }
  return { kind: "unknown", message: err instanceof Error ? err.message : String(err) };
}

/**
 * Round 2: each attacker request relative to the boundary its bursts aimed at. Uses the server's
 * servedAt when present (200s); otherwise the midpoint of the request (same machine, same clock).
 */
function boundaryTimeline(run: RoundRun, scenario: Scenario): BoundaryTimeline {
  const { boundary } = edgeExploitTiming(run.deployed.config, run.deployed.windowEpochMs, run.startAt);
  const attackers = new Set(scenario.clients.filter((c) => !c.legit).map((c) => c.id));
  const points = run.records
    .filter((r) => attackers.has(r.clientId))
    .map((r) => ({ t: Math.round((r.servedAt ?? run.startAt + r.sentAt + r.latencyMs / 2) - boundary), status: r.status }));
  return { points };
}

/** A round with failed requests isn't scored. Says why: lost connection (status 0) or server errors (5xx). */
function roundErrors(run: RoundRun, errors: number, total: number): Error {
  const failed = run.records.filter((r) => r.status === 0 || r.status >= 500);
  const serverSide = failed.filter((r) => r.status >= 500);
  if (serverSide.length === 0) return new OfflineError(`Lost the backend mid-round: ${errors} of ${total} requests failed. No XP recorded.`);
  const reasons = [...new Set(serverSide.map((r) => `${r.status} ${r.reason ?? ""}`.trim()))].join(", ");
  const message = `${errors} of ${total} requests failed (${reasons}). No XP recorded.`;
  return serverSide.some((r) => r.status === 503) ? new StoreUnavailableError(message.replace(/\.$/, "")) : new Error(message);
}

function Game() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controllerRef = useRef<AbortController | null>(null);

  const onHealth = useCallback((server: ServerState) => dispatch({ type: "SERVER_STATUS", server }), []);
  useServerHealth(onHealth);

  // Abort an in-flight round if the game unmounts.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const scenario = scenarioFor(state.round);
  const isFiring = state.phase === "firing";

  // Background tabs throttle timers: warn if the tab is hidden while a round is firing.
  const [tabWarning, setTabWarning] = useState(false);
  useEffect(() => {
    if (!isFiring) return;
    const onVisibility = () => {
      if (document.hidden) setTabWarning(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isFiring]);

  // Started only from this click handler, never from an effect (StrictMode runs effects twice).
  async function handleDeploy() {
    if (controllerRef.current || state.phase !== "configuring" || state.server.status !== "online") return;
    const ac = new AbortController();
    controllerRef.current = ac;
    const round = state.round;
    const server = state.server;
    // Send limiterStore only to a backend that advertises the per-round toggle: older ones reject unknown fields.
    const { limiterStore, ...base } = state.config;
    const config = canToggleLimiterStore(server) ? { ...base, limiterStore: limiterStore ?? "redis" } : base;
    setTabWarning(false);
    dispatch({ type: "DEPLOY_START" });
    try {
      const run = await runRound({
        scenario,
        config,
        signal: ac.signal,
        onStage: (event) => dispatch({ type: "FIRING_STAGE", event }),
        onProgress: (progress) => dispatch({ type: "FIRING_PROGRESS", progress }),
        server,
      });
      const t = tally(run.records);
      // Failed requests (network or 5xx) make the round's numbers incomplete: don't score it.
      if (t.errors > 0) throw roundErrors(run, t.errors, t.total);
      const s = score(t, run.deployed.config, run.events, scenario, { startAt: run.startAt, windowEpochMs: run.deployed.windowEpochMs });
      const timeline = scenario.id === 2 ? boundaryTimeline(run, scenario) : undefined;
      // The round's own limiter store (the deploy echoes the effective value), else the process-wide store.
      const roundStore = run.deployed.config.limiterStore ?? server.store;
      // On a memory-mode cluster one node's /api/stats is only that node's slice: comparing it would be a false
      // mismatch. With the nodes known (API_NODES), runRound sums every node's stats instead.
      const stats = run.serverStats;
      const perNodeOnly = run.fanOut === 0 && stats?.store === "memory" && stats.nodeId !== undefined && stats.nodeId !== "single";
      const check = stats && !perNodeOnly ? crossCheck(t, stats, scenario, run.deployed.config, Math.max(1, run.fanOut)) : undefined;
      const crossCheckNote = perNodeOnly ? `Per-node stats (${stats.nodeId}): cross-check unavailable on a memory-mode cluster.` : undefined;
      dispatch({
        type: "ROUND_COMPLETE",
        result: { round, config: run.deployed.config, tally: t, ...s, durationMs: run.durationMs, timeline, crossCheck: check, crossCheckNote,
          cluster: server.nodeId && server.nodeId !== "single" && roundStore ? { store: roundStore } : undefined,
        },
      });
    } catch (err) {
      dispatch({ type: "ROUND_FAILED", error: toAppError(err) });
    } finally {
      controllerRef.current = null;
    }
  }

  const setConfig = (config: Partial<DefenseConfig>) => dispatch({ type: "SET_CONFIG", config });
  /** Back to configuring with no XP and no history entry (runRound throws RoundAbortedError). */
  const abortRound = () => controllerRef.current?.abort();
  const dismissError = () => dispatch({ type: "DISMISS_ERROR" });
  const showConfig = state.phase === "configuring" || state.phase === "firing";

  // Notices go right above the deploy button while it's on screen (the page is long, and that's where
  // the player is looking after clicking Deploy); otherwise at the top.
  const notices = (
    <>
      {state.server.status === "offline" && <OfflineBanner />}
      {state.server.status === "degraded" && <DegradedBanner failureMode={state.server.failureMode} />}
      {state.server.store === "memory" && state.server.nodeId !== undefined && state.server.nodeId !== "single" && API_NODE_COUNT === 0 && (
        <ClusterDeployWarning />
      )}
      {state.error && (
        <ErrorBanner
          error={state.error}
          onDismiss={dismissError}
          onRetry={state.error.kind === "setup" && state.phase === "configuring" ? handleDeploy : undefined}
          retryDisabled={state.server.status !== "online"}
        />
      )}
      {tabWarning && <TabHiddenBanner onDismiss={() => setTabWarning(false)} />}
    </>
  );

  return (
    <main className="app">
      {!showConfig && notices}

      <div className="shell">
        <section className="hero">
          <Header round={state.round} score={state.score} server={state.server} />
          {state.phase !== "summary" && (
            <BriefingCard
              scenario={scenario}
              config={state.config}
              onContinue={state.phase === "briefing" ? () => dispatch({ type: "CONTINUE" }) : undefined}
            />
          )}
        </section>

        {(state.phase === "configuring" || state.phase === "firing" || state.phase === "results") && (
          <section className="section">
            <ConfigPanel
              config={state.config}
              onChange={setConfig}
              disabled={state.phase !== "configuring"}
              limiterStoreAvailable={canToggleLimiterStore(state.server)}
            />
            <DefensePreview config={state.config} showLimiterStore={canToggleLimiterStore(state.server)} />
            {showConfig && notices}
            {state.phase !== "results" && (
              <DeployButton firing={state.firing} isFiring={isFiring} disabled={state.server.status !== "online"} onDeploy={handleDeploy} />
            )}
            {isFiring && (
              <>
                <LiveFiring
                  firing={state.firing}
                  scenario={scenario}
                  config={state.config}
                  perNode={
                    state.server.nodeId !== undefined &&
                    state.server.nodeId !== "single" &&
                    (canToggleLimiterStore(state.server) ? (state.config.limiterStore ?? "redis") === "memory" : state.server.store === "memory")
                  }
                />
                <Button variant="ghost" fullWidth onClick={abortRound}>
                  Abort round
                </Button>
              </>
            )}
          </section>
        )}

        {state.phase === "results" && state.results && (
          <section className="section">
            <ResultsCard
              result={state.results}
              scenario={scenario}
              isLastRound={state.round >= ROUND_COUNT}
              onNext={() => dispatch({ type: "NEXT_ROUND" })}
              onRetry={() => {
                dispatch({ type: "RETRY_ROUND" });
                window.scrollTo({ top: 0 });
              }}
            />
          </section>
        )}

        {state.phase === "summary" && (
          <section className="section">
            <FinalSummary history={state.history} score={state.score} onRestart={() => dispatch({ type: "RESTART" })} />
          </section>
        )}
      </div>
    </main>
  );
}

function App() {
  return <Game />;
}

export default App;
