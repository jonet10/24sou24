'use client';

export function ConfigError({ message }: { message: string }) {
  return (
    <section
      role="alert"
      className="rounded-2xl border border-warning-500/40 bg-warning-500/10 p-6 text-sm text-app-text"
    >
      <div className="mb-3 flex items-center gap-3">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-warning-500/20 text-lg">
          !
        </span>
        <h2 className="text-base font-semibold">Configuration requise</h2>
      </div>
      <p className="leading-relaxed text-app-muted">{message}</p>
      <p className="mt-3 leading-relaxed text-app-muted">
        Aucune donnée n’est simulée et aucune diffusion ne peut être lancée tant que la configuration n’est pas
        complète. Consultez le README et les fichiers <code className="text-app-text">.env.example</code>.
      </p>
    </section>
  );
}
