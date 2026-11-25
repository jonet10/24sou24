import os
import queue
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import engine  # noqa: E402
import stream24_agent as agent  # noqa: E402

STREAM_ID = "11111111-1111-4111-8111-111111111111"
RUN_ID = "22222222-2222-4222-8222-222222222222"
SOURCE = "https://123.r2.cloudflarestorage.com/bucket/video.mp4?X-Amz-Signature=abcdef"
RTMP = "rtmp://a.rtmp.youtube.com/live2/cle-secrete-de-diffusion"


class FakeStderr:
    def __init__(self):
        self._queue = queue.Queue()

    def put(self, line):
        self._queue.put(line)

    def close(self):
        self._queue.put(None)

    def __iter__(self):
        while True:
            line = self._queue.get()
            if line is None:
                return
            yield line


class FakeProcess:
    def __init__(self):
        self.pid = 4242
        self.stderr = FakeStderr()
        self.exit_code = None
        self.last_signal = None

    def poll(self):
        return self.exit_code

    def send_signal(self, sig):
        self.last_signal = sig
        if sig in (engine.SIGTERM, engine.SIGKILL):
            self.exit_code = 0
            self.stderr.close()

    def wait(self, timeout=None):
        return self.exit_code


def start_action():
    return {
        "type": "start",
        "streamId": STREAM_ID,
        "runId": RUN_ID,
        "sourceUrl": SOURCE,
        "rtmpUrl": RTMP,
        "loop": True,
    }


def make_engine(process):
    clock = [1000.0]
    return engine.StreamEngine(
        popen_factory=lambda argv, secrets: process,
        stats_reader=lambda pid: (100, 128.5),
        now=lambda: clock[0],
    )


class RedactionTests(unittest.TestCase):
    def test_masks_secrets_signature_and_rtmp(self):
        message = f"ffmpeg {RTMP} -> {SOURCE} jeton=cle-secrete-de-diffusion"
        patterns = engine.redact(message)
        self.assertNotIn("cle-secrete-de-diffusion", patterns)
        self.assertNotIn("abcdef", patterns)
        self.assertIn("[URL RTMP masquée]", patterns)
        self.assertIn("[signature masquée]", patterns)

        exact = engine.redact(message, [SOURCE, RTMP])
        self.assertNotIn("cle-secrete-de-diffusion", exact)
        self.assertNotIn("abcdef", exact)

    def test_build_command_has_no_shell_and_loops(self):
        command = engine.build_ffmpeg_command(SOURCE, RTMP, loop=True)
        self.assertEqual(command[0], "ffmpeg")
        self.assertIn("-stream_loop", command)
        self.assertEqual(command[command.index("-stream_loop") + 1], "-1")
        self.assertEqual(command[-1], RTMP)
        self.assertIn("-c", command)
        self.assertEqual(command[command.index("-c") + 1], "copy")
        single_pass = engine.build_ffmpeg_command(SOURCE, RTMP, False)
        self.assertEqual(single_pass[single_pass.index("-stream_loop") + 1], "0")


class ValidationTests(unittest.TestCase):
    def test_accepts_valid_actions(self):
        self.assertEqual(engine.validate_action(start_action())["type"], "start")
        self.assertEqual(
            engine.validate_action({"type": "stop", "streamId": STREAM_ID, "runId": RUN_ID})["type"],
            "stop",
        )

    def test_rejects_unsafe_actions(self):
        self.assertIsNone(engine.validate_action({"type": "restart", "streamId": STREAM_ID, "runId": RUN_ID, "sourceUrl": "http://x", "rtmpUrl": RTMP}))
        self.assertIsNone(engine.validate_action({**start_action(), "streamId": "pas-un-uuid"}))
        self.assertIsNone(engine.validate_action({**start_action(), "type": "supprimer"}))
        self.assertIsNone(engine.validate_action(None))

    def test_ffmpeg_absent_means_engine_unavailable(self):
        with mock.patch.object(engine.shutil, "which", return_value=None):
            self.assertFalse(engine.ffmpeg_available())
            self.assertFalse(engine.StreamEngine().available)


class EngineLifecycleTests(unittest.TestCase):
    def test_live_is_reported_only_after_ffmpeg_confirms_output(self):
        process = FakeProcess()
        stream = make_engine(process)
        stream.start(start_action())

        first = stream.report()
        self.assertEqual(first[0]["status"], "starting")

        process.stderr.put("Output #0, flv, to 'rtmp://secret':")
        deadline = time.monotonic() + 1
        while not stream._streams[STREAM_ID].ready.is_set() and time.monotonic() < deadline:
            time.sleep(0.01)

        report = stream.report()
        self.assertEqual(report[0]["status"], "live")
        self.assertNotIn("secret", report[0]["message"])
        self.assertEqual(report[0]["memory_mb"], 128.5)

    def test_pause_stop_and_no_duplicate_stopped_report(self):
        process = FakeProcess()
        stream = make_engine(process)
        stream.start(start_action())
        process.stderr.put("Output #0, flv")
        deadline = time.monotonic() + 1
        while not stream._streams[STREAM_ID].ready.is_set() and time.monotonic() < deadline:
            time.sleep(0.01)

        stream.apply({"type": "pause", "streamId": STREAM_ID, "runId": RUN_ID})
        self.assertEqual(stream.report()[0]["status"], "paused")
        self.assertEqual(process.last_signal, engine.SIGSTOP)

        stream.apply({"type": "stop", "streamId": STREAM_ID, "runId": RUN_ID})
        stopped = stream.report()
        self.assertEqual(stopped[0]["status"], "stopped")
        self.assertEqual(stream.report(), [])

    def test_unexpected_exit_is_an_error(self):
        process = FakeProcess()
        stream = make_engine(process)
        stream.start(start_action())
        process.exit_code = 1
        process.stderr.close()

        report = stream.report()
        self.assertEqual(report[0]["status"], "error")
        self.assertEqual(report[1]["status"], "stopped")


class AgentSyncTests(unittest.TestCase):
    def test_payload_reports_engine_state_without_secrets(self):
        config = {
            "api_url": "https://api.example.com",
            "vps_id": "vps-01",
            "secret": "partage",
        }
        captured = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return b'{"status":"ok","actions":[]}'

        def fake_urlopen(request, timeout):
            captured["body"] = request.data
            captured["headers"] = request.headers
            return FakeResponse()

        process = FakeProcess()
        stream = make_engine(process)
        with mock.patch.object(agent.urllib.request, "urlopen", side_effect=fake_urlopen):
            result = agent.sync(config, stream)

        payload = captured["body"].decode("utf-8")
        self.assertEqual(result["status"], "ok")
        self.assertIn("engine_available", payload)
        self.assertNotIn("partage", payload)
        signature = captured["headers"].get("X-vps-signature") or captured["headers"].get("X-VPS-Signature")
        self.assertIsNotNone(signature)
        self.assertEqual(len(signature), 64)


if __name__ == "__main__":
    unittest.main()
