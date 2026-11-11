import { useEffect, useState } from "react";
import type { FiringState } from "../state";
import { Button } from "./ui/Button";
import { ProgressBar } from "./ui/ProgressBar";

interface DeployButtonProps {
  firing: FiringState;
  isFiring: boolean;
  disabled?: boolean;
  onDeploy: () => void;
}

/** Re-renders every second while `active`, for the boundary countdown. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function stageLabel(f: FiringState, now: number): string {
  switch (f.stage) {
    case null:
    case "deploying":
      return "Deploying…";
    case "logging-in":
      return `Logging in ${f.setupTotal} accounts… ${f.setupDone}/${f.setupTotal}`;
    case "waiting-boundary":
      return `Waiting for window boundary… ${Math.max(0, Math.ceil(((f.firesAt ?? now) - now) / 1000))}s`;
    case "firing":
      return `Firing ${f.done}/${f.total}`;
    case "draining":
      return `Draining… ${f.done}/${f.total}`;
  }
}

function stageProgress(f: FiringState): number {
  if (f.stage === "logging-in") return f.setupTotal ? f.setupDone / f.setupTotal : 0;
  if (f.stage === "firing" || f.stage === "draining" || f.stage === "waiting-boundary") return f.total ? f.done / f.total : 0;
  return 0;
}

/** Basic version (task 08). Styled in task 10. */
export function DeployButton({ firing, isFiring, disabled, onDeploy }: DeployButtonProps) {
  const now = useNow(isFiring && firing.stage === "waiting-boundary");
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Button variant="primary" fullWidth loading={isFiring} disabled={disabled} onClick={onDeploy}>
        {isFiring ? stageLabel(firing, now) : "Deploy Defense & Launch Attack"}
      </Button>
      {isFiring && (
        <>
          <ProgressBar value={stageProgress(firing)} tone="accepted" label="Round progress" />
          <p className="num muted" style={{ margin: 0, textAlign: "center" }}>
            <span className="tone-accepted">{firing.counts.s200} × 200</span> · <span className="tone-blocked">{firing.counts.s429} × 429</span> ·{" "}
            <span className="tone-auth">{firing.counts.s401} × 401</span>
          </p>
        </>
      )}
    </div>
  );
}
