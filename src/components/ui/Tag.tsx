import type { ReactNode } from "react";
import { cx, type Tone } from "./tone";

interface TagProps {
  children: ReactNode;
  tone?: Tone;
}

/** Uppercase status tag, for example the red "Incoming Attack". */
export function Tag({ children, tone = "neutral" }: TagProps) {
  return <span className={cx("tag", `tone-${tone}`)}>{children}</span>;
}
