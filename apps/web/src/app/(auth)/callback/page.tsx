'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Field } from '@/components/Field';
import { getSupabase } from '@/lib/supabase';

const passwordSchema = z.string().min(12, '12 caractères minimum').max(128);

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const type = searchParams.get('type');
  const next = searchParams.get('next');
  const [status, setStatus] = useState('Vérification du lien…');
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [recoveryReady, setRecoveryReady] = useState(false);

  useEffect(() => {
    let active = true;
    const { client, configError } = getSupabase();
    if (!client) {
      setError(configError);
      setStatus('Configuration requise.');
      return;
    }

    async function run() {
      if (code) {
        const { error: exchangeError } = await client!.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (exchangeError) {
          setError(exchangeError.message);
          setStatus('Lien invalide ou expiré.');
          return;
        }
        const { data } = await client!.auth.getSession();
        if (!active) return;
        if (type === 'recovery' || !data.session) {
          setRecoveryReady(true);
          setStatus('Définissez votre nouveau mot de passe.');
          return;
        }
        router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
        return;
      }

      const { data } = await client!.auth.getSession();
      if (!active) return;
      if (data.session) {
        setRecoveryReady(type === 'recovery');
        setStatus(type === 'recovery' ? 'Définissez votre nouveau mot de passe.' : 'Session confirmée.');
      } else {
        setError('Aucune session valide. Demandez un nouveau lien.');
        setStatus('Lien invalide ou expiré.');
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [code, next, router, type]);

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Mot de passe invalide.');
      return;
    }
    const { client } = getSupabase();
    if (!client) return;
    const { error: updateError } = await client.auth.updateUser({ password: parsed.data });
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace('/dashboard');
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Confirmation</h1>
      <p role="status" className="mt-3 text-sm text-app-muted">
        {status}
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-live-500/40 bg-live-500/10 p-3 text-sm text-live-500">
          {error}
        </p>
      )}

      {recoveryReady && (
        <form onSubmit={(event) => void handlePasswordUpdate(event)} className="mt-8 space-y-5" noValidate>
          <Field
            label="Nouveau mot de passe"
            type="password"
            name="newPassword"
            autoComplete="new-password"
            hint="12 caractères minimum."
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Enregistrer le mot de passe
          </button>
        </form>
      )}
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<p className="text-sm text-app-muted">Chargement…</p>}>
      <CallbackContent />
    </Suspense>
  );
}
