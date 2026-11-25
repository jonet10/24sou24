import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  FRONTEND_URL?: string;

  // Secrets à fournir avec `wrangler secret put`.
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SECRETS_ENCRYPTION_KEY?: string;
  MEDIA_SIGNING_KEY?: string;
  VPS_SYNC_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;

  VIDEOS_BUCKET?: R2Bucket;
  RATE_LIMIT_KV?: KVNamespace;
}

export interface ConfigReport {
  config: {
    supabase: boolean;
    r2: boolean;
    vps: boolean;
    youtubeOAuth: boolean;
    encryption: boolean;
  };
  missing: string[];
}
