import { useMemo } from "react";
import { previewEvents } from "../runRound";
import { attackerKeyCount } from "../scenarios";
import type { DefenseConfig, Scenario, StatusCounts } from "../types";
import { CountUp } from "./ui/CountUp";

interface KeysPanelProps {
  scenario: Scenario;
  config: DefenseConfig;
  /** Live counts while firing, or the tally's byClient on the results screen. */
  byClient: Record<string, StatusCounts>;
  /** Server truth from GET /api/stats (results only): limiter keys held, and how many are legit clients'. */
  serverKeys?: { tracked: number; legit: number };
}

const ZERO: StatusCounts = { s200: 0, s429: 0, s401: 0 };

/**
 * Round 5's keying story: under "key by user" the limiter holds one budget per rotating account
 * (50 keys); under "key by IP" all 50 accounts share 10.6.6.6's single budget (1 key).
 */
export function KeysPanel({ scenario, config, byClient, serverKeys }: KeysPanelProps) {
  const attackers = useMemo(() => scenario.clients.filter((c) => !c.legit), [scenario]);
  // Requests each account is scripted to send, so a cell's fill is "share of its requests that passed".
  const scripted = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of previewEvents(scenario, config)) n.set(e.clientId, (n.get(e.clientId) ?? 0) + 1);
    return n;
  }, [scenario, config]);

  let passed = 0;
  let blocked = 0;
  for (const c of attackers) {
    passed += byClient[c.id]?.s200 ?? 0;
    blocked += byClient[c.id]?.s429 ?? 0;
  }
  const keys = attackerKeyCount(config);
  const sharedIp = attackers[0]?.ip ?? "";

  return (
    <div className="keys" aria-label="Rate limit keys used by the attacker">
      <div className="row spread" style={{ alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">Attacker requests through</span>
          <CountUp value={passed} durationMs={250} className="keys__counter num tone-accepted" />
        </div>
        <div className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
          <span className="keys__keycount num">
            {keys} {keys === 1 ? "key" : "keys"}
          </span>
          <span className="config__note">{keys === 1 ? "one shared budget" : "one budget per account"}</span>
        </div>
      </div>

      {config.keyBy === "user" ? (
        <div className="keys__grid">
          {attackers.map((c) => {
            const counts = byClient[c.id] ?? ZERO;
            const fill = Math.min(1, counts.s200 / Math.max(1, scripted.get(c.id) ?? 1));
            return (
              <span
                key={c.id}
                className={counts.s429 > 0 ? "key-cell key-cell--hit" : "key-cell"}
                style={{ ["--fill" as string]: fill }}
                title={`${c.auth.username}: ${counts.s200} passed, ${counts.s429} blocked`}
              />
            );
          })}
        </div>
      ) : (
        <div className={blocked > 0 ? "key-single key-single--spent" : "key-single"}>
          <span className="num key-single__ip">{sharedIp}</span>
          <span className="num">
            <span className="tone-accepted">{passed} passed</span> · <span className="tone-blocked">{blocked} blocked</span>
          </span>
          <span className="config__note">{blocked > 0 ? "Budget spent: every account behind this IP is blocked" : "Shared budget for all 50 accounts"}</span>
        </div>
      )}

      {serverKeys && (
        <p className="results__server num">
          Server limiter holds {serverKeys.tracked} keys: {Math.max(0, serverKeys.tracked - serverKeys.legit)} attacker + {serverKeys.legit} legit.
        </p>
      )}
    </div>
  );
}
