import { z } from 'zod';

/** Statut souhaité par l'utilisateur (commande). */
export const desiredStatusSchema = z.enum(['stopped', 'starting', 'live', 'paused', 'restarting']);
export type DesiredStatus = z.infer<typeof desiredStatusSchema>;

/** Statut réellement rapporté par le moteur FFmpeg du VPS. */
export const reportedStatusSchema = z.enum(['idle', 'starting', 'live', 'paused', 'stopped', 'error']);
export type ReportedStatus = z.infer<typeof reportedStatusSchema>;

/** Statut affiché à l'utilisateur : jamais « live » sans heartbeat frais. */
export const visibleStatusSchema = z.enum([
  'en_attente',
  'demarrage',
  'en_direct',
  'en_pause',
  'arrete',
  'erreur',
]);
export type VisibleStatus = z.infer<typeof visibleStatusSchema>;

export const HEARTBEAT_FRESH_MS = 30_000;

/**
 * Calcule le statut visible. `now` est injectable pour les tests.
 * Une commande « starting » sans heartbeat frais reste « demarrage ».
 */
export function toVisibleStatus(
  desired: DesiredStatus,
  reported: ReportedStatus,
  lastHeartbeatAt: string | null,
  now: number = Date.now(),
): VisibleStatus {
  const heartbeatAge = lastHeartbeatAt ? now - Date.parse(lastHeartbeatAt) : Number.POSITIVE_INFINITY;
  const fresh = Number.isFinite(heartbeatAge) && heartbeatAge >= 0 && heartbeatAge <= HEARTBEAT_FRESH_MS;

  if (reported === 'error') return 'erreur';
  if (desired === 'stopped') return reported === 'stopped' || reported === 'idle' ? 'arrete' : 'en_attente';
  if (!fresh) return desired === 'restarting' || reported === 'starting' ? 'demarrage' : 'en_attente';
  if (reported === 'live') return 'en_direct';
  if (reported === 'paused') return 'en_pause';
  if (reported === 'starting') return 'demarrage';
  if (reported === 'stopped' || reported === 'idle') return 'en_attente';
  return 'erreur';
}

export const VISIBLE_STATUS_LABELS: Record<VisibleStatus, string> = {
  en_attente: 'En attente',
  demarrage: 'Démarrage',
  en_direct: 'En direct',
  en_pause: 'En pause',
  arrete: 'Arrêté',
  erreur: 'Erreur',
};

export const signUpSchema = z.object({
  email: z.email(),
  password: z.string().min(12, '12 caractères minimum').max(128),
  fullName: z.string().trim().min(2).max(80).optional(),
});

export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});

export const videoInitSchema = z.object({
  title: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().positive().max(86400).optional(),
});

export const createStreamSchema = z.object({
  name: z.string().trim().min(1).max(200),
  videoId: z.uuid(),
  channelId: z.uuid(),
  scheduledAt: z.iso.datetime().optional().nullable(),
  repeatEnabled: z.boolean().default(true),
  // La clé n'est jamais renvoyée au frontend après enregistrement.
  streamKey: z.string().trim().min(10).max(255),
});

export const streamCommandSchema = z.object({
  action: z.enum(['start', 'stop', 'pause', 'restart']),
});

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/mpeg',
] as const;

export const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;

export type StreamCommand = z.infer<typeof streamCommandSchema>['action'];

export interface DashboardStats {
  videos: number;
  storage_bytes: number;
  streams: number;
  active_streams: number;
  channels: number;
  stream_minutes_this_month: number;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
