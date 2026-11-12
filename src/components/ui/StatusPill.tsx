import { cx } from "./tone";

export type ServerStatus = "checking" | "online" | "degraded" | "offline";

const TEXT: Record<ServerStatus, string> = {
  checking: "Checking…",
  online: "Server Online",
  degraded: "Degraded",
  offline: "Offline",
};

/** Server health pill for the header. Neutral while the first health check is pending. */
export function StatusPill({ status, title }: { status: ServerStatus; title?: string }) {
  return (
    <span className={cx("pill", `pill--${status}`)} role="status" aria-live="polite" title={title}>
      <span className="pill__dot" aria-hidden="true" />
      {TEXT[status]}
    </span>
  );
}
