/**
 * HS256 JWT, no external lib. Uses Web Crypto (available in Cloudflare Workers).
 *
 * Tokens are short-lived (default 30 days). The signing secret is provided
 * per environment via `wrangler secret put JWT_SECRET` (see wrangler.toml).
 */

const TE = new TextEncoder();
const TD = new TextDecoder();

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    TE.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  return crypto.subtle.sign("HMAC", key, TE.encode(data));
}

export interface JwtPayload {
  sub: string;
  email: string;
  exp?: number;
  iat?: number;
}

export async function signJwt(payload: Omit<JwtPayload, "exp" | "iat">, secret: string, ttlSeconds = 60 * 60 * 24 * 30): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };
  const header = b64urlEncode(TE.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64urlEncode(TE.encode(JSON.stringify(fullPayload)));
  const signingInput = `${header}.${body}`;
  const sig = b64urlEncode(await hmacSign(secret, signingInput));
  return `${signingInput}.${sig}`;
}

export async function verifyJwt<T extends JwtPayload = JwtPayload>(token: string, secret: string): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = b64urlEncode(await hmacSign(secret, `${head}.${body}`));
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(TD.decode(b64urlDecode(body))) as JwtPayload;
    if (typeof payload.exp === "number" && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload as T;
  } catch {
    return null;
  }
}
