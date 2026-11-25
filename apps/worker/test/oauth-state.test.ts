import { describe, expect, it } from 'vitest';
import { buildAuthorizationUrl } from '../src/routes/youtube';
import {
  clearOAuthCookie,
  createOAuthState,
  parseCookies,
  verifyOAuthState,
} from '../src/lib/oauth-state';

const now = Date.parse('2026-01-02T12:00:00Z');
const secret = 'cle-de-session-oauth';

describe('état OAuth', () => {
  it('crée un cookie signé et vérifiable', async () => {
    const { value, cookie } = await createOAuthState(secret, 'user-123', now, false);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    expect((await verifyOAuthState(secret, value, now + 1000))?.userId).toBe('user-123');
  });

  it('rejette un état falsifié ou expiré', async () => {
    const { value } = await createOAuthState(secret, 'user-123', now, true);
    const tampered = `${value.slice(0, -1)}${value.endsWith('a') ? 'b' : 'a'}`;

    expect(await verifyOAuthState(secret, tampered, now + 1000)).toBeNull();
    expect(await verifyOAuthState(secret, value, now + 700_000)).toBeNull();
    expect(await verifyOAuthState('autre-cle', value, now + 1000)).toBeNull();
  });

  it('analyse et efface le cookie', () => {
    const { value } = { value: 'a=b' };
    expect(parseCookies(`foo=1; ${value}; bar=2`)).toEqual({ foo: '1', a: 'b', bar: '2' });
    expect(clearOAuthCookie(false)).not.toContain('Secure');
    expect(clearOAuthCookie(true)).toContain('Secure');
  });
});

describe('buildAuthorizationUrl', () => {
  it('construit une URL Google avec state et accès hors ligne', () => {
    const url = new URL(
      buildAuthorizationUrl('client.apps.googleusercontent.com', 'https://api.example.com/callback', 'etat-123'),
    );
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/callback');
    expect(url.searchParams.get('state')).toBe('etat-123');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/youtube');
  });
});
