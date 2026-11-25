'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  toVisibleStatus,
  type DashboardStats,
  type DesiredStatus,
  type ReportedStatus,
  type VisibleStatus,
} from '@stream24/shared';
import { ConfigError } from '@/components/ConfigError';
import { StatusBadge } from '@/components/StatusBadge';
import { BroadcastIcon, ChannelIcon, ExternalIcon, VideoIcon } from '@/components/icons';
import { getWorkerHealth, WorkerApiError, type WorkerHealth } from '@/lib/api';
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

interface RecentStream {
  id: string;
  name: string;
  desired_status: DesiredStatus;
  reported_status: ReportedStatus;
  last_heartbeat_at: string | null;
  created_at: string;
}

const emptyStats: DashboardStats = {
  videos: 0,
  storage_bytes: 0,
  streams: 0,
  active_streams: 0,
  channels: 0,
  stream_minutes_this_month: 0,
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<RecentStream[]>([]);
  const [health, setHealth] = useState<WorkerHealth | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setStatsError(null);
    setHealthError(null);

    const { client, configError } = getSupabase();
    if (!client) {
      setStatsError(configError);
      setLoading(false);
    } else {
      const [statsResult, streamsResult] = await Promise.all([
        client.rpc('get_dashboard_stats'),
        client
          .from('streams')
          .select('id,name,desired_status,reported_status,last_heartbeat_at,created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      if (statsResult.error) {
        setStatsError(`Impossible de charger les statistiques : ${statsResult.error.message}`);
      } else {
        setStats((statsResult.data as DashboardStats | null) ?? emptyStats);
      }

      if (streamsResult.error) {
        setStatsError((current) => current ?? `Impossible de charger les diffusions : ${streamsResult.error.message}`);
      } else {
        setRecent((streamsResult.data ?? []) as RecentStream[]);
      }
      setLoading(false);
    }

    try {
      setHealth(await getWorkerHealth());
    } catch (error) {
      setHealth(null);
      setHealthError(
        error instanceof WorkerApiError
          ? error.message
          : 'L’API STREAM24 est injoignable. Vérifiez le Worker et sa configuration.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = [
    { label: 'Vidéos importées', value: stats ? String(stats.videos) : '—', icon: VideoIcon, href: '/videos' },
    { label: 'Espace utilisé', value: stats ? formatBytes(stats.storage_bytes) : '—', icon: VideoIcon, href: '/videos' },
    {
      label: 'Diffusions en cours',
      value: stats ? `${stats.active_streams} / ${stats.streams}` : '—',
      icon: BroadcastIcon,
      href: '/streams',
    },
    { label: 'Chaînes connectées', value: stats ? String(stats.channels) : '—', icon: ChannelIcon, href: '/channels' },
  ];

  return (
    <div className="space-y-8">
      <section aria-labelledby="bienvenue">
        <h2 id="bienvenue" className="text-lg font-semibold">
          Vue d’ensemble
        </h2>
        <p className="mt-1 text-sm text-app-muted">
          Statistiques de votre espace et état réel du moteur de diffusion.
        </p>
      </section>

      {statsError && <ConfigError message={statsError} />}

      <section aria-label="Statistiques" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="rounded-2xl border border-app-border bg-app-panel/70 p-5 transition-colors hover:border-brand-500/60"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-app-muted">{label}</span>
              <Icon className="text-brand-400" />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight">{loading && !stats ? '—' : value}</p>
          </Link>
        ))}
      </section>

      <section aria-labelledby="infrastructure" className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl border border-app-border bg-app-panel/70 p-6">
          <h2 id="infrastructure" className="font-semibold">
            État de l’infrastructure
          </h2>
          {healthError && (
            <p role="alert" className="mt-4 rounded-xl border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-500">
              {healthError}
            </p>
          )}
          {health && health.missing.length > 0 && (
            <div role="alert" className="mt-4 rounded-xl border border-warning-500/40 bg-warning-500/10 p-3 text-sm">
              <p className="font-medium text-warning-500">Configuration incomplète</p>
              <ul className="mt-2 list-inside list-disc text-app-muted">
                {health.missing.map((item) => (
                  <li key={item}>{ item }</li>
                ))}
              </ul>
              <p className="mt-2 text-app-muted">
                Tant que ces éléments manquent, aucune diffusion réelle ne peut démarrer.
              </p>
            </div>
          )}
          {health && health.missing.length === 0 && (
            <p role="status" className="mt-4 text-sm text-success-500">
              Configuration complète. Le moteur est prêt à recevoir des commandes.
            </p>
          )}
          {health && (
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              {Object.entries(health.config).map(([key, ready]) => (
                <div key={key} className="flex items-center justify-between rounded-xl bg-app-panel-2 px-4 py-3 text-sm">
                  <dt className="text-app-muted">{key}</dt>
                  <dd className={ready ? 'text-success-500' : 'text-warning-500'}>
                    {ready ? 'Configuré' : 'Manquant'}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="rounded-2xl border border-app-border bg-app-panel/70 p-6">
          <h2 className="font-semibold">Démarrage rapide</h2>
          <ol className="mt-4 space-y-3 text-sm text-app-muted">
            <li>1. Importez une vidéo depuis « Mes vidéos ».</li>
            <li>2. Connectez votre chaîne YouTube depuis « Mes chaînes ».</li>
            <li>3. Créez une diffusion et démarrez-la depuis « Diffusions ».</li>
          </ol>
          <Link
            href="/streams"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Gérer les diffusions
            <ExternalIcon width={16} height={16} />
          </Link>
        </div>
      </section>

      <section aria-labelledby="recent-streams" className="rounded-2xl border border-app-border bg-app-panel/70 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id="recent-streams" className="font-semibold">
            Diffusions récentes
          </h2>
          <Link href="/history" className="text-sm text-brand-400 hover:underline">
            Voir l’historique
          </Link>
        </div>

        {recent.length === 0 ? (
          <p className="mt-5 text-sm text-app-muted">Aucune diffusion pour le moment.</p>
        ) : (
          <ul className="mt-5 divide-y divide-app-border">
            {recent.map((stream) => {
              const visible: VisibleStatus = toVisibleStatus(
                stream.desired_status,
                stream.reported_status,
                stream.last_heartbeat_at,
              );
              return (
                <li key={stream.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{stream.name}</p>
                    <p className="text-xs text-app-muted">{formatDateTime(stream.created_at)}</p>
                  </div>
                  <StatusBadge status={visible} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-app-muted">
        Temps de diffusion cumulé ce mois-ci : {stats ? formatDuration(stats.stream_minutes_this_month * 60) : '—'}
      </p>
    </div>
  );
}
