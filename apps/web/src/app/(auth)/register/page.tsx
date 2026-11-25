'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUpSchema } from '@stream24/shared';
import { Field } from '@/components/Field';
import { getSupabase } from '@/lib/supabase';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = signUpSchema.safeParse({
      email,
      password,
      fullName: fullName.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Données invalides.');
      return;
    }

    const { client, configError } = getSupabase();
    if (!client) {
      setError(configError);
      return;
    }

    setLoading(true);
    const { data, error: authError } = await client.auth.signUp({
      ...parsed.data,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { full_name: parsed.data.fullName ?? null },
      },
    });
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (data.session) {
      router.replace('/dashboard');
      router.refresh();
      return;
    }

    setNotice('Compte créé. Consultez votre boîte mail pour confirmer votre adresse avant de vous connecter.');
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Créer un compte</h1>
      <p className="mt-2 text-sm text-app-muted">Commencez à diffuser vos vidéos en quelques minutes.</p>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-8 space-y-5" noValidate>
        <Field
          label="Nom complet"
          type="text"
          name="fullName"
          autoComplete="name"
          placeholder="Camille Martin"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
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
        <Field
          label="Mot de passe"
          type="password"
          name="password"
          autoComplete="new-password"
          hint="12 caractères minimum."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {error && (
          <p role="alert" className="rounded-xl border border-live-500/40 bg-live-500/10 p-3 text-sm text-live-500">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-xl border border-success-500/40 bg-success-500/10 p-3 text-sm text-success-500">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Création en cours…' : 'Créer mon compte'}
        </button>
      </form>

      <p className="mt-6 text-sm text-app-muted">
        Vous avez déjà un compte ?{' '}
        <Link href="/login" className="font-medium text-brand-400 hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
