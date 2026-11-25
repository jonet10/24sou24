'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <p className="text-sm text-app-muted">Redirection vers le tableau de bord…</p>
    </main>
  );
}
