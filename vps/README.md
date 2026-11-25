# STREAM24 — agent VPSFree + moteur FFmpeg

Ce dossier contient l'agent Python exécuté sur le VPS Ubuntu/Debian. Il **n'écoute aucun port** : il initie des requêtes HTTPS signées vers le Worker et exécute les actions renvoyées.

## Fonctionnalités

- ✅ Aucun port d'écoute : toutes les connexions sont initiées vers le Worker.
- ✅ Authentification HMAC (secret partagé + horodatage, tolérance ±5 min) sur `/api/vps/sync`.
- ✅ Moteur FFmpeg (`engine.py`) : `stream copy`, boucle `-stream_loop -1`, un UUID par exécution, aucun shell.
- ✅ État honnête : `live` uniquement après confirmation de sortie par FFmpeg ; `starting` sinon ; heartbeat à chaque cycle.
- ✅ Commandes `start`, `stop`, `pause` (SIGSTOP) et `restart` (nouvelle exécution avec URL R2 fraîche).
- ✅ Arrêt propre sur SIGTERM, backoff en cas d'erreur réseau, redémarrage automatique par systemd.
- ✅ Journaux redactés : URL RTMP, signature R2 et jetons longs sont masqués avant écriture et avant renvoi au Worker.
- ✅ Échec explicite si configuration ou FFmpeg absent : aucun démarrage simulé.

## Configuration

Installer FFmpeg puis copier `.env.example` et renseigner les valeurs sur le VPS (fichier `/etc/stream24/agent.env`, mode `0600`) :

```sh
sudo apt-get update && sudo apt-get install -y ffmpeg python3
STREAM24_API_URL=https://api.votre-domaine.example
STREAM24_VPS_ID=vps-free-01
STREAM24_VPS_SECRET=secret-partage-worker-vps
STREAM24_POLL_SECONDS=5
```

## Service systemd

```sh
sudo useradd --system --home /var/lib/stream24 --shell /usr/sbin/nologin stream24
sudo mkdir -p /etc/stream24 /opt/stream24 /var/lib/stream24 /var/log/stream24
sudo cp vps/stream24_agent.py vps/engine.py /opt/stream24/
sudo cp vps/stream24-agent.service /etc/systemd/system/stream24-agent.service
sudo chmod 600 /etc/stream24/agent.env
sudo systemctl daemon-reload
sudo systemctl enable --now stream24-agent
sudo journalctl -u stream24-agent -f
```

L'unité applique `NoNewPrivileges`, `PrivateTmp`, `ProtectProc=invisible`, `RestrictSUIDSGID`, `ProtectSystem=strict` et des limites CPU/RAM.

## Tests

```sh
py -3 -m unittest discover -s vps/tests -v
```

Les tests utilisent un processus FFmpeg simulé : aucun flux réel n'est lancé localement.

## Limites

- Le `stream copy` suppose un format compatible FLV (MP4/H.264/AAC). Le transcodage n'est pas encore implémenté.
- `pause` suspend le processus : YouTube peut interrompre la session ; `restart` est le moyen fiable de reprendre.
- L'URL R2 signée dure 24 h ; au-delà, l'agent rapporte une erreur et le Worker relance une exécution avec une nouvelle URL.
