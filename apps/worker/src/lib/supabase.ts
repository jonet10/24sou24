import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../types';

export interface VerifiedIdentity {
  userId: string;
  email: string | null;
  role: string | null;
}

const jwksByProject = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(env: Env) {
  const url = env.SUPABASE_URL!.replace(/\/$/, '');
  let jwks = jwksByProject.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
    jwksByProject.set(url, jwks);
  }
  return jwks;
}

/**
 * Vérifie la signature RS256, l'émetteur et l'audience du JWT Supabase.
 * Ne fait jamais confiance à un simple décodage base64 du token.
 */
export async function verifySupabaseJwt(env: Env, token: string): Promise<VerifiedIdentity | null> {
  try {
    const issuer = `${env.SUPABASE_URL!.replace(/\/$/, '')}/auth/v1`;
    const { payload } = await jwtVerify(token, jwksFor(env), {
      issuer,
      audience: 'authenticated',
      algorithms: ['RS256', 'ES256'],
    });
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      role: typeof payload.role === 'string' ? payload.role : null,
    };
  } catch {
    return null;
  }
}

/** Client avec le jeton de l'utilisateur : la RLS Supabase s'applique à chaque requête. */
export function userSupabaseClient(env: Env, token: string): SupabaseClient {
  return createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client service_role : uniquement après vérification explicite du rôle admin ou pour tables secrètes. */
export function adminSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
