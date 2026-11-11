import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

interface CountUpProps {
  value: number;
  durationMs?: number;
  /** Formats the displayed (rounded) number. */
  format?: (n: number) => string;
  className?: string;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Animates from the previously shown number to `value`. With reduced motion it shows `value` at once.
 * Only ever displays real values: the start point is the last real value (0 on mount).
 */
export function CountUp({ value, durationMs = 600, format = String, className }: CountUpProps) {
  const reduceMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    if (reduceMotion) return;
    const from = shownRef.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const next = Math.round(from + (value - from) * easeOut(t));
      shownRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduceMotion]);

  return <span className={className ?? "num"}>{format(reduceMotion ? value : display)}</span>;
}
