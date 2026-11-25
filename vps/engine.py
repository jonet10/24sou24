"""Moteur de diffusion FFmpeg de l'agent STREAM24.

Aucun secret n'est journalisé : les URL RTMP, les URL R2 signées et les jetons
sont masqués avant écriture dans les logs. L'agent n'écoute aucun port entrant ;
les commandes arrivent exclusivement par la réponse HTTPS signée du Worker.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

LOGGER = logging.getLogger("stream24-agent")

_RTMP_PATTERN = re.compile(r"rtmp(?:s|te|tps)?://[^\s'\"\\]+", re.IGNORECASE)
_SIGNATURE_PATTERN = re.compile(r"(X-Amz-Signature=)[0-9a-fA-F]+")
_LONG_TOKEN_PATTERN = re.compile(r"\b[A-Za-z0-9_-]{24,}\b")
_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)
_READY_MARKERS = ("output #0", "connected to", "opening connection", "handshake")
_STARTUP_TIMEOUT_SECONDS = 60

# L'agent cible Linux ; les valeurs de repli rendent les tests importables sur Windows.
SIGSTOP = getattr(signal, "SIGSTOP", 19)
SIGTERM = getattr(signal, "SIGTERM", 15)
SIGKILL = getattr(signal, "SIGKILL", 9)


def _sysconf(name: str, fallback: int) -> int:
    sysconf = getattr(os, "sysconf", None)
    if sysconf is None:
        return fallback
    try:
        return int(sysconf(name))
    except (OSError, ValueError):
        return fallback


CLK_TCK = _sysconf("SC_CLK_TCK", 100)


def redact(message: str, secrets: Iterable[str] = ()) -> str:
    """Masque les secrets connus puis les motifs d'URL et de jetons."""
    result = message
    for secret in secrets:
        if secret:
            result = result.replace(secret, "[secret masqué]")
    result = _RTMP_PATTERN.sub("[URL RTMP masquée]", result)
    result = _SIGNATURE_PATTERN.sub(r"\1[signature masquée]", result)
    return _LONG_TOKEN_PATTERN.sub("[secret masqué]", result)


def ffmpeg_available() -> bool:
    """Un binaire FFmpeg absent signifie : aucun moteur, aucune diffusion annoncée."""
    return shutil.which("ffmpeg") is not None


def build_ffmpeg_command(source_url: str, rtmp_url: str, loop: bool = True) -> list[str]:
    """Construit une commande sans shell : aucun secret n'est interpolé dans un script."""
    return [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "info",
        "-re",
        "-stream_loop",
        "-1" if loop else "0",
        "-i",
        source_url,
        "-c",
        "copy",
        "-f",
        "flv",
        rtmp_url,
    ]


def _is_uuid(value: Any) -> bool:
    if not isinstance(value, str) or not _UUID_PATTERN.fullmatch(value):
        return False
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def validate_action(action: Any) -> dict[str, Any] | None:
    """Valide une action du Worker avant tout effet local."""
    if not isinstance(action, dict):
        return None
    action_type = action.get("type")
    if action_type not in ("start", "restart", "stop", "pause"):
        return None
    if not _is_uuid(action.get("streamId")):
        return None
    if action_type in ("start", "restart"):
        if not _is_uuid(action.get("runId")):
            return None
        source = action.get("sourceUrl")
        rtmp = action.get("rtmpUrl")
        if not isinstance(source, str) or not source.startswith("https://"):
            return None
        if not isinstance(rtmp, str) or not rtmp.startswith("rtmp://"):
            return None
        return {
            "type": action_type,
            "streamId": action["streamId"],
            "runId": action["runId"],
            "sourceUrl": source,
            "rtmpUrl": rtmp,
            "loop": bool(action.get("loop", True)),
        }
    run_id = action.get("runId")
    return {
        "type": action_type,
        "streamId": action["streamId"],
        "runId": run_id if _is_uuid(run_id) else None,
    }


def sample_process_stats(pid: int) -> tuple[int | None, float | None]:
    """Lit /proc sans dépendance externe. Retourne (ticks CPU, mémoire Mo)."""
    try:
        with open(f"/proc/{pid}/stat", encoding="ascii") as handle:
            stat = handle.read()
        fields = stat[stat.rfind(")") + 2 :].split()
        cpu_ticks = int(fields[11]) + int(fields[12])
        with open(f"/proc/{pid}/statm", encoding="ascii") as handle:
            rss_pages = int(handle.read().split()[1])
        return cpu_ticks, round(rss_pages * _sysconf("SC_PAGE_SIZE", 4096) / 1024 / 1024, 1)
    except (OSError, ValueError, IndexError):
        return None, None


@dataclass
class ManagedStream:
    stream_id: str
    run_id: str
    process: Any
    started_at: float
    secrets: tuple[str, ...] = ()
    ready: threading.Event = field(default_factory=threading.Event)
    paused: bool = False
    stopped_by_agent: bool = False
    last_message: str = ""
    last_cpu_ticks: int | None = None
    last_sample_at: float = 0.0


class StreamEngine:
    """Gère les processus FFmpeg locaux et produit les rapports envoyés au Worker."""

    def __init__(
        self,
        *,
        popen_factory: Callable[..., Any] | None = None,
        stats_reader: Callable[[int], tuple[int | None, float | None]] | None = None,
        logger: logging.Logger | None = None,
        now: Callable[[], float] | None = None,
    ) -> None:
        self._popen = popen_factory or self._default_popen
        self._stats = stats_reader or sample_process_stats
        self._logger = logger or LOGGER
        self._now = now or time.monotonic
        self._streams: dict[str, ManagedStream] = {}
        self._finished: list[tuple[str, str, str]] = []
        self._available = ffmpeg_available()

    @property
    def available(self) -> bool:
        return self._available

    @staticmethod
    def _default_popen(argv: list[str]) -> Any:
        return subprocess.Popen(
            argv,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            start_new_session=True,
        )

    def _drain(self, managed: ManagedStream) -> None:
        stderr = getattr(managed.process, "stderr", None)
        if stderr is None:
            return
        try:
            for line in stderr:
                cleaned = redact(line.rstrip(), managed.secrets).strip()
                if not cleaned:
                    continue
                managed.last_message = cleaned[:400]
                if any(marker in cleaned.lower() for marker in _READY_MARKERS):
                    managed.ready.set()
                self._logger.debug("FFmpeg %s : %s", managed.stream_id, cleaned)
        except (OSError, ValueError):
            pass

    @staticmethod
    def _signal(managed: ManagedStream, sig: int) -> None:
        process = managed.process
        try:
            os.killpg(os.getpgid(process.pid), sig)
            return
        except (OSError, AttributeError, ProcessLookupError):
            pass
        try:
            process.send_signal(sig)
        except (OSError, AttributeError, ProcessLookupError):
            pass

    def _terminate(self, managed: ManagedStream) -> None:
        managed.stopped_by_agent = True
        self._signal(managed, SIGTERM)
        try:
            managed.process.wait(timeout=5)
        except (OSError, AttributeError, subprocess.TimeoutExpired):
            self._signal(managed, SIGKILL)

    def start(self, action: dict[str, Any]) -> None:
        """Démarre (ou redémarre) une diffusion. Les URL ne sont jamais journalisées."""
        stream_id = action["streamId"]
        run_id = action["runId"]
        existing = self._streams.pop(stream_id, None)
        if existing:
            self._terminate(existing)

        argv = build_ffmpeg_command(action["sourceUrl"], action["rtmpUrl"], action["loop"])
        secrets = (action["sourceUrl"], action["rtmpUrl"])
        try:
            process = self._popen(argv, secrets)
        except (OSError, subprocess.SubprocessError) as exc:
            self._finished.append((stream_id, run_id, f"Impossible de lancer FFmpeg : {redact(str(exc), secrets)}"))
            self._logger.error("Lancement FFmpeg impossible pour %s (run %s).", stream_id, run_id)
            return

        managed = ManagedStream(
            stream_id=stream_id,
            run_id=run_id,
            process=process,
            started_at=self._now(),
            secrets=secrets,
        )
        self._streams[stream_id] = managed
        self._logger.info("FFmpeg démarré pour la diffusion %s (exécution %s).", stream_id, run_id)

        thread = threading.Thread(target=self._drain, args=(managed,), daemon=True)
        thread.start()

    def stop(self, action: dict[str, Any]) -> None:
        managed = self._streams.get(action["streamId"])
        if not managed:
            return
        if action.get("runId") and managed.run_id != action["runId"]:
            return
        self._terminate(managed)
        self._logger.info("Arrêt FFmpeg demandé pour la diffusion %s.", managed.stream_id)

    def pause(self, action: dict[str, Any]) -> None:
        managed = self._streams.get(action["streamId"])
        if not managed or managed.stopped_by_agent or managed.paused:
            return
        if action.get("runId") and managed.run_id != action["runId"]:
            return
        self._signal(managed, SIGSTOP)
        managed.paused = True
        self._logger.info("Pause FFmpeg appliquée à la diffusion %s.", managed.stream_id)

    def report(self) -> list[dict[str, Any]]:
        """Produit un rapport Honnête : « live » uniquement si FFmpeg a confirmé sa sortie."""
        reports: list[dict[str, Any]] = []
        current_time = self._now()

        for stream_id, managed in list(self._streams.items()):
            exit_code = managed.process.poll()
            if exit_code is not None:
                del self._streams[stream_id]
                if managed.stopped_by_agent:
                    self._finished.append((stream_id, managed.run_id, "Arrêt confirmé par FFmpeg."))
                else:
                    message = redact(
                        managed.last_message or f"FFmpeg terminé inopinément (code {exit_code}).",
                        managed.secrets,
                    )
                    reports.append(
                        {
                            "id": stream_id,
                            "run_id": managed.run_id,
                            "status": "error",
                            "message": message[:500],
                        }
                    )
                    self._finished.append((stream_id, managed.run_id, "Fin anormale confirmée par FFmpeg."))
                continue

            stats = self._stats(getattr(managed.process, "pid", -1))
            cpu_ticks, memory_mb = stats if stats else (None, None)
            cpu_percent: float | None = None
            elapsed = current_time - managed.last_sample_at
            if managed.last_cpu_ticks is not None and cpu_ticks is not None and elapsed > 0:
                delta = max(0, cpu_ticks - managed.last_cpu_ticks)
                cpu_percent = min(100.0, round(delta / CLK_TCK / elapsed * 100, 1))
            managed.last_cpu_ticks = cpu_ticks
            managed.last_sample_at = current_time

            if managed.paused:
                status = "paused"
                message = "Processus FFmpeg suspendu (SIGSTOP)."
            elif managed.ready.is_set():
                status = "live"
                message = managed.last_message or "Sortie FFmpeg confirmée."
            elif current_time - managed.started_at > _STARTUP_TIMEOUT_SECONDS:
                self._terminate(managed)
                del self._streams[stream_id]
                reports.append(
                    {
                        "id": stream_id,
                        "run_id": managed.run_id,
                        "status": "error",
                        "message": "FFmpeg n'a pas confirmé sa sortie dans les 60 secondes.",
                    }
                )
                self._finished.append((stream_id, managed.run_id, "Connexion FFmpeg non confirmée."))
                continue
            else:
                status = "starting"
                message = managed.last_message or "Démarrage FFmpeg en cours, connexion non confirmée."

            reports.append(
                {
                    "id": stream_id,
                    "run_id": managed.run_id,
                    "status": status,
                    "message": redact(message, managed.secrets)[:500],
                    "cpu_percent": cpu_percent,
                    "memory_mb": memory_mb,
                }
            )

        while self._finished:
            stream_id, run_id, message = self._finished.pop(0)
            reports.append(
                {
                    "id": stream_id,
                    "run_id": run_id,
                    "status": "stopped",
                    "message": redact(message),
                }
            )
        return reports

    def apply(self, action: Any) -> None:
        validated = validate_action(action)
        if not validated:
            self._logger.warning("Action Worker refusée (format invalide).")
            return
        action_type = validated["type"]
        try:
            if action_type in ("start", "restart"):
                self.start(validated)
            elif action_type == "stop":
                self.stop(validated)
            elif action_type == "pause":
                self.pause(validated)
        except Exception as exc:  # un échec local ne doit jamais arrêter la boucle de synchronisation
            self._logger.error("Échec de l'action %s : %s", action_type, redact(str(exc)))

    def shutdown(self) -> None:
        for managed in list(self._streams.values()):
            self._terminate(managed)
            self._finished.append((managed.stream_id, managed.run_id, "Agent arrêté, diffusion interrompue."))
        self._streams.clear()
