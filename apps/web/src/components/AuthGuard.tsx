'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { ConfigError } from './ConfigError';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading, configError } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !configError && !session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, configError, session, pathname, router]);

  if (configError) return <ConfigError message={configError} />;

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite">
        <p className="text-sm text-app-muted">Vérification de votre session…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite">
        <p className="text-sm text-app-muted">Redirection vers la connexion…</p>
      </div>
    );
  }

  return <>{children}</>;
}
