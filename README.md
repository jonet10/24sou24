# STREAM24

Plateforme SaaS de diffusion vidéo en direct 24 h/24 et 7 j/7 vers YouTube Live.

> **État : phases 1 à 8 terminées.** Authentification, tableau de bord, RLS, API Worker, vidéos (import R2 signé, aperçu, suppression), chaînes YouTube OAuth avec jetons chiffrés, diffusions pilotées par FFmpeg, états confirmés par heartbeat, journaux et administration sont en place. Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Aucune diffusion n'est simulée : sans VPS, R2, YouTube ou secrets configurés, l'application affiche une erreur de configuration explicite.

## Architecture

| Composant | Technologie | Rôle |
| --- | --- | --- |
| Frontend | Next.js 16 (TypeScript, Tailwind CSS 4) en `output: "export"` | Interface française responsive, thème sombre, déployée sur **Cloudflare Pages** (preset *Next.js Static HTML Export*, répertoire `out`) |
| API | **Cloudflare Worker** TypeScript | JWT Supabase, RLS, quotas, URLs R2 signées, OAuth, commandes VPS |
| Données | **Supabase** (Postgres + Auth + RLS) | Comptes, vidéos, chaînes, diffusions, journaux, quotas |
| Stockage | **Cloudflare R2** | Fichiers vidéo, accès par URLs signées |
| Moteur | **VPSFree** Ubuntu/Debian + FFmpeg | Diffusion isolée par UUID, jamais exposée sur Internet |

### Pourquoi un export statique ?

Cloudflare recommande en 2026 `vinext`/Workers pour du Next.js SSR, mais l'infrastructure demandée impose Cloudflare Pages. Le mode **static export** est officiellement supporté par Pages ; tous les appels sensibles passent par le Worker. Le frontend ne contient que des variables `NEXT_PUBLIC_*`.

## Structure

```text
apps/web/        Next.js statique (Pages)
apps/worker/     API Cloudflare Worker
packages/shared/ Types et schémas Zod partagés
supabase/migrations/0001_initial_schema.sql
                0002_video_import_errors.sql
                0003_stream_usage_runs.sql
vps/             Agent Linux + moteur FFmpeg + unité systemd
docs/            Architecture
```

## Prérequis local

- Node.js >= 20 (testé avec Node 24) et npm
- Python 3 (pour les tests de l'agent VPS)
- Un projet Supabase, un bucket R2, un compte Cloudflare et un VPSFree

## Installation locale

```sh
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.dev.vars
```

Renseignez les fichiers `.env.local` et `.dev.vars` avec vos propres valeurs. **Ne committez jamais ces fichiers** : ils sont ignorés par Git. Les fichiers `.env.example` ne contiennent que des valeurs fictives.

## Base de données

Appliquer dans l'ordre [`0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql), [`0002_video_import_errors.sql`](supabase/migrations/0002_video_import_errors.sql) puis [`0003_stream_usage_runs.sql`](supabase/migrations/0003_stream_usage_runs.sql) dans l'éditeur SQL Supabase (ou `supabase db push`).

Ces migrations créent :

- `profiles`, `videos`, `youtube_channels`, `streams`, `stream_logs`, `usage_records` ;
- les tables secrètes `youtube_channel_tokens` et `stream_secrets` (aucun droit `SELECT` pour `authenticated`) ;
- les index, triggers `updated_at`, la création automatique de profil et la fonction `get_dashboard_stats()` ;
- le champ `videos.error_message` pour les raisons d'échec d'import et `usage_records.run_id` pour compter les minutes une seule fois par exécution ;
- les politiques RLS : chaque utilisateur ne voit que ses propres données, les administrateurs sont vérifiés via `is_admin()`.

Dans Supabase → Authentication → URL Configuration, ajouter :

- `http://localhost:3000/auth/callback`
- `https://VOTRE-SITE.pages.dev/auth/callback`

## Développement

```sh
npm run dev:web      # http://localhost:3000
npm run dev:worker   # http://localhost:8787
```

## Vérifications

```sh
npm run typecheck
npm test
npm run build
python3 -m unittest discover -s vps/tests -v   # ou `py -3 -m unittest ...` sur Windows
```

`npm run build` doit produire `apps/web/out/` (frontend statique). Le build échoue volontairement si le code n'est pas valide ; il n'invente jamais de données de diffusion.

## Application des migrations Supabase

Le CLI est configuré dans `supabase/config.toml` (project_id `urxmhyxrmwoyvzxdsntx`). Pour appliquer les 3 migrations sur le projet distant :

```sh
supabase login                                   # une seule fois, ou remplacer SUPABASE_ACCESS_TOKEN par un vrai token sbp_...
supabase link --project-ref urxmhyxrmwoyvzxdsntx # demande le mot de passe DB, à saisir dans le terminal
supabase db push
```

Le mot de passe de la base ne doit jamais être collé dans un chat ni commité. Si le CLI n'est pas utilisable, ouvrir **Supabase → SQL Editor** et exécuter dans l'ordre les fichiers `supabase/migrations/0001_initial_schema.sql`, `0002_video_import_errors.sql`, `0003_stream_usage_runs.sql`.

Vérifier ensuite dans **Authentication → URL Configuration** : Site URL = domaine Pages, Redirect URLs = `<domaine Pages>/callback` et `<domaine Worker>/api/youtube/oauth/callback`. Promouvoir le premier admin après inscription :

```sql
update public.profiles set role = 'admin' where email = 'admin@exemple.com';
```

## Déploiement Cloudflare Pages (frontend)

1. Le code est poussé sur `origin/main` (le CI vérifie uniquement, aucun déploiement automatique).
2. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Importer le dépôt.
3. Framework preset : **Next.js (Static HTML Export)**.
4. Build command : `npm run build -w @stream24/web` ; build output : `apps/web/out`.
5. Ajouter les variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (clé `sb_publishable_*` ; l'ancienne `NEXT_PUBLIC_SUPABASE_ANON_KEY` reste acceptée) et `NEXT_PUBLIC_WORKER_API_URL`.
6. Le fichier `apps/web/public/_headers` applique CSP, HSTS et les en-têtes anti-clicage ; il est copié automatiquement dans `apps/web/out/` par le build. Si le Worker ou R2 utilise un domaine personnalisé, l'ajouter à `connect-src` / `media-src` de la CSP.

## Déploiement Cloudflare Worker (API)

`apps/worker/.dev.vars` (ignoré par Git) contient déjà les valeurs publiques Supabase et 3 clés générées localement (`SECRETS_ENCRYPTION_KEY`, `MEDIA_SIGNING_KEY`, `VPS_SYNC_SECRET`). Compléter ce fichier avec `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`, puis envoyer le tout d'un coup :

```sh
cd apps/worker
powershell -ExecutionPolicy Bypass -File scripts/push-secrets.ps1
```

Ou, manuellement :

```sh
cd apps/worker
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY   # ou SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SECRETS_ENCRYPTION_KEY
npx wrangler secret put MEDIA_SIGNING_KEY
npx wrangler secret put VPS_SYNC_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler kv namespace create STREAM24_RATE_LIMIT
# remplacer l'id fictif dans wrangler.toml par l'id retourné
npx wrangler deploy
```

Configurer le bucket R2 (`stream24-videos`) et son CORS pour autoriser les PUT depuis le domaine Pages, par exemple :

```json
[
  {
    "AllowedOrigins": ["https://votre-site.pages.dev", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 6000
  }
]
```

Les credentials R2 ne servent qu'au Worker pour signer les URL ; ils ne sont jamais envoyés au navigateur. La lecture passe par `/api/media/:id` avec une URL HMAC valable 5 minutes, signée par `MEDIA_SIGNING_KEY`.

`GET /health` retourne l'état de configuration (supabase, r2, vps, youtubeOAuth, encryption) et la liste des éléments manquants. Le tableau de bord l'affiche immédiatement.

### Routes vidéo

| Route | Rôle |
| --- | --- |
| `POST /api/videos/init` | Valide les métadonnées et quotas, crée la ligne `uploading`, renvoie une URL PUT SigV4 (15 min) |
| `PUT <URL R2 signée>` | Envoi direct du fichier par le navigateur, sans secret |
| `POST /api/videos/complete` | Vérifie taille/type MIME via `head()` R2 puis marque la vidéo `ready` |
| `POST /api/videos/:id/fail` | Marque un import en échec avec une raison lisible |
| `GET /api/videos/:id/play-url` | URL de lecture signée HMAC, 5 minutes |
| `GET /api/media/:id?exp=...&sig=...` | Sert le flux R2 (support `Range`) après vérification HMAC |
| `DELETE /api/videos/:id` | Supprime l'objet R2 puis l'enregistrement (RLS) |

### Routes YouTube

| Route | Rôle |
| --- | --- |
| `GET /api/youtube/oauth/start` | Crée un cookie d'état HttpOnly signé et renvoie l'URL d'autorisation Google |
| `GET /api/youtube/oauth/callback` | Échange le code, lit la chaîne, chiffre les jetons AES-GCM et redirige vers Pages |
| `POST /api/youtube/channels/:id/revoke` | Révoque le jeton chez Google puis supprime les secrets locaux |

Dans Google Cloud Console : activer **YouTube Data API v3**, créer un **OAuth client ID** (Web application) et ajouter comme URI de redirection autorisée `https://VOTRE-WORKER.workers.dev/api/youtube/oauth/callback`. Le `FRONTEND_URL` du Worker doit pointer vers le site Pages.

### Routes diffusions, VPS et administration

| Route | Rôle |
| --- | --- |
| `POST /api/streams` | Crée une diffusion et chiffre la clé RTMP ; la clé n'est jamais renvoyée |
| `POST /api/streams/:id/command` | `start`, `stop`, `pause`, `restart` : écrit l'état voulu, sans prétendre que le direct est actif |
| `DELETE /api/streams/:id` | Supprime une diffusion arrêtée et son secret |
| `POST /api/vps/sync` | Rapport HMAC de l'agent + actions FFmpeg ; URL R2 signée 24 h et RTMP déchiffré à la volée |
| `GET /api/admin/users` | Liste des profils (rôle admin vérifié côté Worker) |
| `PATCH /api/admin/users/:id` | Modification des quotas et du rôle (auto-rétrogradation refusée) |
| `GET /api/admin/streams` | Vue admin des diffusions avec e-mail du propriétaire |
| `POST /api/admin/streams/:id/force-stop` | Arrêt forcé : le moteur doit quand même confirmer l'arrêt réel |

## VPSFree

Voir [`vps/README.md`](vps/README.md). L'agent n'écoute aucun port : il contacte le Worker en HTTPS avec une signature HMAC et s'arrête proprement sur `SIGTERM`. Le moteur `vps/engine.py` lance FFmpeg sans shell, en `stream copy`, avec un UUID par diffusion, des limites systemd et des journaux redactés. Un statut `live` n'est rapporté qu'après confirmation de la sortie par FFmpeg et avec un heartbeat à chaque synchronisation.

## Sécurité

- RLS activée sur toutes les tables de données utilisateur.
- Secrets YouTube et clés RTMP chiffrés AES-GCM côté Worker, jamais exposés au frontend ; les colonnes secrètes n'ont aucune politique `SELECT`.
- JWT vérifié cryptographiquement (JWKS Supabase), pas seulement décodé.
- Limites de débit via KV Cloudflare.
- Validation Zod de toutes les entrées ; types MIME et tailles des vidéos vérifiés avant finalisation.
- Agent VPS sans API entrante ; HMAC + horodatage sur les échanges Worker ↔ VPS.
- URL RTMP et URL R2 signée absentes des journaux : masquage systématique avant écriture, y compris dans les messages renvoyés au Worker.
- `pause` suspend le processus FFmpeg (`SIGSTOP`) : YouTube peut considérer la session comme interrompue. `restart` crée une nouvelle exécution avec une URL R2 fraîche.
- `ProtectProc=invisible`, `NoNewPrivileges`, `PrivateTmp` et limites CPU/RAM dans l'unité systemd.

## Limitations actuelles

- Aucun déploiement ni achat n'a été effectué : les services distants doivent être configurés manuellement avec les instructions ci-dessus.
- L'URL R2 signée fournie au moteur est valable 24 h. Au-delà, l'agent rapporte une erreur et le Worker reprogramme automatiquement une nouvelle exécution tant que l'utilisateur n'a pas demandé l'arrêt.
- Le transcodage n'est pas utilisé : seuls les formats compatibles FLV (MP4/H.264/AAC principalement) peuvent être diffusés en `stream copy`. WebM/MKV/MOV peuvent nécessiter un transcodage à ajouter selon le profil VPS.
