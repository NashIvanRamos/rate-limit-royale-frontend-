import { useCallback, useEffect, useReducer, useRef } from "react";
import { BriefingCard } from "./components/BriefingCard";
import { ConfigPanel } from "./components/ConfigPanel";
import { DefensePreview } from "./components/DefensePreview";
import { DeployButton } from "./components/DeployButton";
import { ErrorBanner, OfflineBanner } from "./components/ErrorBanner";
import { FinalSummary } from "./components/FinalSummary";
import { Header } from "./components/Header";
import { ResultsCard } from "./components/ResultsCard";
import { ComponentGallery } from "./debug/ComponentGallery";
import { DebugPanel } from "./debug/DebugPanel";
import { useServerHealth } from "./hooks/useServerHealth";
import { DeployError, OfflineError, RoundAbortedError, runRound, SetupError } from "./runRound";
import { ROUND_COUNT, scenarioFor } from "./scenarios";
import { score, tally } from "./scoring";
import { initialState, reducer, type AppError } from "./state";
import type { DefenseConfig } from "./types";

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

function Game() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controllerRef = useRef<AbortController | null>(null);

  const onHealth = useCallback((online: boolean) => dispatch({ type: "SERVER_STATUS", online }), []);
  useServerHealth(onHealth);

  // Abort an in-flight round if the game unmounts.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const scenario = scenarioFor(state.round);
  const isFiring = state.phase === "firing";

  // Started only from this click handler, never from an effect (StrictMode runs effects twice).
  async function handleDeploy() {
    if (controllerRef.current || state.phase !== "configuring" || state.serverOnline !== true) return;
    const ac = new AbortController();
    controllerRef.current = ac;
    const round = state.round;
    const config = state.config;
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
      dispatch({ type: "ROUND_COMPLETE", result: { round, config: run.deployed.config, tally: t, ...s, durationMs: run.durationMs } });
    } catch (err) {
      dispatch({ type: "ROUND_FAILED", error: toAppError(err) });
    } finally {
      controllerRef.current = null;
    }
  }

  const setConfig = (config: Partial<DefenseConfig>) => dispatch({ type: "SET_CONFIG", config });

  return (
    <main className="app">
      <Header round={state.round} score={state.score} serverOnline={state.serverOnline} />
      {state.serverOnline === false && <OfflineBanner />}
      {state.error && <ErrorBanner error={state.error} onDismiss={() => dispatch({ type: "DISMISS_ERROR" })} />}

      {state.phase === "briefing" && <BriefingCard scenario={scenario} config={state.config} onContinue={() => dispatch({ type: "CONTINUE" })} />}

      {(state.phase === "configuring" || state.phase === "firing") && (
        <>
          <BriefingCard scenario={scenario} config={state.config} />
          <ConfigPanel config={state.config} onChange={setConfig} disabled={isFiring} />
          <DefensePreview config={state.config} />
          <DeployButton firing={state.firing} isFiring={isFiring} disabled={state.serverOnline !== true} onDeploy={handleDeploy} />
        </>
      )}

      {state.phase === "results" && state.results && (
        <ResultsCard result={state.results} scenario={scenario} isLastRound={state.round >= ROUND_COUNT} onNext={() => dispatch({ type: "NEXT_ROUND" })} />
      )}

      {state.phase === "summary" && <FinalSummary history={state.history} score={state.score} onRestart={() => dispatch({ type: "RESTART" })} />}
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
