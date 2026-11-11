import type { ReactNode } from "react";
import { cx, type Tone } from "./tone";

interface CardProps {
  children: ReactNode;
  /** Small uppercase label in the card header. */
  label?: ReactNode;
  /** Right side of the header (a tag, a value, …). */
  aside?: ReactNode;
  /** Coloured left border. Use only when the card itself represents a status. */
  accent?: Exclude<Tone, "neutral">;
  className?: string;
  as?: "section" | "div" | "article";
}

export function Card({ children, label, aside, accent, className, as: Tag = "section" }: CardProps) {
  return (
    <Tag className={cx("card", accent && `card--accent-${accent}`, className)}>
      {(label || aside) && (
        <header className="card__header">
          {label ? <span className="label">{label}</span> : <span />}
          {aside}
        </header>
      )}
      {children}
    </Tag>
  );
}
