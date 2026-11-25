import type { ApiErrorPayload } from '@stream24/shared';
import { getSupabase } from './supabase';

export class WorkerApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WorkerApiError';
  }
}

function workerBaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_WORKER_API_URL;
  if (!url || url.includes('votre-domaine')) return null;
  return url.replace(/\/$/, '');
}

export interface WorkerRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  requireAuth?: boolean;
}

/** Appelle le Worker avec le JWT de la session courante. Aucun secret n'est transmis depuis le frontend. */
export async function workerFetch<T>(path: string, options: WorkerRequestOptions = {}): Promise<T> {
  const baseUrl = workerBaseUrl();
  if (!baseUrl) {
    throw new WorkerApiError(
      'L’API STREAM24 n’est pas configurée. Définissez NEXT_PUBLIC_WORKER_API_URL (voir apps/web/.env.example).',
      'CONFIG_MISSING',
      503,
    );
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  if (options.requireAuth !== false) {
    const { client, configError } = getSupabase();
    if (!client) throw new WorkerApiError(configError ?? 'Supabase non configuré.', 'CONFIG_MISSING', 503);
    const { data, error } = await client.auth.getSession();
    if (error) throw new WorkerApiError(error.message, 'AUTH_ERROR', 401);
    const token = data.session?.access_token;
    if (!token) throw new WorkerApiError('Session expirée. Veuillez vous reconnecter.', 'UNAUTHORIZED', 401);
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    cache: 'no-store',
    // Nécessaire pour que le cookie HttpOnly d'état OAuth soit enregistré par le navigateur.
    credentials: 'include',
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError = (payload as ApiErrorPayload | null)?.error;
    throw new WorkerApiError(
      apiError?.message ?? `Requête refusée (${response.status}).`,
      apiError?.code ?? 'HTTP_ERROR',
      response.status,
    );
  }

  return payload as T;
}

export interface WorkerHealth {
  status: 'ok' | 'degraded';
  config: {
    supabase: boolean;
    r2: boolean;
    vps: boolean;
    youtubeOAuth: boolean;
    encryption: boolean;
  };
  missing: string[];
}

export function getWorkerHealth(): Promise<WorkerHealth> {
  return workerFetch<WorkerHealth>('/health', { requireAuth: false });
}

export interface VideoUploadInit {
  video: { id: string; title: string; status: string };
  upload: {
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
    expiresIn: number;
  };
}

export function initVideoUpload(input: {
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
}): Promise<VideoUploadInit> {
  return workerFetch<VideoUploadInit>('/api/videos/init', { method: 'POST', body: input });
}

export function completeVideoUpload(videoId: string): Promise<{ video: { id: string; status: string } }> {
  return workerFetch('/api/videos/complete', { method: 'POST', body: { videoId } });
}

export function failVideoUpload(videoId: string, reason: string): Promise<unknown> {
  return workerFetch(`/api/videos/${videoId}/fail`, { method: 'POST', body: { videoId, reason } });
}

export function getVideoPlayUrl(videoId: string): Promise<{ url: string; expiresAt: string }> {
  return workerFetch(`/api/videos/${videoId}/play-url`);
}

export function deleteVideo(videoId: string): Promise<{ deleted: true; id: string }> {
  return workerFetch(`/api/videos/${videoId}`, { method: 'DELETE' });
}

export function startYouTubeOAuth(): Promise<{ authorizationUrl: string }> {
  return workerFetch('/api/youtube/oauth/start');
}

export function revokeYouTubeChannel(channelId: string): Promise<{ revoked: true; id: string }> {
  return workerFetch(`/api/youtube/channels/${channelId}/revoke`, { method: 'POST' });
}

export interface CreatedStream {
  stream: {
    id: string;
    name: string;
    desired_status: string;
    reported_status: string;
    scheduled_at: string | null;
    repeat_enabled: boolean;
    created_at: string;
  };
}

export function createStream(input: {
  name: string;
  videoId: string;
  channelId: string;
  streamKey: string;
  scheduledAt?: string | null;
  repeatEnabled: boolean;
}): Promise<CreatedStream> {
  return workerFetch<CreatedStream>('/api/streams', { method: 'POST', body: input });
}

export function sendStreamCommand(
  streamId: string,
  action: 'start' | 'stop' | 'pause' | 'restart',
): Promise<{ accepted: true; desiredStatus: string; note: string }> {
  return workerFetch(`/api/streams/${streamId}/command`, { method: 'POST', body: { action } });
}

export function deleteStream(streamId: string): Promise<{ deleted: true; id: string }> {
  return workerFetch(`/api/streams/${streamId}`, { method: 'DELETE' });
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  role: 'user' | 'admin';
  max_videos: number;
  max_streams: number;
  max_concurrent_streams: number;
  max_storage_bytes: number;
  monthly_egress_gb: number;
  created_at?: string;
}

export function adminListUsers(): Promise<{ users: AdminUser[] }> {
  return workerFetch('/api/admin/users');
}

export type AdminUserPatch = Partial<
  Pick<
    AdminUser,
    | 'full_name'
    | 'role'
    | 'max_videos'
    | 'max_streams'
    | 'max_concurrent_streams'
    | 'max_storage_bytes'
    | 'monthly_egress_gb'
  >
>;

export function adminUpdateUser(userId: string, patch: AdminUserPatch): Promise<{ user: AdminUser }> {
  return workerFetch(`/api/admin/users/${userId}`, { method: 'PATCH', body: patch });
}

export interface AdminStream {
  id: string;
  user_id: string;
  name: string;
  desired_status: string;
  reported_status: string;
  last_heartbeat_at: string | null;
  status_reason: string | null;
  created_at: string;
  user_email: string | null;
}

export function adminListStreams(): Promise<{ streams: AdminStream[] }> {
  return workerFetch('/api/admin/streams');
}

export function adminForceStop(streamId: string): Promise<{ stream: { id: string; name: string } }> {
  return workerFetch(`/api/admin/streams/${streamId}/force-stop`, { method: 'POST' });
}
