import type { RoundResult, Scenario } from "../types";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { DistributionBar } from "./ui/DistributionBar";
import { MetricRow } from "./ui/MetricRow";

interface ResultsCardProps {
  result: RoundResult;
  scenario: Scenario;
  isLastRound: boolean;
  onNext: () => void;
}

/** Basic version (task 08). Every number comes from tally() of a real run. Styled in task 11. */
export function ResultsCard({ result, scenario, isLastRound, onNext }: ResultsCardProps) {
  const t = result.tally;
  return (
    <Card label="Battle results">
      <div className="metric-list">
        <MetricRow label="Accepted (200)" tone="accepted" value={t.accepted} />
        <MetricRow label="Blocked (429)" tone="blocked" value={t.blocked} />
        <MetricRow label="Rejected auth (401)" tone="auth" value={t.rejectedAuth} />
        {t.errors > 0 && <MetricRow label="Errors (network)" value={t.errors} />}
        <MetricRow label="Avg latency" value={`${Math.round(t.avgLatencyMs)}ms`} />
        <MetricRow
          label="Legitimate blocks"
          tone={t.legitBlocks > 0 ? "blocked" : "accepted"}
          value={t.legitBlocks}
          note={t.legitExpired > 0 ? `expired-token legit: ${t.legitExpired} (not penalised)` : undefined}
        />
      </div>
      <p className="num muted" style={{ margin: 0 }}>
        Attack: {t.attackTotal} sent · {t.attackStopped} stopped · {t.attackPassed} passed (allowance {result.allowance})
      </p>
      <DistributionBar
        label="HTTP response distribution"
        segments={[
          { label: "Accepted", value: t.accepted, tone: "accepted" },
          { label: "Blocked", value: t.blocked, tone: "blocked" },
          { label: "Auth rejected", value: t.rejectedAuth, tone: "auth" },
        ]}
      />
      <Banner
        tone={result.cleared ? "accepted" : "blocked"}
        title={result.cleared ? "Round cleared" : "Breached"}
        aside={<span className="num tone-xp">+{result.xp} XP</span>}
      >
        {scenario.lesson}
      </Banner>
      <Button variant="primary" fullWidth onClick={onNext}>
        {isLastRound ? "See summary" : "Next round"}
      </Button>
    </Card>
  );
}
