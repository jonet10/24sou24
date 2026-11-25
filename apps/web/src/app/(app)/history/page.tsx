'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ConfigError } from '@/components/ConfigError';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataState';
import { formatDateTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

interface LogRow {
  id: string;
  stream_id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

type LevelFilter = 'all' | 'info' | 'warning' | 'error';

function HistoryContent() {
  const searchParams = useSearchParams();
  const streamId = searchParams.get('stream');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [streamNames, setStreamNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { client, configError: config } = getSupabase();
    if (!client) {
      setConfigError(config);
      setLoading(false);
      return;
    }

    let query = client
      .from('stream_logs')
      .select('id,stream_id,level,message,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (streamId) query = query.eq('stream_id', streamId);

    const [{ data, error: queryError }, { data: streams }] = await Promise.all([
      query,
      client.from('streams').select('id,name'),
    ]);

    if (queryError) setError(queryError.message);
    else setLogs((data ?? []) as LogRow[]);
    setStreamNames(Object.fromEntries((streams ?? []).map((stream) => [stream.id, stream.name])));
    setLoading(false);
  }, [streamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleLogs = filter === 'all' ? logs : logs.filter((log) => log.level === filter);

  return (
    <div className="space-y-5">
      <p className="text-sm text-app-muted">
        Journaux réels émis par le moteur FFmpeg via le Worker. Les secrets RTMP sont systématiquement masqués avant
        stockage.
      </p>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrer les journaux">
        {(['all', 'info', 'warning', 'error'] as const).map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setFilter(level)}
            aria-pressed={filter === level}
            className={`rounded-lg border px-3 py-2 text-xs ${
              filter === level
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                : 'border-app-border text-app-muted hover:bg-app-panel-2'
            }`}
          >
            {level === 'all' ? 'Tous' : level === 'info' ? 'Informations' : level === 'warning' ? 'Avertissements' : 'Erreurs'}
          </button>
        ))}
        {streamId && streamNames[streamId] && (
          <span className="text-xs text-app-muted">Diffusion : {streamNames[streamId]}</span>
        )}
      </div>

      {configError && <ConfigError message={configError} />}
      {error && <ErrorState message={error} />}
      {loading && <LoadingState label="Chargement des journaux…" />}
      {!loading && !error && !configError && visibleLogs.length === 0 && (
        <EmptyState title="Aucun journal" description="Les événements de diffusion apparaîtront ici." />
      )}
      {!loading && visibleLogs.length > 0 && (
        <ul className="space-y-2">
          {visibleLogs.map((log) => {
            const metadata = Object.entries(log.metadata ?? {}).filter(([, value]) => value !== null);
            return (
              <li
                key={log.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-app-border bg-app-panel/70 p-4"
              >
                <div className="min-w-0">
                  <span
                    className={`text-xs font-semibold uppercase ${
                      log.level === 'error'
                        ? 'text-live-500'
                        : log.level === 'warning'
                          ? 'text-warning-500'
                          : 'text-brand-400'
                    }`}
                  >
                    {log.level}
                  </span>
                  {streamNames[log.stream_id] && (
                    <span className="ml-2 text-xs text-app-muted">{streamNames[log.stream_id]}</span>
                  )}
                  <p className="mt-1 break-words text-sm">{log.message}</p>
                  {metadata.length > 0 && (
                    <p className="mt-1 text-xs text-app-muted">
                      {metadata.map(([key, value]) => `${key} : ${String(value)}`).join(' · ')}
                    </p>
                  )}
                </div>
                <time className="text-xs text-app-muted" dateTime={log.created_at}>
                  {formatDateTime(log.created_at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <HistoryContent />
    </Suspense>
  );
}
