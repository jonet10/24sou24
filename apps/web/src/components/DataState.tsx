export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div role="status" className="rounded-2xl border border-app-border bg-app-panel/70 p-8 text-center text-sm text-app-muted">
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-live-500/40 bg-live-500/10 p-6 text-sm text-live-500">
      {message}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-app-border bg-app-panel/40 p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-app-muted">{description}</p>
    </div>
  );
}

export function PhaseNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-5 rounded-xl border border-app-border bg-app-panel-2/60 p-3 text-sm text-app-muted">
      {children}
    </p>
  );
}
