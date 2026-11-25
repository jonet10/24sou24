'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { toVisibleStatus, type DesiredStatus, type ReportedStatus } from '@stream24/shared';
import {
  createStream,
  deleteStream,
  sendStreamCommand,
  WorkerApiError,
} from '@/lib/api';
import { ConfigError } from '@/components/ConfigError';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataState';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

interface StreamRow {
  id: string;
  name: string;
  video_id: string;
  channel_id: string;
  desired_status: DesiredStatus;
  reported_status: ReportedStatus;
  last_heartbeat_at: string | null;
  scheduled_at: string | null;
  status_reason: string | null;
  repeat_enabled: boolean;
  created_at: string;
}

interface Option {
  id: string;
  title: string;
}

export default function StreamsPage() {
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [videos, setVideos] = useState<Option[]>([]);
  const [channels, setChannels] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [videoId, setVideoId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [repeatEnabled, setRepeatEnabled] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyStream, setBusyStream] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { client, configError: config } = getSupabase();
    if (!client) {
      setConfigError(config);
      setLoading(false);
      return;
    }

    const [streamsResult, videosResult, channelsResult] = await Promise.all([
      client
        .from('streams')
        .select(
          'id,name,video_id,channel_id,desired_status,reported_status,last_heartbeat_at,scheduled_at,status_reason,repeat_enabled,created_at',
        )
        .order('created_at', { ascending: false }),
      client.from('videos').select('id,title').is('deleted_at', null).eq('status', 'ready').order('title'),
      client.from('youtube_channels').select('id,title').eq('status', 'connected').order('title'),
    ]);

    if (streamsResult.error) setError(streamsResult.error.message);
    else setStreams((streamsResult.data ?? []) as StreamRow[]);
    if (videosResult.error) setError((current) => current ?? videosResult.error.message);
    else {
      const options = (videosResult.data ?? []) as Option[];
      setVideos(options);
      setVideoId((current) => current || options[0]?.id || '');
    }
    if (channelsResult.error) setError((current) => current ?? channelsResult.error.message);
    else {
      const options = (channelsResult.data ?? []) as Option[];
      setChannels(options);
      setChannelId((current) => current || options[0]?.id || '');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);

    if (!name.trim() || !videoId || !channelId || streamKey.trim().length < 10) {
      setError('Renseignez un nom, une vidéo prête, une chaîne connectée et une clé de diffusion valide.');
      return;
    }

    setCreating(true);
    try {
      await createStream({
        name: name.trim(),
        videoId,
        channelId,
        streamKey: streamKey.trim(),
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        repeatEnabled,
      });
      setName('');
      setStreamKey('');
      setScheduledAt('');
      setNotice('Diffusion créée. La clé de diffusion a été chiffrée et ne sera plus affichée.');
      await load();
    } catch (caught) {
      if (caught instanceof WorkerApiError && caught.code === 'CONFIG_MISSING') setConfigError(caught.message);
      else setError(caught instanceof Error ? caught.message : 'Création impossible.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCommand(stream: StreamRow, action: 'start' | 'stop' | 'pause' | 'restart') {
    setBusyStream(stream.id);
    setNotice(null);
    setError(null);
    try {
      const result = await sendStreamCommand(stream.id, action);
      setNotice(result.note);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Commande impossible.');
    } finally {
      setBusyStream(null);
    }
  }

  async function handleDelete(stream: StreamRow) {
    if (!window.confirm(`Supprimer la diffusion « ${stream.name} » ?`)) return;
    setBusyStream(stream.id);
    try {
      await deleteStream(stream.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Suppression impossible.');
    } finally {
      setBusyStream(null);
    }
  }

  const videoTitles = new Map(videos.map((video) => [video.id, video.title]));
  const channelTitles = new Map(channels.map((channel) => [channel.id, channel.title]));

  return (
    <div className="space-y-7">
      {configError && <ConfigError message={configError} />}
      {error && <ErrorState message={error} />}
      {notice && (
        <p role="status" className="rounded-xl border border-brand-500/40 bg-brand-500/10 p-3 text-sm text-brand-400">
          {notice}
        </p>
      )}

      <section aria-labelledby="create-stream" className="rounded-2xl border border-app-border bg-app-panel/70 p-6">
        <h2 id="create-stream" className="font-semibold">
          Nouvelle diffusion
        </h2>
        <p className="mt-1 text-sm text-app-muted">
          La clé de diffusion est chiffrée AES-GCM par le Worker. Elle ne sera jamais réaffichée ni journalisée.
        </p>

        {videos.length === 0 || channels.length === 0 ? (
          <div className="mt-5 rounded-xl border border-warning-500/40 bg-warning-500/10 p-4 text-sm text-warning-500">
            Il faut au moins une vidéo prête et une chaîne connectée.{' '}
            <Link href="/videos" className="underline">
              Gérer les vidéos
            </Link>{' '}
            ·{' '}
            <Link href="/channels" className="underline">
              Gérer les chaînes
            </Link>
          </div>
        ) : (
          <form onSubmit={(event) => void handleCreate(event)} className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="stream-name" className="block text-sm font-medium">
                Nom de la diffusion
              </label>
              <input
                id="stream-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                placeholder="Ma diffusion en boucle"
                className="w-full rounded-xl border border-app-border bg-app-bg/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="stream-video" className="block text-sm font-medium">
                Vidéo
              </label>
              <select
                id="stream-video"
                value={videoId}
                onChange={(event) => setVideoId(event.target.value)}
                className="w-full rounded-xl border border-app-border bg-app-bg/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:outline-none"
              >
                {videos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="stream-channel" className="block text-sm font-medium">
                Chaîne YouTube
              </label>
              <select
                id="stream-channel"
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
                className="w-full rounded-xl border border-app-border bg-app-bg/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:outline-none"
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="stream-key" className="block text-sm font-medium">
                Clé de diffusion YouTube
              </label>
              <input
                id="stream-key"
                type="password"
                value={streamKey}
                onChange={(event) => setStreamKey(event.target.value)}
                autoComplete="off"
                placeholder="Clé copiée depuis YouTube Studio"
                className="w-full rounded-xl border border-app-border bg-app-bg/60 px-3.5 py-2.5 text-sm placeholder:text-app-muted/70 focus:border-brand-400 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="stream-schedule" className="block text-sm font-medium">
                Date de démarrage (optionnelle)
              </label>
              <input
                id="stream-schedule"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="w-full rounded-xl border border-app-border bg-app-bg/60 px-3.5 py-2.5 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>

            <label className="flex items-end gap-3 pb-2.5 text-sm">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(event) => setRepeatEnabled(event.target.checked)}
                className="h-4 w-4 accent-[#6d5efc]"
              />
              Diffuser en boucle
            </label>

            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2 md:w-fit"
            >
              {creating ? 'Création…' : 'Créer la diffusion'}
            </button>
          </form>
        )}
      </section>

      {loading && <LoadingState label="Chargement des diffusions…" />}

      {!loading && streams.length === 0 && (
        <EmptyState title="Aucune diffusion" description="Créez votre première diffusion avec le formulaire ci-dessus." />
      )}

      {!loading && streams.length > 0 && (
        <ul className="space-y-3">
          {streams.map((stream) => {
            const visible = toVisibleStatus(
              stream.desired_status,
              stream.reported_status,
              stream.last_heartbeat_at,
            );
            const busy = busyStream === stream.id;
            return (
              <li key={stream.id} className="rounded-2xl border border-app-border bg-app-panel/70 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{stream.name}</p>
                    <p className="mt-1 text-xs text-app-muted">
                      {videoTitles.get(stream.video_id) ?? 'Vidéo indisponible'} ·{' '}
                      {channelTitles.get(stream.channel_id) ?? 'Chaîne indisponible'}
                    </p>
                    <p className="mt-1 text-xs text-app-muted">
                      Prévue le {formatDateTime(stream.scheduled_at)} · Boucle {stream.repeat_enabled ? 'activée' : 'désactivée'}
                    </p>
                  </div>
                  <StatusBadge status={visible} />
                </div>

                {stream.status_reason && (
                  <p className="mt-3 text-xs text-app-muted">État moteur : {stream.status_reason}</p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || stream.desired_status !== 'stopped'}
                    onClick={() => void handleCommand(stream, 'start')}
                    className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Démarrer
                  </button>
                  <button
                    type="button"
                    disabled={busy || stream.desired_status === 'stopped'}
                    onClick={() => void handleCommand(stream, 'stop')}
                    className="rounded-lg border border-app-border px-3 py-2 text-xs hover:bg-app-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Arrêter
                  </button>
                  <button
                    type="button"
                    disabled={busy || visible !== 'en_direct'}
                    onClick={() => void handleCommand(stream, 'pause')}
                    className="rounded-lg border border-app-border px-3 py-2 text-xs hover:bg-app-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
                    title="La pause n’est possible que sur un direct confirmé par le moteur."
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    disabled={busy || stream.desired_status === 'stopped'}
                    onClick={() => void handleCommand(stream, 'restart')}
                    className="rounded-lg border border-app-border px-3 py-2 text-xs hover:bg-app-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Redémarrer
                  </button>
                  <Link
                    href={`/history?stream=${stream.id}`}
                    className="rounded-lg border border-app-border px-3 py-2 text-xs text-brand-400 hover:bg-app-panel-2"
                  >
                    Journaux
                  </Link>
                  <button
                    type="button"
                    disabled={busy || visible === 'en_direct'}
                    onClick={() => void handleDelete(stream)}
                    className="rounded-lg border border-live-500/40 px-3 py-2 text-xs text-live-500 hover:bg-live-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Supprimer
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
