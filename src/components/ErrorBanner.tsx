import type { AppError } from "../state";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";

const TITLES: Record<AppError["kind"], string> = {
  offline: "Backend offline",
  degraded: "Backend degraded",
  invalid_config: "Defense rejected by the server",
  setup: "Round setup failed",
  unknown: "Something went wrong",
};

interface ErrorBannerProps {
  error: AppError;
  onDismiss: () => void;
  /** Offered for setup failures: redeploying resets login lockouts. */
  onRetry?: () => void;
  retryDisabled?: boolean;
}

export function ErrorBanner({ error, onDismiss, onRetry, retryDisabled }: ErrorBannerProps) {
  return (
    <Banner
      tone="blocked"
      title={TITLES[error.kind]}
      onDismiss={onDismiss}
      aside={
        onRetry && (
          <Button onClick={onRetry} disabled={retryDisabled}>
            Retry
          </Button>
        )
      }
    >
      {error.message}
      {error.details && error.details.length > 0 && (
        <ul className="error-details">
          {error.details.map((d) => (
            <li key={`${d.field}:${d.message}`}>
              <span className="num">{d.field}</span>: {d.message}
            </li>
          ))}
        </ul>
      )}
    </Banner>
  );
}

/** Shown while the health check says the backend is down. */
export function OfflineBanner() {
  return (
    <Banner tone="blocked" title="Backend offline">
      Start it with <code className="num">DEMO_MODE=true npm run dev</code> on :3000. Deploy is disabled until it's back.
    </Banner>
  );
}

/** Shown while health reports "degraded": the backend's Redis store is unreachable. */
export function DegradedBanner({ failureMode }: { failureMode?: "open" | "closed" }) {
  return (
    <Banner tone="auth" title="Backend degraded: Redis is down">
      {failureMode === "closed" ? "API requests are refused (fail closed)" : "API requests are served without rate limiting (fail open)"}, and logins and
      deploys are refused. Deploy is disabled until Redis is back.
    </Banner>
  );
}

/** Background tabs throttle timers, which skews a round's timing. */
export function TabHiddenBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Banner tone="auth" title="Keep this tab in the foreground" onDismiss={onDismiss}>
      Background tabs throttle timers, so requests fired while this tab was hidden may have been delayed.
    </Banner>
  );
}
