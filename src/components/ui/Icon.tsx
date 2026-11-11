// Small stroke icons drawn inline (no icon dependency). Decorative: always aria-hidden.

const PATHS = {
  shield: "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z M9 12l2 2 4-4",
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3 2",
  window: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3 9h18 M8 14l3-3 3 3 3-3",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7l1-8z",
  swords: "M5 3l11 11 M19 3L8 14 M4 20l4-4 M20 20l-4-4 M6 15l3 3 M18 15l-3 3",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0V4z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M9 20h6 M10 17h4v3h-4z",
  alert: "M12 3l9.5 17h-19L12 3z M12 10v4 M12 17v.5",
  key: "M15 3a6 6 0 1 0 0 12a6 6 0 1 0 0-12z M10.5 13.5L3 21 M6 18l2 2 M8.5 15.5l2 2",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
