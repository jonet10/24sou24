'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { revokeYouTubeChannel, startYouTubeOAuth, WorkerApiError } from '@/lib/api';
import { ConfigError } from '@/components/ConfigError';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataState';
import { formatDateTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

interface ChannelRow {
  id: string;
  title: string;
  handle: string | null;
  google_channel_id: string;
  status: string;
  connected_at: string;
  last_synced_at: string | null;
}

const statusLabels: Record<string, string> = {
  connected: 'Connectée',
  revoked: 'Révoquée',
  error: 'Erreur',
};

const oauthErrors: Record<string, string> = {
  configuration: 'Google OAuth ou le chiffrement n’est pas configuré sur le Worker.',
  state_invalid: 'La demande d’autorisation est invalide ou a expiré. Réessayez.',
  token_exchange: 'Google n’a pas pu échanger le code d’autorisation.',
  missing_refresh_token: 'Google n’a pas fourni de jeton de rafraîchissement. Révoquez l’accès puis réessayez.',
  channel_lookup: 'Impossible de lire les informations de la chaîne YouTube.',
  no_channel: 'Aucune chaîne YouTube n’est associée à ce compte Google.',
  save_channel: 'La chaîne n’a pas pu être enregistrée.',
  save_tokens: 'La chaîne est enregistrée mais les jetons n’ont pas pu l’être.',
  unexpected: 'Erreur inattendue lors de la connexion YouTube.',
};

function ChannelsContent() {
  const searchParams = useSearchParams();
  const oauth = searchParams.get('oauth');
  const reason = searchParams.get('reason');
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { client, configError: config } = getSupabase();
    if (!client) {
      setConfigError(config);
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await client
      .from('youtube_channels')
      .select('id,title,handle,google_channel_id,status,connected_at,last_synced_at')
      .order('created_at', { ascending: false });
    if (queryError) setError(queryError.message);
    else setChannels((data ?? []) as ChannelRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (oauth === 'success') setNotice('Chaîne YouTube connectée. Les jetons sont chiffrés côté serveur.');
    if (oauth === 'error') setNotice(oauthErrors[reason ?? 'unexpected'] ?? oauthErrors.unexpected);
  }, [oauth, reason]);

  async function handleConnect() {
    setNotice(null);
    setError(null);
    setConnecting(true);
    try {
      const { authorizationUrl } = await startYouTubeOAuth();
      window.location.assign(authorizationUrl);
    } catch (caught) {
      if (caught instanceof WorkerApiError && caught.code === 'CONFIG_MISSING') setConfigError(caught.message);
      else setError(caught instanceof Error ? caught.message : 'Connexion impossible.');
      setConnecting(false);
    }
  }

  async function handleRevoke(channel: ChannelRow) {
    if (!window.confirm(`Révoquer l’accès de STREAM24 à la chaîne « ${channel.title} » ?`)) return;
    setRevoking(channel.id);
    setError(null);
    try {
      await revokeYouTubeChannel(channel.id);
      setNotice('Connexion révoquée auprès de Google et jetons supprimés.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Révocation impossible.');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-app-border bg-app-panel/70 p-6">
        <h2 className="font-semibold">Connecter une chaîne</h2>
        <p className="mt-1 text-sm text-app-muted">
          Le code d’autorisation est échangé par le Worker. Les jetons Google sont chiffrés AES-GCM et ne sont jamais
          lisibles depuis le navigateur.
        </p>
        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={connecting}
          className="mt-5 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {connecting ? 'Redirection vers Google…' : 'Connecter ma chaîne YouTube'}
        </button>
      </section>

      {configError && <ConfigError message={configError} />}
      {error && <ErrorState message={error} />}
      {notice && (
        <p
          role={oauth === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border p-3 text-sm ${
            oauth === 'error'
              ? 'border-warning-500/40 bg-warning-500/10 text-warning-500'
              : 'border-success-500/40 bg-success-500/10 text-success-500'
          }`}
        >
          {notice}
        </p>
      )}
      {loading && <LoadingState label="Chargement de vos chaînes…" />}

      {!loading && !configError && channels.length === 0 && (
        <EmptyState
          title="Aucune chaîne connectée"
          description="Connectez une chaîne YouTube pour pouvoir créer une diffusion."
        />
      )}

      {!loading && channels.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {channels.map((channel) => (
            <li key={channel.id} className="rounded-2xl border border-app-border bg-app-panel/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{channel.title}</p>
                  <p className="mt-1 text-xs text-app-muted">{channel.handle ?? 'Sans identifiant public'}</p>
                </div>
                <span className="shrink-0 rounded-full border border-app-border bg-app-panel-2 px-2.5 py-1 text-xs text-app-muted">
                  {statusLabels[channel.status] ?? channel.status}
                </span>
              </div>
              <p className="mt-4 text-xs text-app-muted">
                Connectée le {formatDateTime(channel.connected_at)} · Dernière synchro :{' '}
                {formatDateTime(channel.last_synced_at)}
              </p>
              <button
                type="button"
                onClick={() => void handleRevoke(channel)}
                disabled={channel.status === 'revoked' || revoking === channel.id}
                className="mt-4 rounded-lg border border-live-500/40 px-3 py-2 text-xs text-live-500 hover:bg-live-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {revoking === channel.id ? 'Révocation…' : 'Révoquer la connexion'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ChannelsContent />
    </Suspense>
  );
}
