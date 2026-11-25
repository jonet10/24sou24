# STREAM24 — Architecture technique

## 1. Analyse du dossier initial

- Dossier de départ : vide (aucun `package.json`, aucun dépôt Git, aucun fichier source).
- Environnement local détecté : Node.js v24.15.0, npm 11.12.1, Git 2.54.0, Windows.
- Aucune contrainte héritée d'un code existant : nous partons donc d'un monorepo propre.

## 2. Vérification de compatibilité (faite avant création)

Cloudflare a publié une documentation actualisée en 2026 :

| Option | Verdict | Choix STREAM24 |
| --- | --- | --- |
| Next.js SSR via **vinext** sur Workers | Recommandé par Cloudflare pour du SSR, mais `beta` | Non retenu (infrastructure imposée = Pages) |
| Next.js + **OpenNext** sur Workers | Supporté, surtout pour migrer une app existante | Non retenu (API Worker déjà séparée) |
| Next.js **static export** (`output: "export"`) sur Cloudflare Pages | Officiellement supporté, preset *Next.js (Static HTML Export)*, répertoire `out` | **Retenu** |

Sources : `https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/` et `https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/`.

### Conséquence importante

Le frontend est **statique** : il n'exécute aucun code serveur Next.js et ne contient **aucune clé secrète**. Toute opération sensible (upload R2, OAuth Google, commandes FFmpeg, lecture de secrets, administrateur) passe par le Worker `apps/worker`, qui vérifie le JWT Supabase et applique les politiques RLS avec le jeton de l'utilisateur.

## 3. Vue d'ensemble

```text
                    ┌──────────────────────────────┐
 Navigateur ───────▶│ Cloudflare Pages (Next.js)   │
 (utilisateur)      │ UI statique, Supabase JS     │
                    └──────┬───────────────┬───────┘
                           │ JWT           │ HTTPS + Bearer JWT
                           ▼               ▼
                    ┌─────────────┐  ┌──────────────────────────┐
                    │  Supabase   │  │ Cloudflare Worker (API)  │
                    │ Auth + DB   │◀─┤ validation JWT, RLS,     │
                    │ RLS         │  │ quotas, R2, OAuth, VPS   │
                    └─────────────┘  └───────┬──────────┬───────┘
                                            │          │
                                     presigned│         │ HTTPS HMAC
                                            ▼          ▼
                                     ┌──────────┐  ┌──────────────┐
                                     │ Cloudflare│  │ VPSFree      │
                                     │ R2 bucket │  │ agent FFmpeg │
                                     └──────────┘  └──────┬───────┘
                                            ▲             │ RTMP/SRT
                                            └── URL signée │
                                                          ▼
                                                  YouTube Live (RTMP)
```

### Flux de diffusion (sans simulation)

1. L'utilisateur crée une diffusion avec vidéo, chaîne, clé de diffusion et planification.
2. Le Worker chiffre la clé de diffusion et la stocke dans une table sans droit `SELECT` pour les utilisateurs.
3. L'utilisateur clique sur **Démarrer** : le Worker écrit seulement `desired_status = starting`.
4. L'agent VPS, seul à initier la connexion (aucun port ouvert, aucun API FFmpeg publique), interroge `POST /api/vps/sync` avec son secret HMAC.
5. Le Worker lui renvoie les actions à exécuter avec une URL R2 signée et la clé RTMP déchiffrée à la volée.
6. L'agent lance `ffmpeg` avec une liste d'arguments (jamais de shell), un UUID par exécution, des limites systemd, un timeout de confirmation (60 s) et un redémarrage contrôlé.
7. Le statut `live` n'est rapporté qu'après détection d'une ligne de sortie FFmpeg confirmée (`Output #0`, connexion ouverte). L'agent rapporte `reported_status`, les métriques CPU/mémoire et les erreurs au Worker à chaque synchronisation.
8. Le frontend n'affiche **« En direct »** que si un heartbeat FFmpeg récent (< 30 s) confirme le statut `live`. Sans confirmation : `Erreur`, `Démarrage` ou `En attente`, jamais `En direct`.

La boucle est auto-réparatrice : si FFmpeg se termine de façon inattendue, l'agent rapporte `error` puis `stopped` ; tant que `desired_status` reste différent de `stopped`, le Worker reprogramme une exécution avec une URL R2 fraîche. Les minutes de diffusion sont comptabilisées une seule fois par `engine_run_id`.

## 4. Découpage du monorepo

```text
24SOU24/
├── apps/
│   ├── web/       Next.js statique (Pages) — UI française, thème sombre
│   └── worker/    Cloudflare Worker TypeScript — API sécurisée
├── packages/
│   └── shared/    Types et schémas Zod partagés
├── supabase/
│   └── migrations/ SQL + RLS
├── vps/           Agent Linux/Python + moteur FFmpeg + unité systemd
├── docs/          Architecture, runbooks
└── README.md
```

## 5. Sécurité appliquée

- **Frontend** : uniquement `NEXT_PUBLIC_*` (URL Supabase, clé anon, URL Worker). Aucune clé secrète, aucune clé de diffusion.
- **Worker** : vérification du JWT via JWKS Supabase, exploitations avec le jeton utilisateur (RLS active) ; élévation de privilèges uniquement pour les tables de secrets et l'administration, après vérification du rôle.
- **Secrets YouTube / clés RTMP** : chiffrés AES-GCM côté Worker avec `SECRETS_ENCRYPTION_KEY`, stockés dans des tables sans politique `SELECT` pour `authenticated`.
- **R2** : URLs de PUT signées AWS SigV4 côté Worker, URLs de lecture signées HMAC de courte durée ; validation MIME/taille avant finalisation.
- **VPS ↔ Worker** : HMAC sur corps + horodatage, secret partagé, horloge tolérée ±5 min ; l'agent n'écoute aucun port.
- **Limites de débit** : KV Cloudflare (avec repli mémoire en développement) sur les routes sensibles.
- **Isolation** : chaque requête filtre par `user_id` ; toutes les tables utilisateur ont RLS ; les administrateurs sont explicitement vérifiés.

## 6. Étapes de développement

| Phase | Contenu | État |
| --- | --- | --- |
| 0 | Analyse + compatibilité framework | ✅ |
| 1 | Structure du monorepo, design system, auth (inscription/connexion/déconnexion/récupération), tableau de bord protégé | ✅ |
| 2 | Supabase : migrations SQL complètes, RLS, profils, quotas | ✅ |
| 3 | API Worker : santé, JWT, profils, erreurs de configuration, rate limit | ✅ (socle) |
| 4 | R2 : URLs signées SigV4, validation des imports, aperçu HMAC, suppression des vidéos | ✅ |
| 5 | OAuth Google : connexion/révocation des chaînes, jetons chiffrés AES-GCM | ✅ |
| 6 | Diffusions : création, commandes, états réels, historique, minutes consommées | ✅ |
| 7 | Administration : utilisateurs, diffusions, quotas | ✅ |
| 8 | Agent VPSFree FFmpeg : service systemd, isolation UUID, limites, logs redactés | ✅ |
| 9 | Tests, README, procédures de déploiement | ✅ (local) |

> Aucune diffusion n'est simulée. Si Supabase, R2, le VPS ou YouTube ne sont pas configurés, l'interface et l'API renvoient une erreur de configuration explicite.
