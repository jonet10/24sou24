import type { Env } from '../types';

interface Counter {
  count: number;
  resetAt: number;
}

/** Repli local pour `wrangler dev` sans KV. En production, utiliser RATE_LIMIT_KV. */
const memoryStore = new Map<string, Counter>();

export function resetRateLimitStore(): void {
  memoryStore.clear();
}

export async function isRateLimited(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<boolean> {
  const windowMs = windowSeconds * 1000;
  const bucket = Math.floor(now / windowMs);
  const storageKey = `rl:${key}:${bucket}`;

  if (env.RATE_LIMIT_KV) {
    const current = Number((await env.RATE_LIMIT_KV.get(storageKey)) ?? '0');
    const next = (Number.isFinite(current) ? current : 0) + 1;
    await env.RATE_LIMIT_KV.put(storageKey, String(next), { expirationTtl: windowSeconds + 60 });
    return next > limit;
  }

  const existing = memoryStore.get(storageKey);
  if (!existing || existing.resetAt <= now) {
    memoryStore.set(storageKey, { count: 1, resetAt: (bucket + 1) * windowMs });
    return false;
  }
  existing.count += 1;
  return existing.count > limit;
}
