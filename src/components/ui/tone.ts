/**
 * Status tones. Colour signals status only (brief §8):
 * accepted = 200, blocked = 429, auth = 401, xp = score, preview = what will be deployed.
 */
export type Tone = "accepted" | "blocked" | "auth" | "xp" | "preview" | "neutral";

/** Joins class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
