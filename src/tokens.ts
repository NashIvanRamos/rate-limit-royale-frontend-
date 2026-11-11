// Attack tokens built in the browser for round 4 (brief §4). None of these can pass: the server only
// accepts HS256 signed with its secret. The expired token is different: it comes from
// POST /api/demo/expired-token, because the browser never sees the secret.

const encoder = new TextEncoder();

/** Base64url without padding, over raw bytes. */
function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8-safe JSON → base64url (plain btoa throws on non-Latin-1 characters). */
function jsonToB64url(value: unknown): string {
  return bytesToB64url(encoder.encode(JSON.stringify(value)));
}

const nowS = () => Math.floor(Date.now() / 1000);

/** Valid-looking claims, so the only thing wrong with the token is its signature. */
function claims(sub: string) {
  const iat = nowS();
  return { sub, iat, exp: iat + 900 };
}

/** HS256 header and plausible claims, but a random 32-byte signature. Server → 401 `invalid_signature`. */
export function forgedToken(sub: string): string {
  const signature = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  return `${jsonToB64url({ alg: "HS256", typ: "JWT" })}.${jsonToB64url(claims(sub))}.${signature}`;
}

/** `alg: none` with an empty signature. Server → 401 `invalid_signature`. */
export function algNoneToken(sub: string): string {
  return `${jsonToB64url({ alg: "none", typ: "JWT" })}.${jsonToB64url(claims(sub))}.`;
}

/** Not a JWT at all. Server → 401 `malformed`. */
export function garbageToken(): string {
  return "abc.def.ghi";
}
