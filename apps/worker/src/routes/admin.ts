import { z } from 'zod';
import type { Env } from '../types';
import { authenticate, type AuthContext } from '../lib/auth';
import { inspectConfig } from '../lib/config';
import { apiError, configError, json } from '../lib/responses';
import { adminSupabaseClient, userSupabaseClient } from '../lib/supabase';

const updateUserSchema = z
  .object({
    full_name: z.string().trim().min(2).max(80).optional(),
    role: z.enum(['user', 'admin']).optional(),
    max_videos: z.number().int().min(0).max(1000).optional(),
    max_streams: z.number().int().min(0).max(200).optional(),
    max_concurrent_streams: z.number().int().min(0).max(50).optional(),
    max_storage_bytes: z.number().int().min(0).max(109951162777600).optional(),
    monthly_egress_gb: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucune modification fournie.' });

type AdminResult = { ok: true; context: AuthContext } | { ok: false; response: Response };

async function requireAdmin(request: Request, env: Env, cors: HeadersInit): Promise<AdminResult> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth;

  const report = inspectConfig(env);
  if (!report.config.supabase) return { ok: false, response: configError(report.missing, cors) };

  const userClient = userSupabaseClient(env, auth.context.token);
  const { data, error } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', auth.context.userId)
    .maybeSingle();
  if (error) return { ok: false, response: apiError(500, 'DATABASE_ERROR', 'Rôle introuvable.', undefined, cors) };
  if (data?.role !== 'admin') {
    return { ok: false, response: apiError(403, 'FORBIDDEN', 'Accès réservé aux administrateurs.', undefined, cors) };
  }
  return { ok: true, context: auth.context };
}

export async function handleAdminUsers(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const adminCheck = await requireAdmin(request, env, cors);
  if (!adminCheck.ok) return adminCheck.response;

  const admin = adminSupabaseClient(env);
  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,role,max_videos,max_streams,max_concurrent_streams,max_storage_bytes,monthly_egress_gb,created_at')
    .order('created_at', { ascending: false });
  if (error) return apiError(500, 'DATABASE_ERROR', 'Impossible de lister les utilisateurs.', undefined, cors);
  return json({ users: data ?? [] }, 200, cors);
}

export async function handleAdminUpdateUser(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const adminCheck = await requireAdmin(request, env, cors);
  if (!adminCheck.ok) return adminCheck.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Corps JSON invalide.', undefined, cors);
  }
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', 'Quotas invalides.', parsed.error.issues, cors);
  }

  const targetId = new URL(request.url).pathname.split('/').filter(Boolean)[2] ?? '';
  if (!z.uuid().safeParse(targetId).success) {
    return apiError(400, 'VALIDATION_ERROR', 'Identifiant utilisateur invalide.', undefined, cors);
  }
  if (targetId === adminCheck.context.userId && parsed.data.role && parsed.data.role !== 'admin') {
    return apiError(400, 'SELF_DEMOTION', 'Vous ne pouvez pas révoquer votre propre rôle administrateur.', undefined, cors);
  }

  const admin = adminSupabaseClient(env);
  const { data, error } = await admin
    .from('profiles')
    .update(parsed.data)
    .eq('id', targetId)
    .select('id,email,full_name,role,max_videos,max_streams,max_concurrent_streams,max_storage_bytes,monthly_egress_gb')
    .maybeSingle();
  if (error || !data) return apiError(500, 'DATABASE_ERROR', 'Mise à jour impossible.', undefined, cors);
  return json({ user: data }, 200, cors);
}

export async function handleAdminStreams(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const adminCheck = await requireAdmin(request, env, cors);
  if (!adminCheck.ok) return adminCheck.response;

  const admin = adminSupabaseClient(env);
  const [{ data: streams, error: streamsError }, { data: profiles, error: profilesError }] = await Promise.all([
    admin
      .from('streams')
      .select(
        'id,user_id,name,desired_status,reported_status,last_heartbeat_at,status_reason,created_at',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    admin.from('profiles').select('id,email').limit(1000),
  ]);
  if (streamsError || profilesError) {
    return apiError(500, 'DATABASE_ERROR', 'Impossible de lister les diffusions.', undefined, cors);
  }

  const emails = new Map((profiles ?? []).map((profile) => [profile.id, profile.email]));
  return json(
    {
      streams: (streams ?? []).map((stream) => ({ ...stream, user_email: emails.get(stream.user_id) ?? null })),
    },
    200,
    cors,
  );
}

export async function handleAdminForceStop(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const adminCheck = await requireAdmin(request, env, cors);
  if (!adminCheck.ok) return adminCheck.response;

  const streamId = new URL(request.url).pathname.split('/').filter(Boolean)[3] ?? '';
  if (!z.uuid().safeParse(streamId).success) {
    return apiError(400, 'VALIDATION_ERROR', 'Identifiant de diffusion invalide.', undefined, cors);
  }

  const admin = adminSupabaseClient(env);
  const { data, error } = await admin
    .from('streams')
    .update({ desired_status: 'stopped', status_reason: 'Arrêt forcé par un administrateur.' })
    .eq('id', streamId)
    .select('id,name,desired_status')
    .maybeSingle();
  if (error || !data) return apiError(500, 'DATABASE_ERROR', 'Arrêt forcé impossible.', undefined, cors);

  const { data: stream } = await admin.from('streams').select('user_id').eq('id', streamId).maybeSingle();
  if (stream) {
    await admin.from('stream_logs').insert({
      stream_id: streamId,
      user_id: stream.user_id,
      level: 'warning',
      message: 'Arrêt forcé par un administrateur.',
    });
  }
  return json({ stream: data }, 200, cors);
}
