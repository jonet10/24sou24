import { describe, expect, it } from 'vitest';
import { verifyVpsRequest } from '../src/lib/vps-auth';
import { hmacSha256Hex } from '../src/lib/crypto';
import type { Env } from '../src/types';

const now = Date.parse('2026-01-02T12:00:00Z');
const secret = 'secret-partage-vps';
const body = '{"vps_id":"vps-01","streams":[]}';

async function signedRequest(timestampSeconds: number): Promise<Request> {
  const signature = await hmacSha256Hex(new TextEncoder().encode(secret), `${timestampSeconds}.${body}`);
  return new Request('https://api.example.com/api/vps/sync', {
    method: 'POST',
    headers: {
      'X-VPS-ID': 'vps-01',
      'X-VPS-Timestamp': String(timestampSeconds),
      'X-VPS-Signature': signature,
    },
    body,
  });
}

describe('verifyVpsRequest', () => {
  const env: Env = { VPS_SYNC_SECRET: secret };

  it('accepte une requête fraîche correctement signée', async () => {
    expect(await verifyVpsRequest(await signedRequest(now / 1000), body, env, now)).toBe(true);
  });

  it('rejette une signature invalide ou un corps modifié', async () => {
    const request = await signedRequest(now / 1000);
    expect(await verifyVpsRequest(request, `${body} `, env, now)).toBe(false);
  });

  it('rejette un horodatage trop ancien', async () => {
    const request = await signedRequest(now / 1000 - 600);
    expect(await verifyVpsRequest(request, body, env, now)).toBe(false);
  });

  it('rejette les en-têtes manquants', async () => {
    const request = new Request('https://api.example.com/api/vps/sync', { method: 'POST', body });
    expect(await verifyVpsRequest(request, body, env, now)).toBe(false);
  });
});
