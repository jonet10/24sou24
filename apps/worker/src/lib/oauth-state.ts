import { hmacSha256Hex, timingSafeEqualHex } from './crypto';

export const OAUTH_COOKIE = 'stream24_oauth_state';
export const OAUTH_STATE_TTL_SECONDS = 600;

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface OAuthStateValue {
  value: string;
  cookie: string;
}

export async function createOAuthState(
  secret: string,
  userId: string,
  now: number = Date.now(),
  secure = true,
): Promise<OAuthStateValue> {
  const expiresAt = now + OAUTH_STATE_TTL_SECONDS * 1000;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const payload = `${userId}.${expiresAt}.${nonce}`;
  const signature = await hmacSha256Hex(secretBytes(secret), payload);
  const value = `${payload}.${signature}`;
  const cookie = [
    `${OAUTH_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${OAUTH_STATE_TTL_SECONDS}`,
  ].join('; ');
  return {
    value,
    cookie: secure ? cookie : cookie.replace('; Secure', ''),
  };
}

export async function verifyOAuthState(
  secret: string,
  value: string | undefined | null,
  now: number = Date.now(),
): Promise<{ userId: string } | null> {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [userId, expiresAtText, nonce, signature] = parts;
  if (!userId || !nonce || !/^[0-9]+$/.test(expiresAtText)) return null;

  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + OAUTH_STATE_TTL_SECONDS * 1000 + 60_000) {
    return null;
  }

  const payload = `${userId}.${expiresAtText}.${nonce}`;
  const expected = await hmacSha256Hex(secretBytes(secret), payload);
  if (!timingSafeEqualHex(expected, signature.toLowerCase())) return null;
  return { userId };
}

export function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

export function clearOAuthCookie(secure = true): string {
  const parts = [`${OAUTH_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) parts.splice(2, 0, 'Secure');
  return parts.join('; ');
}
