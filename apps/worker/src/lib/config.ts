import type { ConfigReport, Env } from '../types';

/** Considère comme absent un secret non défini ou encore à valeur fictive. */
export function isConfigured(value: string | undefined | null): boolean {
  if (!value || value.trim().length === 0) return false;
  return !/votre|example|change[-_]?me|xxxx/i.test(value);
}

export function inspectConfig(env: Env): ConfigReport {
  const publicKey = env.SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY;
  const supabase =
    isConfigured(env.SUPABASE_URL) &&
    isConfigured(publicKey) &&
    isConfigured(env.SUPABASE_SERVICE_ROLE_KEY);
  const r2 = Boolean(env.VIDEOS_BUCKET) && ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].every(
    (key) => isConfigured(env[key as keyof Env] as string | undefined),
  );
  const vps = isConfigured(env.VPS_SYNC_SECRET);
  const youtubeOAuth =
    isConfigured(env.GOOGLE_CLIENT_ID) &&
    isConfigured(env.GOOGLE_CLIENT_SECRET) &&
    isConfigured(env.FRONTEND_URL);
  const encryption =
    isConfigured(env.SECRETS_ENCRYPTION_KEY) && isConfigured(env.MEDIA_SIGNING_KEY);

  const missing: string[] = [];
  if (!supabase) missing.push('Supabase (URL, clé publique/publishable et clé service_role)');
  if (!r2) missing.push('Cloudflare R2 (bucket et credentials pour les URL signées)');
  if (!vps) missing.push('VPS (secret de synchronisation)');
  if (!youtubeOAuth) missing.push('Google OAuth (client ID et client secret)');
  if (!encryption) missing.push('Chiffrement des secrets (SECRETS_ENCRYPTION_KEY)');

  return {
    config: { supabase, r2, vps, youtubeOAuth, encryption },
    missing,
  };
}
