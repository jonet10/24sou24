import { z } from 'zod';
import { ALLOWED_VIDEO_MIME_TYPES, MAX_VIDEO_BYTES, videoInitSchema } from '@stream24/shared';
import type { Env } from '../types';
import { authenticate } from '../lib/auth';
import { inspectConfig } from '../lib/config';
import { configError, apiError, json } from '../lib/responses';
import { isRateLimited } from '../lib/rate-limit';
import { adminSupabaseClient, userSupabaseClient } from '../lib/supabase';
import { signMediaUrl, verifyMediaSignature } from '../lib/media-signature';
import { presignR2Put } from '../lib/sigv4';

const completeSchema = z.object({ videoId: z.uuid() });
const failSchema = z.object({ videoId: z.uuid(), reason: z.string().trim().max(500).optional() });

interface VideoRow {
  id: string;
  user_id: string;
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  deleted_at: string | null;
}

export function sanitizeFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? 'video';
  const normalized = baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return normalized || 'video';
}

function extensionForMime(mimeType: string): string {
  const extensions: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/mpeg': '.mpeg',
  };
  return extensions[mimeType] ?? '';
}

function ensureExtension(fileName: string, mimeType: string): string {
  return fileName.includes('.') ? fileName : `${fileName}${extensionForMime(mimeType)}`;
}

export function parseByteRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header || !header.startsWith('bytes=')) return null;
  const spec = header.slice(6).trim();
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) return null;

  const [, startText, endText] = match;
  if (startText === '' && endText === '') return null;

  let offset: number;
  let end: number;
  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    offset = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    offset = Number(startText);
    end = endText === '' ? size - 1 : Number(endText);
  }

  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset || offset >= size) {
    return null;
  }
  return { offset, length: Math.min(end, size - 1) - offset + 1 };
}

async function findOwnedVideo(
  env: Env,
  token: string,
  userId: string,
  videoId: string,
  includeDeleted = false,
): Promise<VideoRow | null> {
  const supabase = userSupabaseClient(env, token);
  let query = supabase
    .from('videos')
    .select('id,user_id,r2_key,mime_type,size_bytes,status,deleted_at')
    .eq('id', videoId)
    .eq('user_id', userId);
  if (!includeDeleted) query = query.is('deleted_at', null);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data as VideoRow;
}

/** Initialise l'import et renvoie une URL PUT signée (AWS SigV4). */
export async function handleVideoInit(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  if (await isRateLimited(env, `video-init:${userId}`, 30, 60)) {
    return apiError(429, 'RATE_LIMITED', 'Trop d’imports. Réessayez dans une minute.', undefined, cors);
  }

  const report = inspectConfig(env);
  if (!report.config.r2 || !report.config.supabase) return configError(report.missing, cors);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Corps JSON invalide.', undefined, cors);
  }

  const parsed = videoInitSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', 'Métadonnées vidéo invalides.', parsed.error.issues, cors);
  }

  const { title, fileName, mimeType, sizeBytes, durationSeconds } = parsed.data;
  if (!(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return apiError(415, 'UNSUPPORTED_MIME', 'Type MIME vidéo non autorisé.', { mimeType }, cors);
  }
  if (sizeBytes > MAX_VIDEO_BYTES) {
    return apiError(413, 'FILE_TOO_LARGE', 'Le fichier dépasse la taille maximale autorisée.', undefined, cors);
  }

  const supabase = userSupabaseClient(env, token);
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('max_videos,max_storage_bytes')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile) {
    return apiError(500, 'PROFILE_ERROR', 'Impossible de vérifier vos quotas.', undefined, cors);
  }

  const { count, error: countError } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null);
  if (countError) return apiError(500, 'DATABASE_ERROR', 'Impossible de compter vos vidéos.', undefined, cors);

  const { data: existing, error: usageError } = await supabase.from('videos').select('size_bytes').is('deleted_at', null);
  if (usageError) return apiError(500, 'DATABASE_ERROR', 'Impossible de calculer votre espace utilisé.', undefined, cors);
  const usedBytes = (existing ?? []).reduce((total, row) => total + Number(row.size_bytes ?? 0), 0);

  if ((count ?? 0) >= profile.max_videos) {
    return apiError(403, 'QUOTA_EXCEEDED', 'Limite de vidéos atteinte.', { limit: profile.max_videos }, cors);
  }
  if (usedBytes + sizeBytes > profile.max_storage_bytes) {
    return apiError(403, 'QUOTA_EXCEEDED', 'Espace de stockage insuffisant.', undefined, cors);
  }

  const videoId = crypto.randomUUID();
  const safeName = ensureExtension(sanitizeFileName(fileName), mimeType);
  const r2Key = `users/${userId}/videos/${videoId}/${safeName}`;

  const { error: insertError } = await supabase.from('videos').insert({
    id: videoId,
    user_id: userId,
    r2_key: r2Key,
    title,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    duration_seconds: durationSeconds ?? null,
    status: 'uploading',
  });
  if (insertError) {
    return apiError(500, 'DATABASE_ERROR', 'Impossible d’enregistrer la vidéo.', undefined, cors);
  }

  const upload = await presignR2Put({
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: 'stream24-videos',
    key: r2Key,
    mimeType,
  });

  return json({ video: { id: videoId, title, status: 'uploading' }, upload }, 201, cors);
}

/** Vérifie l'objet R2 après upload et marque la vidéo comme prête. */
export async function handleVideoComplete(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  const report = inspectConfig(env);
  if (!report.config.r2) return configError(report.missing, cors);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Corps JSON invalide.', undefined, cors);
  }
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'VALIDATION_ERROR', 'Identifiant vidéo invalide.', undefined, cors);

  const videoId = parsed.data.videoId;
  const video = await findOwnedVideo(env, token, userId, videoId);
  if (!video) return apiError(404, 'VIDEO_NOT_FOUND', 'Vidéo introuvable.', undefined, cors);
  if (video.status === 'ready') return json({ video: { id: videoId, status: 'ready' } }, 200, cors);

  const object = await env.VIDEOS_BUCKET!.head(video.r2_key);
  const remoteType = object?.httpMetadata?.contentType ?? null;
  if (!object || object.size !== video.size_bytes || remoteType !== video.mime_type) {
    const supabase = userSupabaseClient(env, token);
    await supabase
      .from('videos')
      .update({ status: 'failed', error_message: 'Fichier R2 absent ou métadonnées incohérentes.' })
      .eq('id', videoId);
    return apiError(
      400,
      'UPLOAD_MISMATCH',
      'Le fichier envoyé est absent ou ne correspond pas aux métadonnées déclarées (taille/type MIME).',
      undefined,
      cors,
    );
  }

  const supabase = userSupabaseClient(env, token);
  const { error: updateError } = await supabase
    .from('videos')
    .update({ status: 'ready', error_message: null })
    .eq('id', videoId);
  if (updateError) return apiError(500, 'DATABASE_ERROR', 'Impossible de finaliser la vidéo.', undefined, cors);

  const admin = adminSupabaseClient(env);
  const { error: usageError } = await admin.from('usage_records').insert({
    user_id: userId,
    kind: 'storage',
    quantity: video.size_bytes,
    unit: 'bytes',
    period_start: new Date(),
  });
  if (usageError) console.warn('Impossible d’enregistrer l’utilisation de stockage', usageError.message);

  return json({ video: { id: videoId, status: 'ready' } }, 200, cors);
}

/** Marque un import comme échoué quand le PUT navigateur → R2 a échoué. */
export async function handleVideoFail(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Corps JSON invalide.', undefined, cors);
  }
  const parsed = failSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'VALIDATION_ERROR', 'Données invalides.', undefined, cors);

  const video = await findOwnedVideo(env, token, userId, parsed.data.videoId);
  if (!video) return apiError(404, 'VIDEO_NOT_FOUND', 'Vidéo introuvable.', undefined, cors);

  const supabase = userSupabaseClient(env, token);
  await supabase
    .from('videos')
    .update({ status: 'failed', error_message: parsed.data.reason ?? 'Échec de l’envoi vers R2.' })
    .eq('id', parsed.data.videoId);

  return json({ video: { id: parsed.data.videoId, status: 'failed' } }, 200, cors);
}

/** Renvoie une URL de lecture signée, valable 5 minutes,Servie par le Worker. */
export async function handleVideoPlayUrl(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  const report = inspectConfig(env);
  if (!report.config.r2 || !report.config.encryption) return configError(report.missing, cors);

  if (await isRateLimited(env, `play-url:${userId}`, 60, 60)) {
    return apiError(429, 'RATE_LIMITED', 'Trop de demandes de lecture. Réessayez dans une minute.', undefined, cors);
  }

  const videoId = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.uuid().safeParse(videoId).success) return apiError(400, 'VALIDATION_ERROR', 'Identifiant invalide.', undefined, cors);

  const video = await findOwnedVideo(env, token, userId, videoId);
  if (!video) return apiError(404, 'VIDEO_NOT_FOUND', 'Vidéo introuvable.', undefined, cors);
  if (video.status !== 'ready') {
    return apiError(409, 'VIDEO_NOT_READY', 'La vidéo n’est pas prête à être lue.', undefined, cors);
  }

  const signed = await signMediaUrl(
    env.MEDIA_SIGNING_KEY!,
    new URL(request.url).origin,
    videoId,
  );
  return json(signed, 200, cors);
}

/** Supprime l'objet R2 puis l'enregistrement (RLS). */
export async function handleVideoDelete(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  const report = inspectConfig(env);
  if (!report.config.r2) return configError(report.missing, cors);

  const videoId = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.uuid().safeParse(videoId).success) return apiError(400, 'VALIDATION_ERROR', 'Identifiant invalide.', undefined, cors);

  const video = await findOwnedVideo(env, token, userId, videoId, true);
  if (!video) return apiError(404, 'VIDEO_NOT_FOUND', 'Vidéo introuvable.', undefined, cors);

  const supabase = userSupabaseClient(env, token);
  await supabase.from('videos').update({ deleted_at: new Date().toISOString(), status: 'deleting' }).eq('id', videoId);

  try {
    await env.VIDEOS_BUCKET!.delete(video.r2_key);
  } catch {
    await supabase.from('videos').update({ deleted_at: null, status: 'ready' }).eq('id', videoId);
    return apiError(500, 'STORAGE_ERROR', 'Impossible de supprimer le fichier dans R2.', undefined, cors);
  }

  const { error: deleteError } = await supabase.from('videos').delete().eq('id', videoId);
  if (deleteError) {
    return apiError(500, 'DATABASE_ERROR', 'Fichier supprimé mais enregistrement non supprimé.', undefined, cors);
  }
  return json({ deleted: true, id: videoId }, 200, cors);
}

/** Sert la vidéo depuis R2 via une URL signée HMAC (aucun secret dans l'URL). */
export async function handleMedia(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const report = inspectConfig(env);
  if (!report.config.r2 || !report.config.encryption) return configError(report.missing, cors);

  const url = new URL(request.url);
  const videoId = url.pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.uuid().safeParse(videoId).success) return apiError(400, 'VALIDATION_ERROR', 'Identifiant invalide.', undefined, cors);

  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (await isRateLimited(env, `media:${clientIp}`, 120, 60)) {
    return apiError(429, 'RATE_LIMITED', 'Trop de lectures. Réessayez dans une minute.', undefined, cors);
  }

  const valid = await verifyMediaSignature(
    env.MEDIA_SIGNING_KEY!,
    videoId,
    url.searchParams.get('exp'),
    url.searchParams.get('sig'),
  );
  if (!valid) return apiError(403, 'INVALID_SIGNATURE', 'URL de lecture invalide ou expirée.', undefined, cors);

  const admin = adminSupabaseClient(env);
  const { data, error } = await admin
    .from('videos')
    .select('r2_key,mime_type,size_bytes,status,deleted_at')
    .eq('id', videoId)
    .maybeSingle();
  if (error || !data || data.deleted_at || data.status !== 'ready') {
    return apiError(404, 'VIDEO_NOT_FOUND', 'Vidéo indisponible.', undefined, cors);
  }

  const video = data as Pick<VideoRow, 'r2_key' | 'mime_type' | 'size_bytes' | 'status' | 'deleted_at'>;
  const range = request.method === 'GET' ? parseByteRange(request.headers.get('Range'), video.size_bytes) : null;
  const object = await env.VIDEOS_BUCKET!.get(video.r2_key, range ? { range } : {});
  if (!object) return apiError(404, 'OBJECT_NOT_FOUND', 'Fichier vidéo introuvable dans R2.', undefined, cors);

  const headers = new Headers({
    'Content-Type': video.mime_type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=60',
    'Content-Disposition': 'inline',
    ...cors,
  });

  if (range) {
    headers.set('Content-Length', String(range.length));
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${video.size_bytes}`);
  } else {
    headers.set('Content-Length', String(video.size_bytes));
  }

  return new Response(object.body as BodyInit, { status: range ? 206 : 200, headers });
}
