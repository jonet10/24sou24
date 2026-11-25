#!/usr/bin/env python3
"""Agent STREAM24 pour VPSFree.

L'agent n'écoute aucun port : il interroge le Worker en HTTPS avec une signature HMAC,
rapporte l'état réel de FFmpeg et exécute les actions renvoyées par le Worker.
Tous les secrets sont masqués avant journalisation.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any

from engine import StreamEngine, redact

AGENT_VERSION = "0.2.0"
REQUIRED_ENV = ("STREAM24_API_URL", "STREAM24_VPS_ID", "STREAM24_VPS_SECRET")
LOGGER = logging.getLogger("stream24-agent")


class ConfigurationError(RuntimeError):
    """Levée lorsqu'une configuration obligatoire manque."""


def load_config(environ: dict[str, str] | None = None) -> dict[str, Any]:
    env = environ if environ is not None else dict(os.environ)
    missing = [name for name in REQUIRED_ENV if not env.get(name)]
    if missing:
        raise ConfigurationError(
            "Configuration manquante : " + ", ".join(missing) + ". Aucune diffusion ne peut démarrer."
        )

    api_url = env["STREAM24_API_URL"].rstrip("/")
    if not api_url.startswith("https://") and "localhost" not in api_url:
        raise ConfigurationError("STREAM24_API_URL doit utiliser HTTPS (sauf en développement local).")

    try:
        poll_seconds = max(1, int(env.get("STREAM24_POLL_SECONDS", "5")))
    except ValueError as exc:
        raise ConfigurationError("STREAM24_POLL_SECONDS doit être un entier.") from exc

    return {
        "api_url": api_url,
        "vps_id": env["STREAM24_VPS_ID"],
        "secret": env["STREAM24_VPS_SECRET"],
        "poll_seconds": poll_seconds,
    }


def build_headers(config: dict[str, Any], body: bytes, timestamp: int | None = None) -> dict[str, str]:
    """Signe `timestamp.corps` avec le secret partagé. Le secret n'est jamais journalisé."""
    import hashlib
    import hmac

    stamp = int(time.time()) if timestamp is None else timestamp
    signature = hmac.new(
        config["secret"].encode("utf-8"),
        f"{stamp}.".encode("utf-8") + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-VPS-ID": config["vps_id"],
        "X-VPS-Timestamp": str(stamp),
        "X-VPS-Signature": signature,
        "User-Agent": f"stream24-agent/{AGENT_VERSION}",
    }


def sync(config: dict[str, Any], engine: StreamEngine | None = None) -> dict[str, Any]:
    """Envoie l'état réel du moteur au Worker et récupère les actions à exécuter."""
    active_engine = engine or StreamEngine()
    payload = json.dumps(
        {
            "vps_id": config["vps_id"],
            "agent_version": AGENT_VERSION,
            "engine_available": active_engine.available,
            "streams": active_engine.report(),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{config['api_url']}/api/vps/sync",
        data=payload,
        headers=build_headers(config, payload),
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Worker a répondu HTTP {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("Worker injoignable (réseau/TLS).") from exc

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Réponse Worker invalide (JSON attendu).") from exc
    if not isinstance(result, dict):
        raise RuntimeError("Réponse Worker inattendue.")
    return result


def apply_actions(response: dict[str, Any], engine: StreamEngine) -> int:
    """Applique les actions du Worker sans jamais journaliser les URL ni les clés."""
    actions = response.get("actions")
    if not isinstance(actions, list):
        return 0
    applied = 0
    for action in actions:
        if not isinstance(action, dict):
            continue
        LOGGER.info(
            "Commande reçue : %s pour la diffusion %s.",
            redact(str(action.get("type", "inconnue"))),
            redact(str(action.get("streamId", "inconnue"))),
        )
        engine.apply(action)
        applied += 1
    return applied


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        config = load_config()
    except ConfigurationError as exc:
        LOGGER.error("%s", exc)
        return 2

    engine = StreamEngine(logger=LOGGER)
    if not engine.available:
        LOGGER.error("FFmpeg est absent : aucun moteur disponible, aucune diffusion ne sera annoncée en direct.")
    else:
        LOGGER.info("Moteur FFmpeg détecté : les états seront confirmés par le processus.")

    stop = threading.Event()

    def handle_signal(_signum: int, _frame: Any) -> None:
        LOGGER.info("Signal d'arrêt reçu, terminaison propre en cours.")
        stop.set()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    LOGGER.info("Agent STREAM24 %s démarré pour %s.", AGENT_VERSION, config["vps_id"])

    delay = config["poll_seconds"]
    while not stop.is_set():
        try:
            response = sync(config, engine)
            apply_actions(response, engine)
            delay = config["poll_seconds"]
        except RuntimeError as exc:
            LOGGER.warning("Synchronisation impossible : %s", exc)
            delay = min(60, max(config["poll_seconds"], delay * 2))
        stop.wait(delay)

    engine.shutdown()
    LOGGER.info("Agent arrêté.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
