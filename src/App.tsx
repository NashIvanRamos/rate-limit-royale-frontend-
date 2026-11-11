import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { BriefingCard } from "./components/BriefingCard";
import { ConfigPanel } from "./components/ConfigPanel";
import { DefensePreview } from "./components/DefensePreview";
import { DeployButton } from "./components/DeployButton";
import { ErrorBanner, OfflineBanner, TabHiddenBanner } from "./components/ErrorBanner";
import { FinalSummary } from "./components/FinalSummary";
import { Header } from "./components/Header";
import { LiveFiring } from "./components/LiveFiring";
import { ResultsCard } from "./components/ResultsCard";
import { Button } from "./components/ui/Button";
import { ComponentGallery } from "./debug/ComponentGallery";
import { DebugPanel } from "./debug/DebugPanel";
import { crossCheck } from "./crossCheck";
import { useServerHealth } from "./hooks/useServerHealth";
import { DeployError, OfflineError, RoundAbortedError, runRound, SetupError, type RoundRun } from "./runRound";
import { edgeExploitTiming, ROUND_COUNT, scenarioFor } from "./scenarios";
import { score, tally } from "./scoring";
import { initialState, reducer, type AppError } from "./state";
import type { BoundaryTimeline, DefenseConfig, Scenario } from "./types";

/** Maps a runRound failure to what the player sees. null = aborted on purpose (no message). */
function toAppError(err: unknown): AppError | null {
  if (err instanceof RoundAbortedError) return null;
  if (err instanceof OfflineError) return { kind: "offline", message: err.message };
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

function Game() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controllerRef = useRef<AbortController | null>(null);

  const onHealth = useCallback((online: boolean) => dispatch({ type: "SERVER_STATUS", online }), []);
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
    if (controllerRef.current || state.phase !== "configuring" || state.serverOnline !== true) return;
    const ac = new AbortController();
    controllerRef.current = ac;
    const round = state.round;
    const config = state.config;
    setTabWarning(false);
    dispatch({ type: "DEPLOY_START" });
    try {
      const run = await runRound({
        scenario,
        config,
        signal: ac.signal,
        onStage: (event) => dispatch({ type: "FIRING_STAGE", event }),
        onProgress: (progress) => dispatch({ type: "FIRING_PROGRESS", progress }),
      });
      const t = tally(run.records);
      // Lost requests make the round's numbers incomplete: don't score it.
      if (t.errors > 0) throw new OfflineError(`Lost the backend mid-round: ${t.errors} of ${t.total} requests failed. No XP recorded.`);
      const s = score(t, run.deployed.config, run.events, scenario, { startAt: run.startAt, windowEpochMs: run.deployed.windowEpochMs });
      const timeline = scenario.id === 2 ? boundaryTimeline(run, scenario) : undefined;
      const check = run.serverStats ? crossCheck(t, run.serverStats, scenario, run.deployed.config) : undefined;
      dispatch({
        type: "ROUND_COMPLETE",
        result: { round, config: run.deployed.config, tally: t, ...s, durationMs: run.durationMs, timeline, crossCheck: check },
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
      {state.serverOnline === false && <OfflineBanner />}
      {state.error && (
        <ErrorBanner
          error={state.error}
          onDismiss={dismissError}
          onRetry={state.error.kind === "setup" && state.phase === "configuring" ? handleDeploy : undefined}
          retryDisabled={state.serverOnline !== true}
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
          <Header round={state.round} score={state.score} serverOnline={state.serverOnline} />
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
            <ConfigPanel config={state.config} onChange={setConfig} disabled={state.phase !== "configuring"} />
            <DefensePreview config={state.config} />
            {showConfig && notices}
            {state.phase !== "results" && (
              <DeployButton firing={state.firing} isFiring={isFiring} disabled={state.serverOnline !== true} onDeploy={handleDeploy} />
            )}
            {isFiring && (
              <>
                <LiveFiring firing={state.firing} scenario={scenario} config={state.config} />
                <Button variant="ghost" fullWidth onClick={abortRound}>
                  Abort round
                </Button>
              </>
            )}
          </section>
        )}

        {state.phase === "results" && state.results && (
          <section className="section">
            <ResultsCard result={state.results} scenario={scenario} isLastRound={state.round >= ROUND_COUNT} onNext={() => dispatch({ type: "NEXT_ROUND" })} />
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

// Dev-only tools: #debug (plumbing and round harness) and #gallery (UI primitives). Reload after changing the hash.
function App() {
  if (import.meta.env.DEV && window.location.hash === "#debug") return <DebugPanel />;
  if (import.meta.env.DEV && window.location.hash === "#gallery") return <ComponentGallery />;
  return <Game />;
}

export default App;
