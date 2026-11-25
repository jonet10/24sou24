import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import stream24_agent as agent  # noqa: E402


class LoadConfigTests(unittest.TestCase):
    def test_missing_configuration_fails_closed(self):
        with self.assertRaises(agent.ConfigurationError) as ctx:
            agent.load_config({})
        self.assertIn("STREAM24_API_URL", str(ctx.exception))

    def test_https_is_required(self):
        with self.assertRaises(agent.ConfigurationError):
            agent.load_config(
                {
                    "STREAM24_API_URL": "http://api.example.com",
                    "STREAM24_VPS_ID": "vps-01",
                    "STREAM24_VPS_SECRET": "secret",
                }
            )

    def test_valid_configuration(self):
        config = agent.load_config(
            {
                "STREAM24_API_URL": "https://api.example.com/",
                "STREAM24_VPS_ID": "vps-01",
                "STREAM24_VPS_SECRET": "secret",
                "STREAM24_POLL_SECONDS": "7",
            }
        )
        self.assertEqual(config["api_url"], "https://api.example.com")
        self.assertEqual(config["poll_seconds"], 7)


class SignatureTests(unittest.TestCase):
    def test_headers_are_deterministic(self):
        config = {"secret": "secret", "vps_id": "vps-01"}
        body = b'{"a":1}'
        first = agent.build_headers(config, body, timestamp=1_700_000_000)
        second = agent.build_headers(config, body, timestamp=1_700_000_000)
        self.assertEqual(first, second)
        self.assertEqual(first["X-VPS-Timestamp"], "1700000000")
        self.assertEqual(len(first["X-VPS-Signature"]), 64)
        self.assertNotIn("secret", str(first.values()))

    def test_signature_changes_with_body(self):
        config = {"secret": "secret", "vps_id": "vps-01"}
        a = agent.build_headers(config, b"a", timestamp=1)
        b = agent.build_headers(config, b"b", timestamp=1)
        self.assertNotEqual(a["X-VPS-Signature"], b["X-VPS-Signature"])


if __name__ == "__main__":
    unittest.main()
