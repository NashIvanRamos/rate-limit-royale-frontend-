import type { AppError } from "../state";
import { Banner } from "./ui/Banner";

const TITLES: Record<AppError["kind"], string> = {
  offline: "Backend offline",
  invalid_config: "Defense rejected",
  setup: "Round setup failed",
  unknown: "Something went wrong",
};

/** Basic version (task 08). Extended in task 12. */
export function ErrorBanner({ error, onDismiss }: { error: AppError; onDismiss: () => void }) {
  return (
    <Banner tone="blocked" title={TITLES[error.kind]} onDismiss={onDismiss}>
      {error.message}
      {error.details && error.details.length > 0 && (
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
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
      Start it with <code className="num">DEMO_MODE=true npm run dev</code> on :3000.
    </Banner>
  );
}
