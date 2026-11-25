'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ALLOWED_VIDEO_MIME_TYPES, MAX_VIDEO_BYTES } from '@stream24/shared';
import {
  completeVideoUpload,
  deleteVideo,
  failVideoUpload,
  getVideoPlayUrl,
  initVideoUpload,
  WorkerApiError,
} from '@/lib/api';
import { ConfigError } from '@/components/ConfigError';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataState';
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

interface VideoRow {
  id: string;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface ProfileQuotas {
  max_videos: number;
  max_storage_bytes: number;
}

interface Preview {
  id: string;
  title: string;
  url: string;
  expiresAt: string;
}

const statusLabels: Record<string, string> = {
  uploading: 'Import en cours',
  ready: 'Prêt',
  failed: 'Échec',
  deleting: 'Suppression',
};

const accept = ALLOWED_VIDEO_MIME_TYPES.join(',');

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [quotas, setQuotas] = useState<ProfileQuotas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { client, configError: config } = getSupabase();
    if (!client) {
      setConfigError(config);
      setLoading(false);
      return;
    }
    const { data: authData } = await client.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      setError('Session expirée. Veuillez vous reconnecter.');
      setLoading(false);
      return;
    }

    const [videosResult, profileResult] = await Promise.all([
      client
        .from('videos')
        .select('id,title,file_name,mime_type,size_bytes,duration_seconds,status,error_message,created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      client.from('profiles').select('max_videos,max_storage_bytes').eq('id', userId).maybeSingle(),
    ]);

    if (videosResult.error) setError(videosResult.error.message);
    else setVideos((videosResult.data ?? []) as VideoRow[]);
    if (!profileResult.error && profileResult.data) setQuotas(profileResult.data as ProfileQuotas);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    setNotice(null);

    if (!file) {
      setUploadError('Sélectionnez un fichier vidéo.');
      return;
    }
    if (title.trim().length < 1) {
      setUploadError('Donnez un titre à la vidéo.');
      return;
    }
    if (!(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
      setUploadError('Format non autorisé. Utilisez MP4, WebM, MOV, MKV ou MPEG.');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setUploadError('Le fichier dépasse 5 Gio.');
      return;
    }

    setUploading(true);
    let videoId: string | null = null;
    try {
      const init = await initVideoUpload({
        title: title.trim(),
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      videoId = init.video.id;

      const put = await fetch(init.upload.url, {
        method: 'PUT',
        headers: init.upload.headers,
        body: file,
      });
      if (!put.ok) {
        await failVideoUpload(videoId, `Échec de l’envoi R2 (HTTP ${put.status}).`);
        throw new WorkerApiError(
          'L’envoi vers Cloudflare R2 a échoué. Vérifiez la configuration CORS du bucket.',
          'UPLOAD_FAILED',
          put.status,
        );
      }

      await completeVideoUpload(videoId);
      setNotice(`« ${title.trim()} » est prête pour la diffusion.`);
      setTitle('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (caught) {
      if (caught instanceof WorkerApiError && caught.code === 'CONFIG_MISSING') {
        setConfigError(caught.message);
      } else {
        setUploadError(caught instanceof Error ? caught.message : 'Import impossible.');
        if (videoId) await load();
      }
    } finally {
      setUploading(false);
    }
  }

  async function handlePlay(video: VideoRow) {
    setUploadError(null);
    try {
      const signed = await getVideoPlayUrl(video.id);
      setPreview({ id: video.id, title: video.title, url: signed.url, expiresAt: signed.expiresAt });
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : 'Lecture impossible.');
    }
  }

  async function handleDelete(video: VideoRow) {
    if (!window.confirm(`Supprimer définitivement « ${video.title} » et son fichier dans R2 ?`)) return;
    setUploadError(null);
    try {
      await deleteVideo(video.id);
      if (preview?.id === video.id) setPreview(null);
      await load();
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : 'Suppression impossible.');
    }
  }

  const usedBytes = videos.reduce((total, video) => total + video.size_bytes, 0);

  return (
    <div className="space-y-7">
      {configError && <ConfigError message={configError} />}
      {error && <ErrorState message={error} />}

      <section aria-labelledby="import" className="rounded-2xl border border-app-border bg-app-panel/70 p-6">
        <h2 id="import" className="font-semibold">
          Importer une vidéo
        </h2>
        <p className="mt-1 text-sm text-app-muted">
          Le fichier est envoyé directement dans Cloudflare R2 via une URL signée. Aucun secret n’est exposé au
          navigateur.
        </p>

        <form onSubmit={(event) => void handleUpload(event)} className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <label htmlFor="video-title" className="block text-sm font-medium">
              Titre
            </label>
            <input
              id="video-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ma vidéo en boucle"
              maxLength={200}
              className="w-full rounded-xl border border-app-border bg-app-bg/60 px-3.5 py-2.5 text-sm placeholder:text-app-muted/70 focus:border-brand-400 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="video-file" className="block text-sm font-medium">
              Fichier vidéo
            </label>
            <input
              id="video-file"
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-xs text-app-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-600"
            />
          </div>

          <button
            type="submit"
            disabled={uploading}
            className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? 'Import en cours…' : 'Importer'}
          </button>
        </form>

        {file && (
          <p className="mt-3 text-xs text-app-muted">
            {file.name} · {formatBytes(file.size)}
          </p>
        )}
        {uploadError && (
          <p role="alert" className="mt-4 rounded-xl border border-live-500/40 bg-live-500/10 p-3 text-sm text-live-500">
            {uploadError}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-xl border border-success-500/40 bg-success-500/10 p-3 text-sm text-success-500">
            {notice}
          </p>
        )}
      </section>

      {quotas && (
        <section aria-label="Quotas de stockage" className="rounded-2xl border border-app-border bg-app-panel/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-app-muted">
              {videos.length} / {quotas.max_videos} vidéos · {formatBytes(usedBytes)} /{' '}
              {formatBytes(quotas.max_storage_bytes)}
            </p>
            <p className="text-app-muted">Types acceptés : MP4, WebM, MOV, MKV, MPEG · 5 Gio max.</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-app-bg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((usedBytes / quotas.max_storage_bytes) * 100))} aria-label="Espace de stockage utilisé">
            <div
              className="h-full bg-brand-500"
              style={{ width: `${Math.min(100, (usedBytes / quotas.max_storage_bytes) * 100)}%` }}
            />
          </div>
        </section>
      )}

      {loading && <LoadingState label="Chargement de vos vidéos…" />}
      {!loading && !error && !configError && videos.length === 0 && (
        <EmptyState
          title="Aucune vidéo importée"
          description="Importez votre première vidéo pour l’utiliser dans une diffusion."
        />
      )}

      {!loading && videos.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {videos.map((video) => (
            <li key={video.id} className="rounded-2xl border border-app-border bg-app-panel/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{video.title}</p>
                  <p className="mt-1 truncate text-xs text-app-muted">{video.file_name}</p>
                </div>
                <span className="shrink-0 rounded-full border border-app-border bg-app-panel-2 px-2.5 py-1 text-xs text-app-muted">
                  {statusLabels[video.status] ?? video.status}
                </span>
              </div>

              {video.error_message && (
                <p role="alert" className="mt-3 rounded-lg bg-live-500/10 p-2 text-xs text-live-500">
                  {video.error_message}
                </p>
              )}

              <dl className="mt-4 space-y-1 text-sm text-app-muted">
                <div className="flex justify-between gap-3">
                  <dt>Taille</dt>
                  <dd className="text-app-text">{formatBytes(video.size_bytes)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Durée</dt>
                  <dd className="text-app-text">{formatDuration(video.duration_seconds)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Format</dt>
                  <dd className="text-app-text">{video.mime_type}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Ajoutée</dt>
                  <dd className="text-app-text">{formatDateTime(video.created_at)}</dd>
                </div>
              </dl>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handlePlay(video)}
                  disabled={video.status !== 'ready'}
                  className="rounded-lg border border-app-border px-3 py-2 text-xs hover:bg-app-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Aperçu
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(video)}
                  className="rounded-lg border border-live-500/40 px-3 py-2 text-xs text-live-500 hover:bg-live-500/10"
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
        >
          <div className="w-full max-w-3xl rounded-2xl border border-app-border bg-app-panel p-5">
            <div className="flex items-center justify-between gap-4">
              <h2 id="preview-title" className="truncate font-semibold">
                {preview.title}
              </h2>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg border border-app-border px-3 py-1.5 text-sm hover:bg-app-panel-2"
                aria-label="Fermer l’aperçu"
              >
                Fermer
              </button>
            </div>
            <video
              className="mt-4 w-full rounded-xl bg-black"
              src={preview.url}
              controls
              autoPlay
              playsInline
              aria-label={`Aperçu de ${preview.title}`}
            />
            <p className="mt-3 text-xs text-app-muted">
              URL signée valable jusqu’à {formatDateTime(preview.expiresAt)}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
