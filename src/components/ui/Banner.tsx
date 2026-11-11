import type { ReactNode } from "react";
import { cx, type Tone } from "./tone";

interface BannerProps {
  tone: Exclude<Tone, "neutral" | "xp">;
  title: ReactNode;
  children?: ReactNode;
  /** Right side (XP, a retry button, …). */
  aside?: ReactNode;
  onDismiss?: () => void;
}

/** Outcome (Cleared / Breached) and error banners. Errors are announced to screen readers. */
export function Banner({ tone, title, children, aside, onDismiss }: BannerProps) {
  const isAlert = tone === "blocked" || tone === "auth";
  return (
    <div className={cx("banner", `tone-${tone}`)} role={isAlert ? "alert" : "status"}>
      <div className="stack" style={{ gap: 4 }}>
        <span className="banner__title">{title}</span>
        {children && <div className="banner__body">{children}</div>}
      </div>
      <div className="row">
        {aside}
        {onDismiss && (
          <button type="button" className="btn btn--ghost" onClick={onDismiss} aria-label="Dismiss">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
