"""Tests for scripts/iap_token.py (#3719, rewritten for #3730's findings).

Run: python3 -m unittest scripts.test_iap_token -v   (from repo root)
  or python3 -m unittest scripts/test_iap_token.py -v

The contract this locks, in two halves:

1. With IAP off (no IAP_AUDIENCE -- the state for the whole repo today),
   every public function must be a pure no-op: no signing attempt, no
   header, no exception. That's the guarantee the rest of the IAP-prep
   work depends on to be safe to land before IAP is actually turned on.

2. When an audience IS configured, the self-signed JWT this module mints
   has the exact shape #3730's canary test proved IAP actually accepts:
   iss == sub == the signing service account's email (never a user
   email), aud == exactly the audience passed in (not wrapped/rewritten),
   and a lifetime that never exceeds the validated 1-hour bound. These
   are mocked at the google-auth library boundary (RSASigner, jwt.encode,
   google.auth.default, iam.Signer) rather than hitting real GCP --
   mint_via_* functions are tested for the CLAIMS and CONTROL FLOW they
   produce, not for actually reaching Google; nothing in this file
   depends on network access or real credentials.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import iap_token  # noqa: E402


class BuildClaims(unittest.TestCase):
    def test_iss_and_sub_are_both_the_service_account_email(self):
        claims = iap_token._build_claims("https://example.run.app", "sa@project.iam.gserviceaccount.com")
        self.assertEqual(claims["iss"], "sa@project.iam.gserviceaccount.com")
        self.assertEqual(claims["sub"], "sa@project.iam.gserviceaccount.com")

    def test_aud_is_exactly_the_audience_passed_not_rewritten(self):
        # #3730 found the OAuth-client-ID / projects-path variants also work,
        # but this module always uses the bare service URL so callers never
        # have to guess which form to pass.
        claims = iap_token._build_claims("https://my-service-abc123.a.run.app", "sa@x.iam.gserviceaccount.com")
        self.assertEqual(claims["aud"], "https://my-service-abc123.a.run.app")

    def test_lifetime_never_exceeds_the_validated_one_hour_bound(self):
        now = 1_700_000_000
        claims = iap_token._build_claims("aud", "sa@x.iam.gserviceaccount.com", now=now)
        self.assertLessEqual(claims["exp"] - claims["iat"], 3600)
        self.assertEqual(claims["iat"], now)

    def test_exp_is_strictly_after_iat(self):
        claims = iap_token._build_claims("aud", "sa@x.iam.gserviceaccount.com")
        self.assertGreater(claims["exp"], claims["iat"])

    def test_iat_defaults_to_now_when_not_given(self):
        before = int(time.time())
        claims = iap_token._build_claims("aud", "sa@x.iam.gserviceaccount.com")
        after = int(time.time())
        self.assertGreaterEqual(claims["iat"], before)
        self.assertLessEqual(claims["iat"], after)


class MintViaKeyFile(unittest.TestCase):
    def _write_key_file(self, client_email: str | None) -> str:
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as f:
            body = {"type": "service_account"}
            if client_email is not None:
                body["client_email"] = client_email
            json.dump(body, f)
        self.addCleanup(os.remove, path)
        return path

    def test_reads_client_email_from_key_file_and_signs_with_it(self):
        path = self._write_key_file("sa@project.iam.gserviceaccount.com")
        with mock.patch("google.auth.crypt.RSASigner.from_service_account_file") as from_file, \
             mock.patch("google.auth.jwt.encode", return_value=b"signed-jwt") as encode:
            token = iap_token._mint_via_key_file(path, "https://backend.run.app")
        self.assertEqual(token, "signed-jwt")
        from_file.assert_called_once_with(path)
        claims_arg = encode.call_args[0][1]
        self.assertEqual(claims_arg["iss"], "sa@project.iam.gserviceaccount.com")
        self.assertEqual(claims_arg["sub"], "sa@project.iam.gserviceaccount.com")
        self.assertEqual(claims_arg["aud"], "https://backend.run.app")

    def test_returns_none_when_key_file_has_no_client_email(self):
        path = self._write_key_file(None)
        with mock.patch("google.auth.jwt.encode") as encode:
            token = iap_token._mint_via_key_file(path, "aud")
        self.assertIsNone(token)
        encode.assert_not_called()

    def test_decodes_bytes_result_to_str(self):
        path = self._write_key_file("sa@x.iam.gserviceaccount.com")
        with mock.patch("google.auth.crypt.RSASigner.from_service_account_file"), \
             mock.patch("google.auth.jwt.encode", return_value=b"abc"):
            token = iap_token._mint_via_key_file(path, "aud")
        self.assertIsInstance(token, str)
        self.assertEqual(token, "abc")


class MintViaIamCredentials(unittest.TestCase):
    def test_uses_service_account_email_from_ambient_credentials(self):
        fake_creds = mock.Mock(service_account_email="runner@project.iam.gserviceaccount.com")
        with mock.patch("google.auth.default", return_value=(fake_creds, "proj")), \
             mock.patch("google.auth.transport.requests.Request"), \
             mock.patch("google.auth.iam.Signer") as signer_cls, \
             mock.patch("google.auth.jwt.encode", return_value=b"signed") as encode:
            token = iap_token._mint_via_iam_credentials("https://backend.run.app")
        self.assertEqual(token, "signed")
        signer_cls.assert_called_once()
        self.assertEqual(signer_cls.call_args[0][2], "runner@project.iam.gserviceaccount.com")
        claims_arg = encode.call_args[0][1]
        self.assertEqual(claims_arg["iss"], "runner@project.iam.gserviceaccount.com")
        self.assertEqual(claims_arg["aud"], "https://backend.run.app")

    def test_falls_back_to_explicit_sa_email_argument(self):
        fake_creds = mock.Mock(spec=["refresh"])  # no service_account_email/signer_email attrs
        with mock.patch("google.auth.default", return_value=(fake_creds, "proj")), \
             mock.patch("google.auth.transport.requests.Request"), \
             mock.patch("google.auth.iam.Signer") as signer_cls, \
             mock.patch("google.auth.jwt.encode", return_value=b"signed"):
            token = iap_token._mint_via_iam_credentials("aud", sa_email="explicit@x.iam.gserviceaccount.com")
        self.assertEqual(token, "signed")
        self.assertEqual(signer_cls.call_args[0][2], "explicit@x.iam.gserviceaccount.com")

    def test_falls_back_to_env_var_when_credentials_have_no_email(self):
        fake_creds = mock.Mock(spec=["refresh"])
        with mock.patch.dict(os.environ, {"IAP_SIGNING_SA_EMAIL": "env-sa@x.iam.gserviceaccount.com"}), \
             mock.patch("google.auth.default", return_value=(fake_creds, "proj")), \
             mock.patch("google.auth.transport.requests.Request"), \
             mock.patch("google.auth.iam.Signer") as signer_cls, \
             mock.patch("google.auth.jwt.encode", return_value=b"signed"):
            token = iap_token._mint_via_iam_credentials("aud")
        self.assertEqual(token, "signed")
        self.assertEqual(signer_cls.call_args[0][2], "env-sa@x.iam.gserviceaccount.com")

    def test_returns_none_when_no_email_found_anywhere(self):
        fake_creds = mock.Mock(spec=["refresh"])
        with mock.patch.dict(os.environ, {}, clear=False), \
             mock.patch("google.auth.default", return_value=(fake_creds, "proj")), \
             mock.patch("google.auth.transport.requests.Request"), \
             mock.patch("google.auth.iam.Signer") as signer_cls:
            os.environ.pop("IAP_SIGNING_SA_EMAIL", None)
            token = iap_token._mint_via_iam_credentials("aud")
        self.assertIsNone(token)
        signer_cls.assert_not_called()


class GetIapToken(unittest.TestCase):
    def setUp(self):
        iap_token.get_iap_token.cache_clear()
        self._env_audience_backup = os.environ.pop("IAP_AUDIENCE", None)
        self._env_creds_backup = os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)

    def tearDown(self):
        iap_token.get_iap_token.cache_clear()
        if self._env_audience_backup is not None:
            os.environ["IAP_AUDIENCE"] = self._env_audience_backup
        if self._env_creds_backup is not None:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = self._env_creds_backup

    def test_no_audience_anywhere_is_a_noop(self):
        # Negative control matching today's reality: nobody sets
        # IAP_AUDIENCE, so this must never even try to sign anything.
        with mock.patch.object(iap_token, "_mint_via_key_file") as key_mint, \
             mock.patch.object(iap_token, "_mint_via_iam_credentials") as iam_mint:
            self.assertIsNone(iap_token.get_iap_token())
            key_mint.assert_not_called()
            iam_mint.assert_not_called()

    def test_uses_key_file_path_when_GOOGLE_APPLICATION_CREDENTIALS_points_at_a_real_file(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        self.addCleanup(os.remove, path)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = path
        with mock.patch.object(iap_token, "_mint_via_key_file", return_value="key-file-token") as key_mint, \
             mock.patch.object(iap_token, "_mint_via_iam_credentials") as iam_mint:
            token = iap_token.get_iap_token("https://example.com")
        self.assertEqual(token, "key-file-token")
        key_mint.assert_called_once_with(path, "https://example.com")
        iam_mint.assert_not_called()

    def test_falls_back_to_iam_credentials_when_no_key_file_configured(self):
        # GOOGLE_APPLICATION_CREDENTIALS unset -- e.g. Workload Identity
        # Federation, no literal downloadable key.
        with mock.patch.object(iap_token, "_mint_via_key_file") as key_mint, \
             mock.patch.object(iap_token, "_mint_via_iam_credentials", return_value="iam-token") as iam_mint:
            token = iap_token.get_iap_token("https://example.com")
        self.assertEqual(token, "iam-token")
        key_mint.assert_not_called()
        iam_mint.assert_called_once_with("https://example.com")

    def test_falls_back_to_iam_credentials_when_key_file_path_set_but_mint_fails(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        self.addCleanup(os.remove, path)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = path
        with mock.patch.object(iap_token, "_mint_via_key_file", return_value=None), \
             mock.patch.object(iap_token, "_mint_via_iam_credentials", return_value="iam-token") as iam_mint:
            token = iap_token.get_iap_token("https://example.com")
        self.assertEqual(token, "iam-token")
        iam_mint.assert_called_once()

    def test_falls_back_to_iam_credentials_when_GOOGLE_APPLICATION_CREDENTIALS_points_at_nothing(self):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/does/not/exist.json"
        with mock.patch.object(iap_token, "_mint_via_key_file") as key_mint, \
             mock.patch.object(iap_token, "_mint_via_iam_credentials", return_value="iam-token"):
            token = iap_token.get_iap_token("https://example.com")
        self.assertEqual(token, "iam-token")
        key_mint.assert_not_called()

    def test_any_exception_from_minting_returns_none_not_raise(self):
        with mock.patch.object(iap_token, "_mint_via_key_file", side_effect=RuntimeError("boom")), \
             mock.patch.object(iap_token, "_mint_via_iam_credentials", side_effect=RuntimeError("boom")):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = __file__  # exists, so key-file path is tried
            self.assertIsNone(iap_token.get_iap_token("https://example.com"))

    def test_no_credentials_available_returns_none_not_raise(self):
        # The "no creds -> no header" contract: google.auth.default() raising
        # DefaultCredentialsError (the real failure mode with no ADC at all)
        # must not propagate.
        import google.auth.exceptions

        with mock.patch("google.auth.default", side_effect=google.auth.exceptions.DefaultCredentialsError("none")):
            self.assertIsNone(iap_token.get_iap_token("https://example.com"))

    def test_env_var_is_used_when_no_explicit_audience_passed(self):
        os.environ["IAP_AUDIENCE"] = "https://from-env.example.com"
        with mock.patch.object(iap_token, "_mint_via_iam_credentials", return_value="tok") as iam_mint:
            iap_token.get_iap_token()
        iam_mint.assert_called_once_with("https://from-env.example.com")


class IapHeader(unittest.TestCase):
    def setUp(self):
        iap_token.get_iap_token.cache_clear()

    def test_no_token_gives_empty_dict(self):
        with mock.patch.object(iap_token, "get_iap_token", return_value=None):
            self.assertEqual(iap_token.iap_header("aud"), {})

    def test_token_gives_proxy_authorization_not_authorization(self):
        # Authorization is already the app's own JWT header -- must not collide.
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
