import type { RoundResult } from "../types";

/**
 * Round 5 on a cluster: how the attacker's requests were spread over the nodes and what each node let through,
 * from this run only. The explanation follows what the numbers show: one budget per node (memory, spread),
 * one shared budget (Redis), or one node holding all of the attacker's traffic (sticky routing).
 */
export function ScalingPanel({ result }: { result: RoundResult }) {
  const { cluster, tally: t } = result;
  if (!cluster) return null;

  const nodes = Object.keys(t.attackByNode).sort((a, b) => a.localeCompare(b));
  const busyNodes = nodes.filter((n) => (t.attackByNode[n] ?? 0) > 0);
  const explanation =
    cluster.store === "redis"
      ? "Counters live in Redis: one budget for the whole cluster, however the requests are spread."
      : busyNodes.length > 1
        ? `Each node keeps its own counter, so the attacker gets one budget per node: ${busyNodes.length} budgets for one IP.`
        : "Sticky routing keeps this attacker on one node, so it looks fixed. It isn't: if that node dies, the next node starts a fresh budget.";

  return (
    <div className="scaling" aria-label="How the cluster handled the attack">
      <div className="row spread">
        <span className="label">Cluster · {cluster.store}</span>
        <span className="num config__note">{busyNodes.length === 1 ? "attacker pinned to one node" : `attacker spread over ${busyNodes.length} nodes`}</span>
      </div>
      <dl className="kv">
        {nodes.map((n) => (
          <div key={n} className="kv__row">
            <dt className="num">{n}</dt>
            <dd className="num">
              {t.attackByNode[n]} sent · <span className="tone-accepted">{t.attackPassedByNode[n] ?? 0} passed</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="outcome__text">{explanation}</p>
    </div>
  );
}
