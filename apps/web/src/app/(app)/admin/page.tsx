'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  adminForceStop,
  adminListStreams,
  adminListUsers,
  adminUpdateUser,
  type AdminStream,
  type AdminUser,
  WorkerApiError,
} from '@/lib/api';
import { ConfigError } from '@/components/ConfigError';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataState';
import { useAuth } from '@/components/AuthProvider';
import { formatDateTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

const GB = 1024 * 1024 * 1024;

interface QuotaFormState {
  role: 'user' | 'admin';
  maxVideos: number;
  maxStreams: number;
  maxConcurrentStreams: number;
  storageGb: number;
  egressGb: number;
}

function formFromUser(user: AdminUser): QuotaFormState {
  return {
    role: user.role,
    maxVideos: user.max_videos,
    maxStreams: user.max_streams,
    maxConcurrentStreams: user.max_concurrent_streams,
    storageGb: Math.round((user.max_storage_bytes / GB) * 100) / 100,
    egressGb: user.monthly_egress_gb,
  };
}

export default function AdminPage() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [streams, setStreams] = useState<AdminStream[]>([]);
  const [forms, setForms] = useState<Record<string, QuotaFormState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [stoppingStream, setStoppingStream] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ users: userRows }, { streams: streamRows }] = await Promise.all([
        adminListUsers(),
        adminListStreams(),
      ]);
      setUsers(userRows);
      setStreams(streamRows);
      setForms(Object.fromEntries(userRows.map((row) => [row.id, formFromUser(row)])));
    } catch (caught) {
      if (caught instanceof WorkerApiError && caught.code === 'CONFIG_MISSING') setConfigError(caught.message);
      else setError(caught instanceof Error ? caught.message : 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { client, configError: config } = getSupabase();
    if (!client || !user) {
      setConfigError(config);
      setLoading(false);
      return;
    }

    let active = true;
    void (async () => {
      const { data, error: roleError } = await client
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (!active) return;
      if (roleError) {
        setError(roleError.message);
        setLoading(false);
        return;
      }
      if (data?.role !== 'admin') {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setIsAdmin(true);
      await load();
    })();

    return () => {
      active = false;
    };
  }, [user, load]);

  function updateForm(userId: string, patch: Partial<QuotaFormState>) {
    setForms((current) => ({
      ...current,
      [userId]: { ...current[userId], ...patch },
    }));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>, target: AdminUser) {
    event.preventDefault();
    const form = forms[target.id];
    if (!form) return;
    setSavingUser(target.id);
    setNotice(null);
    setError(null);
    try {
      await adminUpdateUser(target.id, {
        role: form.role,
        max_videos: form.maxVideos,
        max_streams: form.maxStreams,
        max_concurrent_streams: form.maxConcurrentStreams,
        max_storage_bytes: Math.round(form.storageGb * GB),
        monthly_egress_gb: form.egressGb,
      });
      setNotice(`Quotas de ${target.email} mis à jour.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Mise à jour impossible.');
    } finally {
      setSavingUser(null);
    }
  }

  async function handleForceStop(stream: AdminStream) {
    if (!window.confirm(`Forcer l’arrêt de « ${stream.name} » ? Le moteur FFmpeg confirmera l’arrêt réel.`)) return;
    setStoppingStream(stream.id);
    setNotice(null);
    setError(null);
    try {
      await adminForceStop(stream.id);
      setNotice(`Arrêt de « ${stream.name} » demandé au moteur.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Arrêt impossible.');
    } finally {
      setStoppingStream(null);
    }
  }

  return (
    <div className="space-y-7">
      {configError && <ConfigError message={configError} />}
      {error && <ErrorState message={error} />}
      {notice && (
        <p role="status" className="rounded-xl border border-success-500/40 bg-success-500/10 p-3 text-sm text-success-500">
          {notice}
        </p>
      )}
      {loading && <LoadingState label="Vérification des droits et chargement…" />}
      {isAdmin === false && (
        <ErrorState message="Accès refusé. Cette section est réservée aux administrateurs." />
      )}

      {isAdmin && !loading && (
        <>
          <section aria-labelledby="admin-users">
            <h2 id="admin-users" className="font-semibold">
              Utilisateurs et quotas
            </h2>
            <p className="mt-1 text-sm text-app-muted">
              Les quotas sont appliqués par le Worker (service_role) et vérifiés à chaque action sensible.
            </p>

            {users.length === 0 ? (
              <div className="mt-4">
                <EmptyState title="Aucun utilisateur" description="Les comptes inscrits apparaîtront ici." />
              </div>
            ) : (
              <ul className="mt-5 space-y-3">
                {users.map((target) => {
                  const form = forms[target.id];
                  if (!form) return null;
                  return (
                    <li key={target.id} className="rounded-2xl border border-app-border bg-app-panel/70 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{target.email}</p>
                          <p className="text-xs text-app-muted">Inscrit le {formatDateTime(target.created_at)}</p>
                        </div>
                        <span className="rounded-full border border-app-border bg-app-panel-2 px-2.5 py-1 text-xs text-app-muted">
                          {target.role === 'admin' ? 'Administrateur' : 'Utilisateur'}
                        </span>
                      </div>

                      <form
                        onSubmit={(event) => void handleSave(event, target)}
                        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                      >
                        <label className="space-y-1 text-xs text-app-muted">
                          Rôle
                          <select
                            value={form.role}
                            onChange={(event) => updateForm(target.id, { role: event.target.value as 'user' | 'admin' })}
                            className="w-full rounded-lg border border-app-border bg-app-bg/60 px-3 py-2 text-sm text-app-text"
                          >
                            <option value="user">Utilisateur</option>
                            <option value="admin">Administrateur</option>
                          </select>
                        </label>
                        <label className="space-y-1 text-xs text-app-muted">
                          Vidéos max.
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            value={form.maxVideos}
                            onChange={(event) => updateForm(target.id, { maxVideos: Number(event.target.value) })}
                            className="w-full rounded-lg border border-app-border bg-app-bg/60 px-3 py-2 text-sm text-app-text"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-app-muted">
                          Diffusions max.
                          <input
                            type="number"
                            min={0}
                            max={200}
                            value={form.maxStreams}
                            onChange={(event) => updateForm(target.id, { maxStreams: Number(event.target.value) })}
                            className="w-full rounded-lg border border-app-border bg-app-bg/60 px-3 py-2 text-sm text-app-text"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-app-muted">
                          Diffusions simultanées
                          <input
                            type="number"
                            min={0}
                            max={50}
                            value={form.maxConcurrentStreams}
                            onChange={(event) =>
                              updateForm(target.id, { maxConcurrentStreams: Number(event.target.value) })
                            }
                            className="w-full rounded-lg border border-app-border bg-app-bg/60 px-3 py-2 text-sm text-app-text"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-app-muted">
                          Stockage (Gio)
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={form.storageGb}
                            onChange={(event) => updateForm(target.id, { storageGb: Number(event.target.value) })}
                            className="w-full rounded-lg border border-app-border bg-app-bg/60 px-3 py-2 text-sm text-app-text"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-app-muted">
                          Egress mensuel (Go)
                          <input
                            type="number"
                            min={0}
                            max={100000}
                            value={form.egressGb}
                            onChange={(event) => updateForm(target.id, { egressGb: Number(event.target.value) })}
                            className="w-full rounded-lg border border-app-border bg-app-bg/60 px-3 py-2 text-sm text-app-text"
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={savingUser === target.id}
                          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2 lg:col-span-3 lg:w-fit"
                        >
                          {savingUser === target.id ? 'Enregistrement…' : 'Enregistrer les quotas'}
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="admin-streams">
            <h2 id="admin-streams" className="font-semibold">
              Diffusions en cours
            </h2>
            <p className="mt-1 text-sm text-app-muted">
              L’arrêt forcé modifie l’état voulu ; le moteur FFmpeg doit confirmer l’arrêt réel avant affichage.
            </p>

            {streams.length === 0 ? (
              <div className="mt-4">
                <EmptyState title="Aucune diffusion" description="Les diffusions créées apparaîtront ici." />
              </div>
            ) : (
              <ul className="mt-5 space-y-2">
                {streams.map((stream) => (
                  <li
                    key={stream.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-app-panel/70 p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{stream.name}</p>
                      <p className="text-xs text-app-muted">
                        {stream.user_email ?? stream.user_id} · voulu : {stream.desired_status} · moteur :{' '}
                        {stream.reported_status}
                      </p>
                      {stream.status_reason && <p className="mt-1 text-xs text-app-muted">{stream.status_reason}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleForceStop(stream)}
                      disabled={stream.desired_status === 'stopped' || stoppingStream === stream.id}
                      className="rounded-lg border border-live-500/40 px-3 py-2 text-xs text-live-500 hover:bg-live-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {stoppingStream === stream.id ? 'Arrêt…' : 'Forcer l’arrêt'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
