import { z } from 'zod';
import {
  createStreamSchema,
  reportedStatusSchema,
  streamCommandSchema,
  type DesiredStatus,
  type ReportedStatus,
} from '@stream24/shared';
import type { Env } from '../types';
import { authenticate } from '../lib/auth';
import { inspectConfig } from '../lib/config';
import { decryptSecret, encryptSecret, fromByteaHex, toByteaHex } from '../lib/crypto';
import { isRateLimited } from '../lib/rate-limit';
import { apiError, configError, json } from '../lib/responses';
import { adminSupabaseClient, userSupabaseClient } from '../lib/supabase';
import { presignR2Get } from '../lib/sigv4';
import { verifyVpsRequest } from '../lib/vps-auth';

const commandSchema = streamCommandSchema.extend({});
const syncSchema = z.object({
  vps_id: z.string().min(1).max(100),
  agent_version: z.string().max(50).optional(),
  engine_available: z.boolean().default(false),
  streams: z
    .array(
      z.object({
        id: z.uuid(),
        run_id: z.uuid().nullable().optional(),
        status: reportedStatusSchema,
        message: z.string().max(500).optional(),
        cpu_percent: z.number().min(0).max(100).optional(),
        memory_mb: z.number().min(0).optional(),
      }),
    )
    .max(200)
    .default([]),
});

export type StreamActionType = 'start' | 'stop' | 'pause' | 'restart';

interface StreamRow {
  id: string;
  user_id: string;
  video_id: string;
  channel_id: string;
  name: string;
  scheduled_at: string | null;
  desired_status: DesiredStatus;
  reported_status: ReportedStatus;
  repeat_enabled: boolean;
  engine_run_id: string | null;
  restart_count: number;
  started_at: string | null;
  status_reason: string | null;
}

/** Décide de l'action à envoyer au moteur à partir de l'état voulu et de l'état rapporté. */
export function decideAction(desired: DesiredStatus, reported: ReportedStatus): StreamActionType | null {
  if (desired === 'stopped') {
    return reported === 'live' || reported === 'starting' || reported === 'paused' ? 'stop' : null;
  }
  if (desired === 'paused') {
    if (reported === 'live') return 'pause';
    if (reported === 'error') return 'start';
    return null;
  }
  // Tant que le moteur n'a pas confirmé sa sortie, on attend : le relancer à chaque
  // synchronisation empêcherait la connexion RTMP de s'établir.
  if (reported === 'starting') return null;
  if (reported === 'live') return desired === 'restarting' ? 'restart' : null;
  if (reported === 'paused') return 'restart';
  return desired === 'restarting' ? 'restart' : 'start';
}

/** Empêche toute clé RTMP ou URL signée d'apparaître dans les journaux. */
export function redactLogs(message: string): string {
  return message
    .replace(/rtmp:\/\/[^\s]+/gi, '[URL RTMP masquée]')
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, '[secret masqué]');
}

async function logStream(
  env: Env,
  streamId: string,
  userId: string,
  level: 'info' | 'warning' | 'error',
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const admin = adminSupabaseClient(env);
  const { error } = await admin.from('stream_logs').insert({
    stream_id: streamId,
    user_id: userId,
    level,
    message: redactLogs(message).slice(0, 4000),
    metadata,
  });
  if (error) console.warn('Journal de diffusion non enregistré', error.message);
}

export async function handleCreateStream(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  const report = inspectConfig(env);
  if (!report.config.supabase || !report.config.encryption) return configError(report.missing, cors);

  if (await isRateLimited(env, `stream-create:${userId}`, 20, 60)) {
    return apiError(429, 'RATE_LIMITED', 'Trop de créations. Réessayez dans une minute.', undefined, cors);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Corps JSON invalide.', undefined, cors);
  }
  const parsed = createStreamSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', 'Données de diffusion invalides.', parsed.error.issues, cors);
  }
  const input = parsed.data;

  const supabase = userSupabaseClient(env, token);
  const [{ data: video }, { data: channel }, { data: profile }] = await Promise.all([
    supabase
      .from('videos')
      .select('id,status')
      .eq('id', input.videoId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('youtube_channels')
      .select('id,status')
      .eq('id', input.channelId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('profiles').select('max_streams').eq('id', userId).maybeSingle(),
  ]);

  if (!video) return apiError(404, 'VIDEO_NOT_FOUND', 'Vidéo introuvable.', undefined, cors);
  if (video.status !== 'ready') return apiError(409, 'VIDEO_NOT_READY', 'La vidéo n’est pas prête.', undefined, cors);
  if (!channel) return apiError(404, 'CHANNEL_NOT_FOUND', 'Chaîne introuvable.', undefined, cors);
  if (channel.status !== 'connected') {
    return apiError(409, 'CHANNEL_NOT_CONNECTED', 'La chaîne n’est pas connectée.', undefined, cors);
  }
  if (!profile) return apiError(500, 'PROFILE_ERROR', 'Profil introuvable.', undefined, cors);

  const { count, error: countError } = await supabase
    .from('streams')
    .select('id', { count: 'exact', head: true });
  if (countError) return apiError(500, 'DATABASE_ERROR', 'Impossible de compter vos diffusions.', undefined, cors);
  if ((count ?? 0) >= profile.max_streams) {
    return apiError(403, 'QUOTA_EXCEEDED', 'Limite de diffusions atteinte.', undefined, cors);
  }

  const encrypted = await encryptSecret(env.SECRETS_ENCRYPTION_KEY!, input.streamKey);
  const { data: stream, error: insertError } = await supabase
    .from('streams')
    .insert({
      user_id: userId,
      video_id: input.videoId,
      channel_id: input.channelId,
      name: input.name,
      scheduled_at: input.scheduledAt ?? null,
      repeat_enabled: input.repeatEnabled,
      desired_status: 'stopped',
      reported_status: 'idle',
    })
    .select('id,name,desired_status,reported_status,scheduled_at,repeat_enabled,created_at')
    .single();

  if (insertError || !stream) {
    return apiError(500, 'DATABASE_ERROR', 'Impossible de créer la diffusion.', undefined, cors);
  }

  const admin = adminSupabaseClient(env);
  const { error: secretError } = await admin.from('stream_secrets').insert({
    stream_id: stream.id,
    ciphertext: toByteaHex(encrypted.ciphertext),
    iv: toByteaHex(encrypted.iv),
  });
  if (secretError) {
    await supabase.from('streams').delete().eq('id', stream.id);
    return apiError(500, 'DATABASE_ERROR', 'Impossible d’enregistrer la clé de diffusion.', undefined, cors);
  }

  await logStream(env, stream.id, userId, 'info', 'Diffusion créée. Aucune clé RTMP n’est conservée en clair.');
  // La clé de diffusion n'est jamais renvoyée au client.
  return json({ stream }, 201, cors);
}

export async function handleStreamCommand(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Corps JSON invalide.', undefined, cors);
  }
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'VALIDATION_ERROR', 'Commande invalide.', undefined, cors);

  const streamId = new URL(request.url).pathname.split('/').filter(Boolean)[2] ?? '';
  if (!z.uuid().safeParse(streamId).success) {
    return apiError(400, 'VALIDATION_ERROR', 'Identifiant de diffusion invalide.', undefined, cors);
  }

  const supabase = userSupabaseClient(env, token);
  const { data: stream, error } = await supabase
    .from('streams')
    .select('id,user_id,reported_status,desired_status')
    .eq('id', streamId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !stream) return apiError(404, 'STREAM_NOT_FOUND', 'Diffusion introuvable.', undefined, cors);

  if (parsed.data.action === 'pause' && stream.reported_status !== 'live') {
    return apiError(
      409,
      'PAUSE_NOT_AVAILABLE',
      'La mise en pause n’est possible que si le moteur confirme un direct en cours.',
      undefined,
      cors,
    );
  }

  if (parsed.data.action === 'start' || parsed.data.action === 'restart') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('max_concurrent_streams')
      .eq('id', userId)
      .maybeSingle();
    const { count } = await supabase
      .from('streams')
      .select('id', { count: 'exact', head: true })
      .neq('id', streamId)
      .neq('desired_status', 'stopped');
    if (profile && (count ?? 0) >= profile.max_concurrent_streams) {
      return apiError(403, 'QUOTA_EXCEEDED', 'Limite de diffusions simultanées atteinte.', undefined, cors);
    }
  }

  const desiredByAction: Record<z.infer<typeof commandSchema>['action'], DesiredStatus> = {
    start: 'starting',
    stop: 'stopped',
    pause: 'paused',
    restart: 'restarting',
  };
  const desired = desiredByAction[parsed.data.action];
  const { error: updateError } = await supabase
    .from('streams')
    .update({ desired_status: desired, status_reason: 'Commande en attente du moteur FFmpeg.' })
    .eq('id', streamId);
  if (updateError) return apiError(500, 'DATABASE_ERROR', 'Commande non enregistrée.', undefined, cors);

  await logStream(env, streamId, userId, 'info', `Commande ${parsed.data.action} demandée.`);
  return json(
    {
      accepted: true,
      desiredStatus: desired,
      note: 'Commande enregistrée. L’état réel sera mis à jour après confirmation du moteur FFmpeg.',
    },
    202,
    cors,
  );
}

export async function handleDeleteStream(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  const streamId = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.uuid().safeParse(streamId).success) {
    return apiError(400, 'VALIDATION_ERROR', 'Identifiant invalide.', undefined, cors);
  }

  const supabase = userSupabaseClient(env, token);
  const { data: stream } = await supabase
    .from('streams')
    .select('id,reported_status')
    .eq('id', streamId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!stream) return apiError(404, 'STREAM_NOT_FOUND', 'Diffusion introuvable.', undefined, cors);
  if (stream.reported_status === 'live') {
    return apiError(409, 'STREAM_RUNNING', 'Arrêtez la diffusion avant de la supprimer.', undefined, cors);
  }

  const admin = adminSupabaseClient(env);
  await admin.from('stream_secrets').delete().eq('stream_id', streamId);
  const { error } = await supabase.from('streams').delete().eq('id', streamId);
  if (error) return apiError(500, 'DATABASE_ERROR', 'Suppression impossible.', undefined, cors);
  return json({ deleted: true, id: streamId }, 200, cors);
}

/** Point de synchronisation unique : l'agent rapporte son état et reçoit des actions. */
export async function handleVpsSync(request: Request, env: Env, cors: HeadersInit, rawBody: string): Promise<Response> {
  const report = inspectConfig(env);
  if (!report.config.vps || !report.config.r2 || !report.config.supabase || !report.config.encryption) {
    return configError(report.missing, cors);
  }

  if (!(await verifyVpsRequest(request, rawBody, env))) {
    return apiError(401, 'INVALID_VPS_SIGNATURE', 'Authentification VPS invalide.', undefined, cors);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError(400, 'INVALID_JSON', 'Corps JSON invalide.', undefined, cors);
  }
  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'VALIDATION_ERROR', 'Rapport VPS invalide.', parsed.error.issues, cors);

  if (await isRateLimited(env, `vps:${parsed.data.vps_id}`, 120, 60)) {
    return apiError(429, 'RATE_LIMITED', 'Trop de synchronisations VPS.', undefined, cors);
  }

  const admin = adminSupabaseClient(env);
  const nowIso = new Date().toISOString();

  for (const incoming of parsed.data.streams) {
    const { data: known } = await admin
      .from('streams')
      .select('id,user_id,engine_run_id,started_at')
      .eq('id', incoming.id)
      .maybeSingle();
    if (!known) continue;
    if (known.engine_run_id && incoming.run_id && known.engine_run_id !== incoming.run_id) continue;

    await admin
      .from('streams')
      .update({
        reported_status: incoming.status,
        last_heartbeat_at: nowIso,
        status_reason: incoming.message ? redactLogs(incoming.message) : null,
        ...(incoming.status === 'stopped' ? { stopped_at: nowIso } : {}),
      })
      .eq('id', known.id);

    if (incoming.status === 'error' || incoming.status === 'stopped') {
      await logStream(
        env,
        known.id,
        known.user_id,
        incoming.status === 'error' ? 'error' : 'info',
        incoming.message ?? `Moteur : ${incoming.status}`,
        { cpu_percent: incoming.cpu_percent, memory_mb: incoming.memory_mb },
      );

      // Une seule ligne par exécution : l'upsert évite de compter deux fois les minutes.
      if (known.started_at && known.engine_run_id) {
        const minutes = Math.max(0, (Date.parse(nowIso) - Date.parse(known.started_at)) / 60_000);
        const periodStart = new Date(nowIso);
        periodStart.setUTCDate(1);
        periodStart.setUTCHours(0, 0, 0, 0);
        const { error: usageError } = await admin.from('usage_records').upsert(
          {
            user_id: known.user_id,
            stream_id: known.id,
            run_id: known.engine_run_id,
            kind: 'stream_minutes',
            quantity: Math.round(minutes * 1000) / 1000,
            unit: 'minutes',
            period_start: periodStart.toISOString(),
          },
          { onConflict: 'stream_id,run_id,kind' },
        );
        if (usageError) console.warn('Minutes de diffusion non enregistrées', usageError.message);
      }
    }
  }

  if (!parsed.data.engine_available) {
    return json(
      {
        status: 'ok',
        actions: [],
        engine_available: false,
        message: 'Aucun moteur FFmpeg disponible : aucune diffusion ne sera lancée ni annoncée en direct.',
        serverTime: nowIso,
      },
      200,
      cors,
    );
  }

  const { data: candidates, error: queryError } = await admin
    .from('streams')
    .select(
      'id,user_id,video_id,channel_id,name,scheduled_at,desired_status,reported_status,repeat_enabled,engine_run_id,restart_count,started_at,status_reason',
    )
    .in('desired_status', ['stopped', 'starting', 'live', 'paused', 'restarting'])
    .limit(50);
  if (queryError) return apiError(500, 'DATABASE_ERROR', 'Impossible de lire les diffusions.', undefined, cors);

  const actions: Array<Record<string, unknown>> = [];

  for (const row of (candidates ?? []) as StreamRow[]) {
    if (row.scheduled_at && Date.parse(row.scheduled_at) > Date.now()) continue;
    const action = decideAction(row.desired_status, row.reported_status);
    if (!action) continue;

    if (action === 'start' || action === 'restart') {
      const [{ data: video }, { data: secretRow }] = await Promise.all([
        admin
          .from('videos')
          .select('id,user_id,r2_key,mime_type,status')
          .eq('id', row.video_id)
          .maybeSingle(),
        admin.from('stream_secrets').select('ciphertext,iv').eq('stream_id', row.id).maybeSingle(),
      ]);

      if (!video || video.user_id !== row.user_id || video.status !== 'ready' || !secretRow) {
        await admin
          .from('streams')
          .update({ reported_status: 'error', status_reason: 'Vidéo ou clé de diffusion indisponible.' })
          .eq('id', row.id);
        await logStream(env, row.id, row.user_id, 'error', 'Configuration de diffusion incomplète.');
        continue;
      }

      let rtmpUrl: string;
      try {
        const decrypted = JSON.parse(
          await decryptSecret(env.SECRETS_ENCRYPTION_KEY!, fromByteaHex(secretRow.ciphertext), fromByteaHex(secretRow.iv)),
        ) as { streamKey?: string };
        if (!decrypted.streamKey) throw new Error('Clé absente');
        rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${decrypted.streamKey}`;
      } catch {
        await admin
          .from('streams')
          .update({ reported_status: 'error', status_reason: 'Clé de diffusion illisible.' })
          .eq('id', row.id);
        await logStream(env, row.id, row.user_id, 'error', 'Clé de diffusion illisible.');
        continue;
      }

      const source = await presignR2Get({
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: 'stream24-videos',
        key: video.r2_key,
        expiresIn: 86_400,
      });
      const runId = crypto.randomUUID();

      await admin
        .from('streams')
        .update({
          engine_run_id: runId,
          engine_instance_id: parsed.data.vps_id,
          reported_status: 'starting',
          started_at: nowIso,
          stopped_at: null,
          ...(action === 'restart' ? { restart_count: row.restart_count + 1 } : {}),
          status_reason: 'Commande transmise au moteur FFmpeg.',
        })
        .eq('id', row.id);
      await logStream(env, row.id, row.user_id, 'info', `Action ${action} transmise au moteur (${runId}).`, {
        run_id: runId,
      });

      actions.push({
        type: action,
        streamId: row.id,
        runId,
        sourceUrl: source.url,
        sourceMimeType: video.mime_type,
        mediaExpiresAt: source.expiresAt,
        rtmpUrl,
        loop: row.repeat_enabled,
      });
      continue;
    }

    await admin
      .from('streams')
      .update({ status_reason: `Commande ${action} transmise au moteur FFmpeg.` })
      .eq('id', row.id);
    await logStream(env, row.id, row.user_id, 'info', `Action ${action} transmise au moteur.`);
    actions.push({
      type: action,
      streamId: row.id,
      runId: row.engine_run_id,
    });
  }

  return json({ status: 'ok', actions, serverTime: nowIso }, 200, cors);
}
