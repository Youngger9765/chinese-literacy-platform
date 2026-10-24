"""Tests for scripts/iap_token.py (#3719).

Run: python3 -m unittest scripts.test_iap_token -v   (from repo root)
  or python3 -m unittest scripts/test_iap_token.py -v

The contract this locks: with IAP off (no IAP_AUDIENCE, the state for the
whole repo today), every public function here must behave as a pure no-op
— no subprocess call, no header, no exception. That is the guarantee the
rest of the IAP-prep work (playwright config, CI curls, Python scripts)
depends on to be safe to land before IAP is actually turned on.
"""

from __future__ import annotations

import os
import subprocess
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import iap_token  # noqa: E402


class GetIapToken(unittest.TestCase):
    def setUp(self):
        iap_token.get_iap_token.cache_clear()
        self._env_backup = os.environ.pop("IAP_AUDIENCE", None)

    def tearDown(self):
        iap_token.get_iap_token.cache_clear()
        if self._env_backup is not None:
            os.environ["IAP_AUDIENCE"] = self._env_backup

    def test_no_audience_anywhere_is_a_noop(self):
        # Negative control matching today's reality: nobody sets
        # IAP_AUDIENCE, so this must never even try to call gcloud.
        with mock.patch("subprocess.run") as run:
            self.assertIsNone(iap_token.get_iap_token())
            run.assert_not_called()

    def test_audience_without_gcloud_returns_none_not_raise(self):
        with mock.patch("subprocess.run", side_effect=FileNotFoundError("no gcloud")):
            self.assertIsNone(iap_token.get_iap_token("https://example.com"))

    def test_audience_with_expired_creds_returns_none_not_raise(self):
        err = subprocess.CalledProcessError(1, ["gcloud"], stderr="Reauthentication required")
        with mock.patch("subprocess.run", side_effect=err):
            self.assertIsNone(iap_token.get_iap_token("https://example.com"))

    def test_audience_with_valid_creds_returns_token(self):
        fake = subprocess.CompletedProcess(args=[], returncode=0, stdout="fake-id-token\n")
        with mock.patch("subprocess.run", return_value=fake) as run:
            self.assertEqual(iap_token.get_iap_token("https://example.com"), "fake-id-token")
            called_cmd = run.call_args[0][0]
            self.assertIn("--audiences=https://example.com", called_cmd)

    def test_gcloud_prints_only_whitespace_is_treated_as_no_token(self):
        fake = subprocess.CompletedProcess(args=[], returncode=0, stdout="   \n")
        with mock.patch("subprocess.run", return_value=fake):
            self.assertIsNone(iap_token.get_iap_token("https://example.com"))

    def test_env_var_is_used_when_no_explicit_audience_passed(self):
        os.environ["IAP_AUDIENCE"] = "https://from-env.example.com"
        fake = subprocess.CompletedProcess(args=[], returncode=0, stdout="env-token\n")
        with mock.patch("subprocess.run", return_value=fake) as run:
            self.assertEqual(iap_token.get_iap_token(), "env-token")
            self.assertIn("--audiences=https://from-env.example.com", run.call_args[0][0])


class IapHeader(unittest.TestCase):
    def setUp(self):
        iap_token.get_iap_token.cache_clear()

    def test_no_token_gives_empty_dict(self):
        with mock.patch.object(iap_token, "get_iap_token", return_value=None):
            self.assertEqual(iap_token.iap_header("aud"), {})

    def test_token_gives_proxy_authorization_not_authorization(self):
        # Authorization is already the app's own JWT header — must not collide.
        with mock.patch.object(iap_token, "get_iap_token", return_value="tok123"):
            headers = iap_token.iap_header("aud")
            self.assertEqual(headers, {"Proxy-Authorization": "Bearer tok123"})
            self.assertNotIn("Authorization", headers)


class UrlopenWithIap(unittest.TestCase):
    def test_no_token_calls_plain_urlopen(self):
        with mock.patch.object(iap_token, "iap_header", return_value={}), \
             mock.patch("urllib.request.urlopen") as urlopen:
            iap_token.urlopen_with_iap("https://example.com", timeout=5)
            urlopen.assert_called_once_with("https://example.com", timeout=5)

    def test_token_wraps_in_request_with_header(self):
        with mock.patch.object(
            iap_token, "iap_header", return_value={"Proxy-Authorization": "Bearer tok"}
        ), mock.patch("urllib.request.urlopen") as urlopen:
            iap_token.urlopen_with_iap("https://example.com", timeout=5)
            urlopen.assert_called_once()
            req = urlopen.call_args[0][0]
            self.assertIsInstance(req, type(iap_token.urllib.request.Request("https://x")))
            self.assertEqual(req.get_header("Proxy-authorization"), "Bearer tok")


class Cli(unittest.TestCase):
    def setUp(self):
        iap_token.get_iap_token.cache_clear()

    def test_prints_nothing_when_no_token(self):
        with mock.patch.object(iap_token, "get_iap_token", return_value=None), \
             mock.patch("builtins.print") as fake_print:
            rc = iap_token.main(["iap_token.py", "https://example.com"])
            self.assertEqual(rc, 0)
            fake_print.assert_not_called()

    def test_prints_bare_token_when_present(self):
        with mock.patch.object(iap_token, "get_iap_token", return_value="abc"), \
             mock.patch("builtins.print") as fake_print:
            iap_token.main(["iap_token.py", "https://example.com"])
            fake_print.assert_called_once_with("abc")


if __name__ == "__main__":
    unittest.main()
