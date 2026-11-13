import { useEffect, useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { SCORING } from "../scoring";
import type { CrossCheck, RoundResult, Scenario, StatusCounts, Tally } from "../types";
import { BoundaryTimeline } from "./BoundaryTimeline";
import { KeysPanel } from "./KeysPanel";
import { ResponseFeed } from "./ResponseFeed";
import { ScalingPanel } from "./ScalingPanel";
import { CountUp } from "./ui/CountUp";
import { Button } from "./ui/Button";
import { DistributionBar } from "./ui/DistributionBar";
import { Icon } from "./ui/Icon";

interface ResultsCardProps {
  result: RoundResult;
  scenario: Scenario;
  isLastRound: boolean;
  onNext: () => void;
  /** Replay this round with a different defense. Replaces this attempt's XP. */
  onRetry: () => void;
  /** Demo mode: names the next preset, e.g. "Retry with Sliding Window". */
  retryText?: string;
}

type TileTone = "accepted" | "blocked" | "auth" | "neutral";

function ResultTile({ label, value, tone = "neutral", note }: { label: string; value: ReactNode; tone?: TileTone; note?: ReactNode }) {
  return (
    <div className="result-tile">
      <span className="label">{label}</span>
      <span className={`result-tile__value num tone-${tone}`}>{value}</span>
      {note && <span className="result-tile__note">{note}</span>}
    </div>
  );
}

/**
 * Splits the all-traffic counters into the attacker and the real users, so every number on the card adds up:
 * SUCCESSFUL (200) = attacker through + real users served.
 */
function WhoGotThrough({ result }: { result: RoundResult }) {
  const t = result.tally;
  const legitSent = t.total - t.attackTotal;
  const legitServed = t.accepted - t.attackPassed;
  const check = result.crossCheck;
  const confirmed = check && check.resource.match && (!check.login || check.login.match);
  return (
    <div className="who" aria-label="Who got through">
      <span className="label">Who got through</span>
      <div className="who__row">
        <span className="who__name">Attacker</span>
        <span className="who__value num">
          {t.attackTotal} sent → <span className="tone-accepted">{t.attackPassed} through ({pct(t.attackPassed, t.attackTotal)}%)</span> ·{" "}
          <span className="tone-blocked">{t.attackStopped} stopped</span>
        </span>
        <span className="who__aside num">allowance {result.allowance}</span>
      </div>
      <div className="who__row">
        <span className="who__name">Real users</span>
        <span className="who__value num">
          {legitSent} sent → <span className="tone-accepted">{legitServed} served</span> ·{" "}
          <span className={t.legitBlocks > 0 ? "tone-blocked" : undefined}>{t.legitBlocks} blocked</span>
          {t.legitExpired > 0 && <span className="tone-auth"> · {t.legitExpired} expired (not counted as blocks)</span>}
        </span>
      </div>
      <div className="who__row who__row--total">
        <span className="who__name">All traffic</span>
        <span className="who__value num">
          {t.accepted} OK (200) · {t.blocked} blocked (429) · {t.rejectedAuth} auth failed (401)
        </span>
        {check && <span className={`who__aside ${confirmed ? "tone-accepted" : "tone-auth"}`}>{confirmed ? "✓ server confirms" : "server differs"}</span>}
      </div>
    </div>
  );
}

const triple = (c: StatusCounts) => `${c.s200} / ${c.s429} / ${c.s401}`;

/** "Server confirms: 182 / 18 / 0 ✓" (200 / 429 / 401), or an amber mismatch with the server's numbers. */
function ServerCheck({ check }: { check: CrossCheck }) {
  const parts = [{ label: "", ...check.resource }, ...(check.login ? [{ label: "login ", ...check.login }] : [])];
  const allMatch = parts.every((p) => p.match);
  const who = check.nodes > 1 ? `Server (sum of ${check.nodes} nodes)` : "Server";
  return (
    <p className={`results__server num ${allMatch ? "" : "tone-auth"}`}>
      {allMatch ? `${who} confirms: ` : `${who}: `}
      {parts.map((p, i) => (
        <span key={p.label}>
          {i > 0 && " · "}
          {p.label}
          {triple(p.server)} {p.match ? "✓" : `(mismatch, browser saw ${triple(p.client)})`}
        </span>
      ))}
    </p>
  );
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** Why requests were stopped, from the tally's per-reason and per-endpoint counts. */
function stopReasons(t: Tally): Array<[string, number]> {
  const rows: Array<[string, number]> = [
    ["Wrong password (login 401)", t.byReason.invalid_credentials ?? 0],
    ["Login locked out (login 429)", t.byPath["/api/login"].s429],
    ["Forged or alg:none token (401)", t.byReason.invalid_signature ?? 0],
    ["Malformed token (401)", t.byReason.malformed ?? 0],
    ["Missing token (401)", t.byReason.missing_token ?? 0],
    ["Expired token (401)", t.byReason.expired ?? 0],
    ["Rate limited on the API (429)", t.byPath["/api/resource"].s429],
  ];
  return rows.filter(([, n]) => n > 0);
}

/** One line on why the round was cleared or breached, from the measured numbers. */
function verdict(r: RoundResult): string {
  const t = r.tally;
  const leaked = r.containment < SCORING.clearContainment;
  const blocks = t.legitBlocks === 1 ? "1 legitimate request was" : `${t.legitBlocks} legitimate requests were`;
  if (r.cleared) return "Your API held the attack to its allowance without blocking legitimate traffic.";
  if (leaked && t.legitBlocks > 0) return `The attacker got ${t.attackPassed} requests through (allowance ${r.allowance}), and ${blocks} blocked.`;
  if (leaked) return `The attacker got ${t.attackPassed} requests through, against an allowance of ${r.allowance}.`;
  return `${blocks} blocked. Each one costs ${Math.round(SCORING.legitPenaltyPerBlock * 100)}% of the round's XP.`;
}

/** Every number here comes from tally() and score() of a real run. */
export function ResultsCard({ result, scenario, isLastRound, onNext, onRetry, retryText }: ResultsCardProps) {
  const t = result.tally;
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [reduceMotion]);

  const answered = t.accepted + t.blocked + t.rejectedAuth;
  const reasons = stopReasons(t);
  const show401 = t.rejectedAuth > 0;

  return (
    <section ref={ref} className="stack results" style={{ gap: 20 }} aria-labelledby="results-title">
      <h2 id="results-title" className="section__title">
        Battle results
      </h2>

      <p className="results__scope">All traffic (attacker + real users)</p>
      <div className={show401 ? "result-grid result-grid--3" : "result-grid"}>
        <ResultTile label="Successful (200)" tone="accepted" value={<CountUp value={t.accepted} className="" />} />
        <ResultTile label="Blocked (429)" tone="blocked" value={<CountUp value={t.blocked} className="" />} />
        {show401 && <ResultTile label="Rejected auth (401)" tone="auth" value={<CountUp value={t.rejectedAuth} className="" />} />}
        <ResultTile label="Avg latency" value={<CountUp value={Math.round(t.avgLatencyMs)} format={(n) => `${n}ms`} className="" />} />
        <ResultTile
          label="Legitimate blocks"
          tone={t.legitBlocks > 0 ? "blocked" : "accepted"}
          value={<CountUp value={t.legitBlocks} className="" />}
          note={t.legitExpired > 0 ? `Expired-token legit: ${t.legitExpired} (not penalised)` : undefined}
        />
        {t.errors > 0 && <ResultTile label="Errors (network / 5xx)" value={t.errors} />}
      </div>

      <div className="stack" style={{ gap: 2 }}>
        <WhoGotThrough result={result} />
        {result.crossCheck && <ServerCheck check={result.crossCheck} />}
        {result.crossCheckNote && <p className="results__server">{result.crossCheckNote}</p>}
        {Object.keys(t.byNode).length > 1 && (
          <p className="results__server num">
            Served by:{" "}
            {Object.entries(t.byNode)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([node, n]) => `${node}${t.nodePorts[node] ? ` (:${t.nodePorts[node]})` : ""} ${n}`)
              .join(" · ")}
          </p>
        )}
        {t.degraded > 0 && (
          <p className="results__server tone-auth">
            {t.degraded} {t.degraded === 1 ? "request was" : "requests were"} served without rate limiting (Redis down, fail open).
          </p>
        )}
      </div>

      {result.feed && result.feed.length > 0 && <ResponseFeed recent={result.feed} clients={scenario.clients} live={false} />}

      <div className="stack" style={{ gap: 10 }}>
        <h3 className="results__subtitle">
          HTTP response distribution <span className="results__scope">· all traffic (attacker + real users)</span>
        </h3>
        <DistributionBar
          hideLegend
          label="HTTP response distribution"
          segments={[
            { label: "Accepted", value: t.accepted, tone: "accepted" },
            { label: "Blocked", value: t.blocked, tone: "blocked" },
            { label: "Auth rejected", value: t.rejectedAuth, tone: "auth" },
          ]}
        />
        <div className="row spread dist-ends">
          {/* Same order as the bar: accepted, blocked, auth rejected. */}
          <span className="tone-accepted">All traffic: {pct(t.accepted, answered)}% accepted</span>
          <span className="tone-blocked">
            {pct(t.blocked, answered)}% {show401 ? "blocked" : "rejected"}
          </span>
          {show401 && <span className="tone-auth">{pct(t.rejectedAuth, answered)}% auth rejected</span>}
        </div>
      </div>

      {result.timeline && (
        <div className="stack" style={{ gap: 10 }}>
          <h3 className="results__subtitle">Attack around the window boundary</h3>
          <BoundaryTimeline timeline={result.timeline} />
        </div>
      )}

      {scenario.id === 5 && (
        <div className="stack" style={{ gap: 10 }}>
          <h3 className="results__subtitle">Rate limit keys</h3>
          <KeysPanel
            scenario={scenario}
            config={result.config}
            byClient={t.byClient}
            serverKeys={
              result.crossCheck && {
                tracked: result.crossCheck.trackedKeys,
                legit: result.crossCheck.legitKeys,
                nodes: result.crossCheck.nodes,
                node: result.crossCheck.keysNode,
              }
            }
            budgetNodes={result.cluster?.store === "memory" ? Object.values(t.attackByNode).filter((n) => n > 0).length || 1 : 1}
          />
        </div>
      )}

      {scenario.id === 5 && result.cluster && (
        <div className="stack" style={{ gap: 10 }}>
          <h3 className="results__subtitle">Scaling</h3>
          <ScalingPanel result={result} />
        </div>
      )}

      {reasons.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3 className="results__subtitle">Why requests were stopped</h3>
          <dl className="kv">
            {reasons.map(([label, n]) => (
              <div key={label} className="kv__row">
                <dt>{label}</dt>
                <dd className="num">{n}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className={`outcome ${result.cleared ? "outcome--cleared" : "outcome--breached"}`} role="status">
        <div className="row">
          <Icon name={result.cleared ? "trophy" : "alert"} size={18} className={result.cleared ? "tone-xp" : "tone-blocked"} />
          <span className="outcome__title">{result.cleared ? "Round cleared" : "Breached"}</span>
        </div>
        <p className="outcome__text">{verdict(result)}</p>
        <p className="outcome__lesson">Lesson: {scenario.lesson}</p>
        <span className="outcome__xp num">
          +<CountUp value={result.xp} className="" /> XP
        </span>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <Button variant="primary" fullWidth onClick={onNext}>
          {isLastRound ? "See final summary" : "Next round"}
        </Button>
        <Button variant="ghost" fullWidth onClick={onRetry}>
          {retryText ?? "Retry this round with a different defense"}
        </Button>
      </div>
    </section>
  );
}
