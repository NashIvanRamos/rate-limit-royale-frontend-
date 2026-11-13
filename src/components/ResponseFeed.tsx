import type { FeedItem } from "../scheduler";
import type { ClientSpec } from "../types";

/** What each status means to the player. Colour still comes from the status (green 200, red 429, amber 401). */
const STATUS_TEXT: Record<number, string> = {
  0: "Network error",
  200: "OK",
  400: "Bad Request",
  401: "Unauthorized",
  429: "Too Many Requests",
  500: "Server Error",
  503: "Service Unavailable",
};

const tone = (status: number) => (status === 200 ? "accepted" : status === 429 ? "blocked" : status === 401 ? "auth" : "neutral");

/** "alice", or the attacker's account name ("user07") for rotating pool clients. */
function who(client: ClientSpec | undefined, clientId: string): string {
  if (!client) return clientId;
  return client.legit ? client.id : (client.auth.username ?? client.label ?? client.id);
}

/** "node-2:3002" when the backend sends X-Node-Port, "node-2" otherwise; nothing on a single node. */
function where(item: FeedItem): string | null {
  if (!item.nodeId || item.nodeId === "single") return item.nodePort ? `:${item.nodePort}` : null;
  return item.nodePort ? `${item.nodeId}:${item.nodePort}` : item.nodeId;
}

interface ResponseFeedProps {
  recent: FeedItem[];
  clients: ClientSpec[];
}

/** The latest responses as they arrive, newest on top. Real responses only (from the scheduler's progress). */
export function ResponseFeed({ recent, clients }: ResponseFeedProps) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  return (
    <div className="feed" aria-label="Latest responses" aria-live="off">
      <span className="label">Live responses</span>
      {recent.length === 0 ? (
        <span className="config__note">Waiting for the first response…</span>
      ) : (
        <ol className="feed__list">
          {recent.map((item) => {
            const client = byId.get(item.clientId);
            const place = where(item);
            const detail = item.status === 401 && item.reason && item.reason !== "unauthorized" ? ` (${item.reason})` : "";
            return (
              <li key={item.seq} className={`feed__item feed__item--${tone(item.status)}`}>
                <span className="feed__code num">{item.status || "ERR"}</span>
                <span className="feed__text">
                  {STATUS_TEXT[item.status] ?? "Error"}
                  {detail}
                </span>
                <span className={client?.legit ? "feed__who" : "feed__who feed__who--attack"}>{who(client, item.clientId)}</span>
                {place && <span className="feed__where num">{place}</span>}
              </li>
            );
          })}
        </ol>
      )}
      <div className="feed__legend" aria-hidden="true">
        <span className="tone-accepted">200 OK: served</span>
        <span className="tone-blocked">429 Too Many Requests: rate limited</span>
        <span className="tone-auth">401 Unauthorized: bad or expired token</span>
      </div>
    </div>
  );
}
