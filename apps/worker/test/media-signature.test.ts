import { describe, expect, it } from 'vitest';
import { signMediaUrl, verifyMediaSignature } from '../src/lib/media-signature';

const now = Date.parse('2026-01-02T12:00:00Z');
const secret = 'cle-hmac-de-test';
const videoId = '11111111-1111-4111-8111-111111111111';

describe('URL de lecture signée', () => {
  it('produit une URL valable 5 minutes', async () => {
    const signed = await signMediaUrl(secret, 'https://api.example.com', videoId, now);
    const url = new URL(signed.url);
    expect(url.origin).toBe('https://api.example.com');
    expect(url.pathname).toBe(`/api/media/${videoId}`);
    expect(signed.expiresAt).toBe(new Date(now + 300_000).toISOString());
    expect(
      await verifyMediaSignature(secret, videoId, url.searchParams.get('exp'), url.searchParams.get('sig'), now),
    ).toBe(true);
  });

  it('rejette une signature falsifiée ou un ID différent', async () => {
    const signed = await signMediaUrl(secret, 'https://api.example.com', videoId, now);
    const url = new URL(signed.url);
    const exp = url.searchParams.get('exp');

    expect(await verifyMediaSignature(secret, videoId, exp, '0'.repeat(64), now)).toBe(false);
    expect(
      await verifyMediaSignature(secret, '22222222-2222-4222-8222-222222222222', exp, url.searchParams.get('sig'), now),
    ).toBe(false);
  });

  it('rejette une URL expirée ou trop éloignée dans le futur', async () => {
    const signed = await signMediaUrl(secret, 'https://api.example.com', videoId, now);
    const url = new URL(signed.url);
    const sig = url.searchParams.get('sig');

    expect(await verifyMediaSignature(secret, videoId, String(now - 120_000), sig, now)).toBe(false);
    expect(await verifyMediaSignature(secret, videoId, String(now + 3_600_000), sig, now)).toBe(false);
  });
});
