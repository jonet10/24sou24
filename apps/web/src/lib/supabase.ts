import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

/**
 * Client navigateur Supabase. La clé anon est publique par conception ;
 * la protecting des données est assurée par RLS, pas par le secret de cette clé.
 */
export function getSupabase(): { client: SupabaseClient | null; configError: string | null } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Supabase fournit désormais des clés `sb_publishable_*` en remplacement des clés anon.
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || /votre|example|change[-_]?me/i.test(url) || /votre|example|change[-_]?me/i.test(anonKey)) {
    return {
      client: null,
      configError:
        'Supabase n’est pas configuré. Définissez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ou NEXT_PUBLIC_SUPABASE_ANON_KEY), puis redémarrez le serveur de développement.',
    };
  }

  if (!cachedClient) {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }

  return { client: cachedClient, configError: null };
}
