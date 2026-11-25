import { VISIBLE_STATUS_LABELS, type VisibleStatus } from '@stream24/shared';

const styles: Record<VisibleStatus, string> = {
  en_attente: 'border-app-border bg-app-panel-2 text-app-muted',
  demarrage: 'border-warning-500/40 bg-warning-500/10 text-warning-500',
  en_direct: 'border-live-500/40 bg-live-500/10 text-live-500',
  en_pause: 'border-warning-500/40 bg-warning-500/10 text-warning-500',
  arrete: 'border-app-border bg-app-panel-2 text-app-muted',
  erreur: 'border-live-500/50 bg-live-500/15 text-live-500',
};

export function StatusBadge({ status }: { status: VisibleStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${styles[status]}`}
    >
      {status === 'en_direct' && (
        <span aria-hidden className="h-1.5 w-1.5 animate-live rounded-full bg-live-500" />
      )}
      {VISIBLE_STATUS_LABELS[status]}
    </span>
  );
}
