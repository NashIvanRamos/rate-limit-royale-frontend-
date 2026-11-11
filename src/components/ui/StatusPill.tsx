import { cx } from "./tone";

export type ServerStatus = "checking" | "online" | "offline";

const TEXT: Record<ServerStatus, string> = {
  checking: "Checking…",
  online: "Server Online",
  offline: "Offline",
};

/** Server health pill for the header. Neutral while the first health check is pending. */
export function StatusPill({ status }: { status: ServerStatus }) {
  return (
    <span className={cx("pill", `pill--${status}`)} role="status" aria-live="polite">
      <span className="pill__dot" aria-hidden="true" />
      {TEXT[status]}
    </span>
  );
}
