'use client';

import { useEffect, useState } from 'react';
import { ConfigError } from '@/components/ConfigError';
import { ErrorState, LoadingState } from '@/components/DataState';
import { useAuth } from '@/components/AuthProvider';
import { formatBytes, formatDateTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  max_videos: number;
  max_streams: number;
  max_concurrent_streams: number;
  max_storage_bytes: number;
  monthly_egress_gb: number;
  created_at: string;
}

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    const { client, configError: config } = getSupabase();
    if (!client || !user) {
      setConfigError(config);
      setLoading(false);
      return;
    }
    void client
      .from('profiles')
      .select(
        'id,email,full_name,role,max_videos,max_streams,max_concurrent_streams,max_storage_bytes,monthly_egress_gb,created_at',
      )
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message);
        else setProfile((data ?? null) as Profile | null);
        setLoading(false);
      });
  }, [user]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {configError && <ConfigError message={configError} />}
      {error && <ErrorState message={error} />}
      {loading && <LoadingState label="Chargement des paramètres…" />}

      {profile && (
        <section className="rounded-2xl border border-app-border bg-app-panel/70 p-6">
          <h2 className="font-semibold">Compte</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">E-mail</dt>
              <dd>{profile.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">Nom affiché</dt>
              <dd>{profile.full_name ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">Rôle</dt>
              <dd>{profile.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">Membre depuis</dt>
              <dd>{formatDateTime(profile.created_at)}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-6 rounded-xl border border-app-border px-4 py-2.5 text-sm hover:bg-app-panel-2"
          >
            Se déconnecter
          </button>
        </section>
      )}

      {profile && (
        <section className="rounded-2xl border border-app-border bg-app-panel/70 p-6">
          <h2 className="font-semibold">Quotas</h2>
          <p className="mt-1 text-sm text-app-muted">Limites appliquées par le Worker et la RLS.</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">Vidéos</dt>
              <dd>{profile.max_videos}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">Diffusions</dt>
              <dd>{profile.max_streams}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">Diffusions simultanées</dt>
              <dd>{profile.max_concurrent_streams}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">Stockage</dt>
              <dd>{formatBytes(profile.max_storage_bytes)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-app-muted">Egress mensuel</dt>
              <dd>{profile.monthly_egress_gb} Go</dd>
            </div>
          </dl>
          <p className="mt-5 text-xs text-app-muted">
            Aucune clé de diffusion ni jeton YouTube n’est stocké ou affiché dans le navigateur.
          </p>
        </section>
      )}
    </div>
  );
}
