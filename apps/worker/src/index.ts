import type { ExportedHandler } from '@cloudflare/workers-types';
import { corsHeaders } from './lib/cors';
import { inspectConfig } from './lib/config';
import { isRateLimited } from './lib/rate-limit';
import { apiError, configError, json } from './lib/responses';
import { bearerToken, userSupabaseClient, verifySupabaseJwt } from './lib/supabase';
import {
  handleMedia,
  handleVideoComplete,
  handleVideoDelete,
  handleVideoFail,
  handleVideoInit,
  handleVideoPlayUrl,
} from './routes/videos';
import { handleOAuthCallback, handleOAuthStart, handleRevokeChannel } from './routes/youtube';
import {
  handleCreateStream,
  handleDeleteStream,
  handleStreamCommand,
  handleVpsSync,
} from './routes/streams';
import {
  handleAdminForceStop,
  handleAdminStreams,
  handleAdminUpdateUser,
  handleAdminUsers,
} from './routes/admin';
import type { Env } from './types';

async function handleHealth(request: Request, env: Env): Promise<Response> {
  const report = inspectConfig(env);
  return json(
    {
      status: report.missing.length === 0 ? 'ok' : 'degraded',
      config: report.config,
      missing: report.missing,
      environment: env.ENVIRONMENT ?? 'development',
    },
    200,
    corsHeaders(request, env),
  );
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  const report = inspectConfig(env);
  if (!report.config.supabase) return configError(report.missing, cors);

  const token = bearerToken(request);
  if (!token) return apiError(401, 'UNAUTHORIZED', 'Jeton d’accès manquant.', undefined, cors);

  const identity = await verifySupabaseJwt(env, token);
  if (!identity) return apiError(401, 'INVALID_TOKEN', 'Session invalide ou expirée.', undefined, cors);

  if (await isRateLimited(env, `me:${identity.userId}`, 60, 60)) {
    return apiError(429, 'RATE_LIMITED', 'Trop de requêtes. Réessayez dans une minute.', undefined, cors);
  }

  const supabase = userSupabaseClient(env, token);
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id,email,full_name,role,max_videos,max_streams,max_concurrent_streams,max_storage_bytes,monthly_egress_gb,created_at',
    )
    .eq('id', identity.userId)
    .maybeSingle();

  if (error) return apiError(500, 'DATABASE_ERROR', 'Impossible de charger le profil.', undefined, cors);
  if (!data) return apiError(404, 'PROFILE_NOT_FOUND', 'Profil introuvable.', undefined, cors);

  return json({ profile: data }, 200, cors);
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return handleHealth(request, env);
      }

      if (url.pathname === '/api/me' && request.method === 'GET') {
        return handleMe(request, env);
      }

      if (url.pathname === '/api/videos/init' && request.method === 'POST') {
        return handleVideoInit(request, env, cors);
      }

      if (url.pathname === '/api/videos/complete' && request.method === 'POST') {
        return handleVideoComplete(request, env, cors);
      }

      if (/^\/api\/videos\/[^/]+\/fail$/.test(url.pathname) && request.method === 'POST') {
        return handleVideoFail(request, env, cors);
      }

      if (/^\/api\/videos\/[^/]+\/play-url$/.test(url.pathname) && request.method === 'GET') {
        return handleVideoPlayUrl(request, env, cors);
      }

      if (/^\/api\/videos\/[^/]+$/.test(url.pathname) && request.method === 'DELETE') {
        return handleVideoDelete(request, env, cors);
      }

      if (/^\/api\/media\/[^/]+$/.test(url.pathname) && request.method === 'GET') {
        return handleMedia(request, env, cors);
      }

      if (url.pathname === '/api/youtube/oauth/start' && request.method === 'GET') {
        return handleOAuthStart(request, env, cors);
      }

      if (url.pathname === '/api/youtube/oauth/callback' && request.method === 'GET') {
        return handleOAuthCallback(request, env);
      }

      if (/^\/api\/youtube\/channels\/[^/]+\/revoke$/.test(url.pathname) && request.method === 'POST') {
        return handleRevokeChannel(request, env, cors);
      }

      if (url.pathname === '/api/streams' && request.method === 'POST') {
        return handleCreateStream(request, env, cors);
      }

      if (/^\/api\/streams\/[^/]+\/command$/.test(url.pathname) && request.method === 'POST') {
        return handleStreamCommand(request, env, cors);
      }

      if (/^\/api\/streams\/[^/]+$/.test(url.pathname) && request.method === 'DELETE') {
        return handleDeleteStream(request, env, cors);
      }

      if (url.pathname === '/api/vps/sync' && request.method === 'POST') {
        const rawBody = await request.text();
        return handleVpsSync(request, env, cors, rawBody);
      }

      if (url.pathname === '/api/admin/users' && request.method === 'GET') {
        return handleAdminUsers(request, env, cors);
      }

      if (/^\/api\/admin\/users\/[^/]+$/.test(url.pathname) && request.method === 'PATCH') {
        return handleAdminUpdateUser(request, env, cors);
      }

      if (url.pathname === '/api/admin/streams' && request.method === 'GET') {
        return handleAdminStreams(request, env, cors);
      }

      if (/^\/api\/admin\/streams\/[^/]+\/force-stop$/.test(url.pathname) && request.method === 'POST') {
        return handleAdminForceStop(request, env, cors);
      }

      return apiError(404, 'NOT_FOUND', 'Route inconnue.', undefined, cors);
    } catch (caught) {
      console.error('Erreur Worker non gérée', caught);
      return apiError(500, 'INTERNAL_ERROR', 'Erreur interne du service.', undefined, cors);
    }
  },
};

export default worker;
