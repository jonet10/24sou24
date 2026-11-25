import { beforeEach, describe, expect, it } from 'vitest';
import { isRateLimited, resetRateLimitStore } from '../src/lib/rate-limit';
import type { Env } from '../src/types';

const now = Date.parse('2026-01-02T12:00:00Z');

describe('isRateLimited', () => {
  beforeEach(() => resetRateLimitStore());

  it('autorise les requêtes sous la limite puis bloque au-delà', async () => {
    const env: Env = {};
    expect(await isRateLimited(env, 'ip:1.2.3.4', 2, 60, now)).toBe(false);
    expect(await isRateLimited(env, 'ip:1.2.3.4', 2, 60, now + 1000)).toBe(false);
    expect(await isRateLimited(env, 'ip:1.2.3.4', 2, 60, now + 2000)).toBe(true);
  });

  it('résète le compteur à la fenêtre suivante', async () => {
    const env: Env = {};
    expect(await isRateLimited(env, 'ip:5.6.7.8', 1, 60, now)).toBe(false);
    expect(await isRateLimited(env, 'ip:5.6.7.8', 1, 60, now + 61_000)).toBe(false);
  });

  it('utilise le KV quand il est disponible', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const env = { RATE_LIMIT_KV: kv } as unknown as Env;
    expect(await isRateLimited(env, 'user:abc', 1, 60, now)).toBe(false);
    expect(await isRateLimited(env, 'user:abc', 1, 60, now + 1000)).toBe(true);
    expect([...store.keys()]).toHaveLength(1);
    expect([...store.values()]).toEqual(['2']);
  });
});
