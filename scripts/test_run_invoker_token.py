"""Tests for scripts/run_invoker_token.py (#3733).

Run: python3 -m unittest scripts.test_run_invoker_token -v   (from repo root)

Two contracts locked here, mirroring scripts/test_iap_token.py's shape but
for a materially simpler mechanism (plain Google ID token from the
metadata server, not a self-signed JWT -- see the module docstring for
why backend uses this instead of native IAP):

1. With nothing configured (no BACKEND_INVOKER_AUDIENCE -- the state for
   the whole repo today), get_invoker_token() must be a pure no-op: no
   HTTP call to the metadata server, no header, no exception.
2. When an audience IS set, the cache behaves like #3731's: reuse within
   a refresh window, re-fetch once past it, fall back to a still-valid
   stale token if a re-fetch attempt fails, give up once the token's own
   `exp` claim has actually passed. Unlike #3731, the expiry isn't a
   constant we chose -- it's decoded from the real token's `exp` claim,
   so these tests build real (unsigned, since we never verify the
   signature) JWT-shaped strings with a controlled `exp` rather than
   mocking an internal constant.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import threading
import unittest
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import run_invoker_token  # noqa: E402


def _fake_id_token(exp: int, aud: str = "https://example.com") -> str:
    """Build a JWT-shaped string with a real, decodable `exp` claim and a
    fake signature segment -- good enough for _decode_exp, which never
    checks the signature (the trust boundary here is the metadata server
    itself, same as the real mechanism).
    """
    header = base64.urlsafe_b64encode(b'{"alg":"RS256"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"aud": aud, "exp": exp}).encode()
    ).rstrip(b"=").decode()
    return f"{header}.{payload}.fake-signature"


class DecodeExp(unittest.TestCase):
    def test_reads_the_exp_claim_without_checking_the_signature(self):
        token = _fake_id_token(exp=1_700_003_600)
        self.assertEqual(run_invoker_token._decode_exp(token), 1_700_003_600)

    def test_handles_unpadded_base64url_payload(self):
        # Base64url without padding is the common real-world shape; this
        # guards against a padding bug that would only show up on some
        # exp values (those whose encoded length isn't a multiple of 4).
        # There are only 3 distinct padding-needed cases (0, 1, 2 -- a
        # valid unpadded base64 length is never congruent to 1 mod 4), so
        # these three exp values were picked by actually computing which
        # ones land on each case (verified: exp=1 -> pad 2, exp=10 ->
        # pad 1, exp=100 -> pad 0) rather than picked by eye, which would
        # have risked several of them silently exercising the same case.
        for exp in (1, 10, 100):
            token = _fake_id_token(exp=exp)
            self.assertEqual(run_invoker_token._decode_exp(token), exp)


class GetInvokerToken(unittest.TestCase):
    def setUp(self):
        run_invoker_token.get_invoker_token.cache_clear()
        self._env_backup = os.environ.pop("BACKEND_INVOKER_AUDIENCE", None)
        self._clock = 1_000_000.0
        self._clock_patch = mock.patch.object(run_invoker_token, "_now", lambda: self._clock)
        self._clock_patch.start()

    def tearDown(self):
        self._clock_patch.stop()
        run_invoker_token.get_invoker_token.cache_clear()
        if self._env_backup is not None:
            os.environ["BACKEND_INVOKER_AUDIENCE"] = self._env_backup

    def test_no_audience_anywhere_is_a_noop(self):
        # Negative control matching today's reality: nobody sets
        # BACKEND_INVOKER_AUDIENCE, so this must never even try to reach
        # the metadata server.
        with mock.patch.object(run_invoker_token, "_fetch_from_metadata_server") as fetch:
            self.assertIsNone(run_invoker_token.get_invoker_token())
            fetch.assert_not_called()

    def test_fetches_and_caches_a_token(self):
        token = _fake_id_token(exp=int(self._clock) + 3600)
        with mock.patch.object(run_invoker_token, "_fetch_from_metadata_server", return_value=token) as fetch:
            first = run_invoker_token.get_invoker_token("https://backend.example.com")
            second = run_invoker_token.get_invoker_token("https://backend.example.com")
        self.assertEqual(first, token)
        self.assertEqual(second, token)
        fetch.assert_called_once_with("https://backend.example.com")

    def test_env_var_is_used_when_no_explicit_audience_passed(self):
        os.environ["BACKEND_INVOKER_AUDIENCE"] = "https://from-env.example.com"
        token = _fake_id_token(exp=int(self._clock) + 3600)
        with mock.patch.object(run_invoker_token, "_fetch_from_metadata_server", return_value=token) as fetch:
            run_invoker_token.get_invoker_token()
        fetch.assert_called_once_with("https://from-env.example.com")

    def test_remints_once_the_refresh_margin_has_passed(self):
        tok1 = _fake_id_token(exp=int(self._clock) + 3600)
        tok2 = _fake_id_token(exp=int(self._clock) + 3600 + 3600)
        with mock.patch.object(
            run_invoker_token, "_fetch_from_metadata_server", side_effect=[tok1, tok2]
        ) as fetch:
            first = run_invoker_token.get_invoker_token("https://example.com")
            self._clock += 2701  # past the 900s refresh margin before a 3600s expiry
            second = run_invoker_token.get_invoker_token("https://example.com")
        self.assertEqual(first, tok1)
        self.assertEqual(second, tok2)
        self.assertEqual(fetch.call_count, 2)

    def test_falls_back_to_the_stale_but_not_yet_expired_token_when_a_refetch_fails(self):
        tok1 = _fake_id_token(exp=int(self._clock) + 3600)
        with mock.patch.object(
            run_invoker_token,
            "_fetch_from_metadata_server",
            side_effect=[tok1, RuntimeError("metadata server unreachable")],
        ):
            first = run_invoker_token.get_invoker_token("https://example.com")
            self._clock += 2701
            second = run_invoker_token.get_invoker_token("https://example.com")
        self.assertEqual(first, tok1)
        self.assertEqual(second, tok1)

    def test_returns_none_once_the_tokens_own_exp_has_actually_passed_and_refetch_fails(self):
        tok1 = _fake_id_token(exp=int(self._clock) + 3600)
        with mock.patch.object(
            run_invoker_token,
            "_fetch_from_metadata_server",
            side_effect=[tok1, RuntimeError("metadata server unreachable")],
        ):
            run_invoker_token.get_invoker_token("https://example.com")
            self._clock += 3601  # past the token's own real exp claim
            second = run_invoker_token.get_invoker_token("https://example.com")
        self.assertIsNone(second)

    def test_evicts_the_stale_cache_entry_once_it_has_actually_expired_and_refetch_fails(self):
        # Separate from the previous test: that one only checks the
        # *return value*; this one checks the cache dict itself was
        # actually cleaned up (not left behind holding a dead entry
        # forever) -- a prior reviewer flagged this as present in the code
        # but unlocked by any test.
        tok1 = _fake_id_token(exp=int(self._clock) + 3600)
        with mock.patch.object(
            run_invoker_token,
            "_fetch_from_metadata_server",
            side_effect=[tok1, RuntimeError("metadata server unreachable")],
        ):
            run_invoker_token.get_invoker_token("https://example.com")
            self.assertIn("https://example.com", run_invoker_token._token_cache)
            self._clock += 3601
            run_invoker_token.get_invoker_token("https://example.com")
        self.assertNotIn("https://example.com", run_invoker_token._token_cache)

    def test_malformed_token_from_metadata_server_is_treated_as_a_failure_not_a_crash(self):
        with mock.patch.object(run_invoker_token, "_fetch_from_metadata_server", return_value="not-a-jwt"):
            self.assertIsNone(run_invoker_token.get_invoker_token("https://example.com"))

    def test_metadata_server_unreachable_returns_none_not_raise(self):
        # The real failure mode off of Cloud Run (local dev, CI runner with
        # no metadata server) -- urlopen raises, must not propagate.
        import urllib.error

        with mock.patch.object(
            run_invoker_token, "_fetch_from_metadata_server", side_effect=urllib.error.URLError("no route")
        ):
            self.assertIsNone(run_invoker_token.get_invoker_token("https://example.com"))

    def test_cache_is_keyed_per_audience(self):
        exp = int(self._clock) + 3600
        with mock.patch.object(
            run_invoker_token,
            "_fetch_from_metadata_server",
            side_effect=lambda aud: _fake_id_token(exp=exp, aud=aud),
        ) as fetch:
            a = run_invoker_token.get_invoker_token("https://a.example.com")
            b = run_invoker_token.get_invoker_token("https://b.example.com")
            a_again = run_invoker_token.get_invoker_token("https://a.example.com")
        self.assertNotEqual(a, b)
        self.assertEqual(a_again, a)
        self.assertEqual(fetch.call_count, 2)


class InvokerHeader(unittest.TestCase):
    def setUp(self):
        run_invoker_token.get_invoker_token.cache_clear()

    def test_no_token_gives_empty_dict(self):
        with mock.patch.object(run_invoker_token, "get_invoker_token", return_value=None):
            self.assertEqual(run_invoker_token.invoker_header("aud"), {})

    def test_token_gives_x_serverless_authorization_not_authorization(self):
        # This is the whole point of this mechanism: the app's own
        # Authorization header must stay untouched.
        with mock.patch.object(run_invoker_token, "get_invoker_token", return_value="tok123"):
            headers = run_invoker_token.invoker_header("aud")
            self.assertEqual(headers, {"X-Serverless-Authorization": "Bearer tok123"})
            self.assertNotIn("Authorization", headers)
            self.assertNotIn("Proxy-Authorization", headers)


class FetchFromMetadataServer(unittest.TestCase):
    def test_sends_the_metadata_flavor_header_and_audience_query_param(self):
        fake_response = mock.MagicMock()
        fake_response.read.return_value = b"the-token\n"
        fake_response.__enter__ = lambda self: fake_response
        fake_response.__exit__ = lambda self, *a: False

        with mock.patch("urllib.request.urlopen", return_value=fake_response) as urlopen:
            token = run_invoker_token._fetch_from_metadata_server("https://backend.example.com")

        self.assertEqual(token, "the-token")
        req = urlopen.call_args[0][0]
        self.assertEqual(req.get_header("Metadata-flavor"), "Google")
        self.assertIn("audience=https://backend.example.com", req.full_url)
        self.assertTrue(req.full_url.startswith("http://metadata.google.internal/"))


class SidecarServer(unittest.TestCase):
    """nginx's `auth_request` directive is the only real caller of this
    server, and it was the one part of this module with no test coverage
    (flagged by review) -- everything else here is a near-identical port
    of the already-reviewed #3731 cache pattern, but this HTTP-handling
    code is new. Binds to port 0 (OS picks a free local port) and makes a
    real HTTP request to it -- that's a real local socket, not a mocked
    one, but it never leaves 127.0.0.1 and never touches GCP.
    """

    def _start_server(self) -> int:
        server = run_invoker_token._build_server(0)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return port

    def test_responds_200_with_the_invoker_header_when_a_token_is_available(self):
        with mock.patch.object(run_invoker_token, "get_invoker_token", return_value="tok-abc"):
            port = self._start_server()
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5) as resp:  # noqa: S310
                self.assertEqual(resp.status, 200)
                self.assertEqual(resp.headers.get("X-Invoker-Token"), "tok-abc")

    def test_responds_200_with_no_header_when_no_token_is_available(self):
        # The "fail open" contract: a sidecar hiccup must never block the
        # outer request nginx's auth_request is gating -- it must always
        # be allowed to proceed, just without the invoker header attached.
        with mock.patch.object(run_invoker_token, "get_invoker_token", return_value=None):
            port = self._start_server()
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5) as resp:  # noqa: S310
                self.assertEqual(resp.status, 200)
                self.assertIsNone(resp.headers.get("X-Invoker-Token"))


class Cli(unittest.TestCase):
    def setUp(self):
        run_invoker_token.get_invoker_token.cache_clear()

    def test_prints_nothing_when_no_token(self):
        with mock.patch.object(run_invoker_token, "get_invoker_token", return_value=None), \
             mock.patch("builtins.print") as fake_print:
            rc = run_invoker_token.main(["run_invoker_token.py", "https://example.com"])
            self.assertEqual(rc, 0)
            fake_print.assert_not_called()

    def test_prints_bare_token_when_present(self):
        with mock.patch.object(run_invoker_token, "get_invoker_token", return_value="abc"), \
             mock.patch("builtins.print") as fake_print:
            run_invoker_token.main(["run_invoker_token.py", "https://example.com"])
            fake_print.assert_called_once_with("abc")


if __name__ == "__main__":
    unittest.main()
