'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import {
  AdminIcon,
  BroadcastIcon,
  ChannelIcon,
  DashboardIcon,
  HistoryIcon,
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
  VideoIcon,
} from './icons';
import { getSupabase } from '@/lib/supabase';

const navigation = [
  { href: '/dashboard', label: 'Tableau de bord', icon: DashboardIcon },
  { href: '/videos', label: 'Mes vidéos', icon: VideoIcon },
  { href: '/channels', label: 'Mes chaînes', icon: ChannelIcon },
  { href: '/streams', label: 'Diffusions', icon: BroadcastIcon },
  { href: '/history', label: 'Historique', icon: HistoryIcon },
  { href: '/settings', label: 'Paramètres', icon: SettingsIcon },
];

const pageTitles: Record<string, string> = {
  '/dashboard': 'Tableau de bord',
  '/videos': 'Mes vidéos',
  '/channels': 'Mes chaînes',
  '/streams': 'Diffusions',
  '/history': 'Historique',
  '/settings': 'Paramètres',
  '/admin': 'Administration',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    let active = true;
    const { client } = getSupabase();
    if (!client || !user) return;
    void client
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setIsAdmin(data?.role === 'admin');
      });
    return () => {
      active = false;
    };
  }, [user]);

  const items = isAdmin ? [...navigation, { href: '/admin', label: 'Administration', icon: AdminIcon }] : navigation;
  const title = pageTitles[pathname] ?? 'STREAM24';
  const initials = (user?.email ?? 'S').slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <header className="flex items-center justify-between border-b border-app-border bg-app-panel/80 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm text-white">S24</span>
          STREAM24
        </Link>
        <button
          type="button"
          className="rounded-lg border border-app-border p-2 text-app-muted hover:text-app-text"
          aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={mobileOpen}
          aria-controls="navigation-principale"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <MenuIcon />
        </button>
      </header>

      <aside
        id="navigation-principale"
        className={`${mobileOpen ? 'block' : 'hidden'} border-b border-app-border bg-app-panel/80 px-4 py-5 backdrop-blur lg:block lg:min-h-screen lg:border-b-0 lg:border-r`}
      >
        <div className="mb-8 hidden items-center gap-3 lg:flex">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500 text-xs font-bold text-white">
            S24
          </span>
          <div>
            <p className="font-bold tracking-tight">STREAM24</p>
            <p className="text-xs text-app-muted">Diffusion 24/7</p>
          </div>
        </div>

        <nav aria-label="Navigation principale">
          <ul className="space-y-1">
            {items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                      active
                        ? 'bg-brand-500/15 font-semibold text-brand-400'
                        : 'text-app-muted hover:bg-app-panel-2 hover:text-app-text'
                    }`}
                  >
                    <Icon />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-8 border-t border-app-border pt-5">
          <div className="flex items-center gap-3 rounded-xl bg-app-panel-2 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/20 text-sm font-semibold text-brand-400">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{user?.email}</p>
              <p className="text-xs text-app-muted">{isAdmin ? 'Administrateur' : 'Compte utilisateur'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-app-muted hover:bg-app-panel-2 hover:text-app-text"
          >
            <LogoutIcon />
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="border-b border-app-border px-5 py-4 sm:px-8">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        </div>
        <main id="contenu" className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
