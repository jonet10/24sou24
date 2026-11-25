import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'STREAM24 — Diffusion vidéo 24/7',
    template: '%s · STREAM24',
  },
  description: 'Plateforme SaaS de diffusion vidéo en direct vers YouTube Live.',
  applicationName: 'STREAM24',
};

export const viewport: Viewport = {
  themeColor: '#070b14',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <a className="sr-only-focusable fixed left-4 top-4 z-50 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white" href="#contenu">
          Aller au contenu principal
        </a>
        {children}
      </body>
    </html>
  );
}
