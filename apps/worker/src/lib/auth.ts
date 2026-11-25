import type { Env } from '../types';
import { inspectConfig } from './config';
import { isRateLimited } from './rate-limit';
import { configError, apiError } from './responses';
import { bearerToken, verifySupabaseJwt } from './supabase';

export interface AuthContext {
  token: string;
  userId: string;
}

export type AuthResult = { ok: true; context: AuthContext } | { ok: false; response: Response };

/** Authentification commune à toutes les routes utilisateur du Worker. */
export async function authenticate(request: Request, env: Env, cors: HeadersInit): Promise<AuthResult> {
  const report = inspectConfig(env);
  if (!report.config.supabase) return { ok: false, response: configError(report.missing, cors) };

  const token = bearerToken(request);
  if (!token) {
    return { ok: false, response: apiError(401, 'UNAUTHORIZED', 'Jeton d’accès manquant.', undefined, cors) };
  }

  const identity = await verifySupabaseJwt(env, token);
  if (!identity) {
    return { ok: false, response: apiError(401, 'INVALID_TOKEN', 'Session invalide ou expirée.', undefined, cors) };
  }

  if (await isRateLimited(env, `api:${identity.userId}`, 120, 60)) {
    return {
      ok: false,
      response: apiError(429, 'RATE_LIMITED', 'Trop de requêtes. Réessayez dans une minute.', undefined, cors),
    };
  }

  return { ok: true, context: { token, userId: identity.userId } };
}
