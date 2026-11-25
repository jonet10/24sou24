import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <main id="contenu" className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-10 flex items-center gap-3 w-fit" aria-label="STREAM24 — accueil">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500 text-sm font-bold text-white">
              S24
            </span>
            <span className="text-xl font-bold tracking-tight">STREAM24</span>
          </Link>
          {children}
        </div>
      </main>

      <aside className="relative hidden overflow-hidden border-l border-app-border bg-app-panel/40 p-12 lg:flex lg:flex-col lg:justify-center">
        <div aria-hidden className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative max-w-lg">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">
            Diffusion en direct
          </p>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Vos vidéos, en direct sur YouTube, 24 h/24 et 7 j/7.
          </h2>
          <p className="mt-5 leading-relaxed text-app-muted">
            Importez vos médias, connectez vos chaînes et pilotez vos diffusions depuis une interface unique. L’état
            affiché provient toujours du moteur FFmpeg, jamais d’une simulation.
          </p>
          <dl className="mt-10 grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-2xl border border-app-border bg-app-panel p-4">
              <dt className="text-app-muted">Isolation</dt>
              <dd className="mt-1 font-semibold">Un compte, un espace</dd>
            </div>
            <div className="rounded-2xl border border-app-border bg-app-panel p-4">
              <dt className="text-app-muted">Sécurité</dt>
              <dd className="mt-1 font-semibold">Secrets chiffrés</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}
