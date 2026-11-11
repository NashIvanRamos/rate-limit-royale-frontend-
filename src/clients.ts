// Stable identity plan for every round (brief §2). Legit and attacker identities never overlap:
// attackers only ever use pool accounts, never alice, bob or carol.

export const LEGIT_USERS = ["alice", "bob", "carol"] as const;
export type LegitUser = (typeof LEGIT_USERS)[number];

export const LEGIT_IPS: Readonly<Record<LegitUser, string>> = Object.freeze({
  alice: "10.0.0.1",
  bob: "10.0.0.2",
  carol: "10.0.0.3",
});

export const ATTACKER_IPS = Object.freeze({
  /** Main attacker: floods (rounds 1–3), credential stuffing (round 4), account rotation (round 5). */
  main: "10.6.6.6",
  /** Round 4: forged-signature tokens. */
  forged: "10.6.6.7",
  /** Round 4: `alg: none` tokens. */
  algNone: "10.6.6.8",
  /** Round 4 (optional): garbage tokens. */
  garbage: "10.6.6.9",
});

/** Attacker account pool size on the backend: user01 … user50. */
export const POOL_SIZE = 50;

/** poolUser(7) → "user07". Valid for 1…POOL_SIZE. */
export function poolUser(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > POOL_SIZE) {
    throw new RangeError(`poolUser: n must be an integer from 1 to ${POOL_SIZE}, got ${n}`);
  }
  return "user" + String(n).padStart(2, "0");
}
