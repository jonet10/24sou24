import { hmacSha256Hex, timingSafeEqualHex } from './crypto';
import type { Env } from '../types';

const MAX_SKEW_SECONDS = 300;

/** Vérifie le HMAC envoyé par l'agent VPS : timestamp.corps, secret partagé, tolérance ±5 min. */
export async function verifyVpsRequest(
  request: Request,
  rawBody: string,
  env: Env,
  now: number = Date.now(),
): Promise<boolean> {
  const vpsId = request.headers.get('X-VPS-ID');
  const timestampText = request.headers.get('X-VPS-Timestamp');
  const signature = request.headers.get('X-VPS-Signature');
  if (!vpsId || !timestampText || !signature) return false;

  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp)) return false;
  if (Math.abs(now - timestamp * 1000) > MAX_SKEW_SECONDS * 1000) return false;

  const expected = await hmacSha256Hex(
    new TextEncoder().encode(env.VPS_SYNC_SECRET ?? ''),
    `${timestamp}.${rawBody}`,
  );
  return timingSafeEqualHex(expected, signature.toLowerCase());
}
