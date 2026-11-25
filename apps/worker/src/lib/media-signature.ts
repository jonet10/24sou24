import { hmacSha256Hex, timingSafeEqualHex } from './crypto';

export const MEDIA_URL_TTL_SECONDS = 300;
const MAX_SKEW_SECONDS = 60;

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function mediaPayload(videoId: string, expiresAt: number): string {
  return `${videoId}.${expiresAt}`;
}

export async function signMediaUrl(
  secret: string,
  origin: string,
  videoId: string,
  now: number = Date.now(),
  ttlSeconds: number = MEDIA_URL_TTL_SECONDS,
): Promise<{ url: string; expiresAt: string }> {
  const expiresAt = now + ttlSeconds * 1000;
  const signature = await hmacSha256Hex(secretBytes(secret), mediaPayload(videoId, expiresAt));
  const url = `${origin.replace(/\/$/, '')}/api/media/${encodeURIComponent(videoId)}?exp=${expiresAt}&sig=${signature}`;
  return { url, expiresAt: new Date(expiresAt).toISOString() };
}

export async function verifyMediaSignature(
  secret: string,
  videoId: string,
  expParam: string | null,
  sigParam: string | null,
  now: number = Date.now(),
): Promise<boolean> {
  if (!expParam || !sigParam) return false;
  const expiresAt = Number(expParam);
  if (!Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt <= now - MAX_SKEW_SECONDS * 1000) return false;
  if (expiresAt > now + MEDIA_URL_TTL_SECONDS * 1000 + MAX_SKEW_SECONDS * 1000) return false;

  const expected = await hmacSha256Hex(secretBytes(secret), mediaPayload(videoId, expiresAt));
  return timingSafeEqualHex(expected, sigParam.toLowerCase());
}
