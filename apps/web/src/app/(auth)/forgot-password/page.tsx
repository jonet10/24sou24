'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Field } from '@/components/Field';
import { getSupabase } from '@/lib/supabase';

const emailSchema = z.email();

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Saisissez une adresse e-mail valide.');
      return;
    }

    const { client, configError } = getSupabase();
    if (!client) {
      setError(configError);
      return;
    }

    setLoading(true);
    const { error: resetError } = await client.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });
    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Mot de passe oublié</h1>
      <p className="mt-2 text-sm text-app-muted">
        Nous vous enverrons un lien sécurisé pour définir un nouveau mot de passe.
      </p>

      {sent ? (
        <div role="status" className="mt-8 rounded-xl border border-success-500/40 bg-success-500/10 p-4 text-sm">
          <p className="font-medium text-success-500">E-mail envoyé.</p>
          <p className="mt-2 text-app-muted">Vérifiez votre boîte de réception, y compris les courriers indésirables.</p>
        </div>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-8 space-y-5" noValidate>
          <Field
            label="Adresse e-mail"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="vous@exemple.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          {error && (
            <p role="alert" className="rounded-xl border border-live-500/40 bg-live-500/10 p-3 text-sm text-live-500">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Envoi en cours…' : 'Envoyer le lien'}
          </button>
        </form>
      )}

      <p className="mt-6 text-sm">
        <Link href="/login" className="text-brand-400 hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
