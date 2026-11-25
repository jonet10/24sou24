import { describe, expect, it } from 'vitest';
import { inspectConfig, isConfigured } from '../src/lib/config';
import type { Env } from '../src/types';

describe('isConfigured', () => {
  it('rejette les valeurs vides ou fictives', () => {
    expect(isConfigured(undefined)).toBe(false);
    expect(isConfigured('')).toBe(false);
    expect(isConfigured('votre-cle')).toBe(false);
    expect(isConfigured('https://example.com')).toBe(false);
  });

  it('accepte une valeur réelle', () => {
    expect(isConfigured('sk_live_123456')).toBe(true);
  });
});

describe('inspectConfig', () => {
  it('signale toutes les configurations manquantes sans secrets', () => {
    const report = inspectConfig({});
    expect(report.config.supabase).toBe(false);
    expect(report.config.r2).toBe(false);
    expect(report.config.vps).toBe(false);
    expect(report.config.youtubeOAuth).toBe(false);
    expect(report.missing).toHaveLength(5);
  });

  it('détecte un R2 bucket sans credentials comme incomplet', () => {
    const env = { VIDEOS_BUCKET: {} } as unknown as Env;
    expect(inspectConfig(env).config.r2).toBe(false);
  });

  it('accepte une clé publishable à la place de la clé anon', () => {
    const base = {
      SUPABASE_URL: 'https://mon-projet.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    };
    expect(inspectConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' }).config.supabase).toBe(true);
    expect(inspectConfig({ ...base, SUPABASE_ANON_KEY: 'anon' }).config.supabase).toBe(true);
  });

  it('exige les deux clés de chiffrement et de signature média', () => {
    expect(inspectConfig({ SECRETS_ENCRYPTION_KEY: 'cle-aes' }).config.encryption).toBe(false);
    expect(
      inspectConfig({ SECRETS_ENCRYPTION_KEY: 'cle-aes', MEDIA_SIGNING_KEY: 'cle-hmac' }).config.encryption,
    ).toBe(true);
  });
});
