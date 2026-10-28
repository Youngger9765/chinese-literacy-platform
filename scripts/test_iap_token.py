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


class TokenCacheTtl(unittest.TestCase):
    """#3731: the cache must refresh BEFORE the JWT's own 1h hard expiry,
    not just cache forever (the original `@lru_cache(maxsize=None)` never
    expired -- dormant today since nothing sets IAP_AUDIENCE, but a long-
    running caller like locustfile.py would start getting 401s an hour in
    if the first real deploy with IAP on shipped that behavior).
    """

    def setUp(self):
        iap_token.get_iap_token.cache_clear()
        self._env_audience_backup = os.environ.pop("IAP_AUDIENCE", None)
        self._env_creds_backup = os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
        self._clock = 1_000_000.0
        self._monotonic_patch = mock.patch.object(iap_token, "_monotonic", lambda: self._clock)
        self._monotonic_patch.start()

    def tearDown(self):
        self._monotonic_patch.stop()
        iap_token.get_iap_token.cache_clear()
        if self._env_audience_backup is not None:
            os.environ["IAP_AUDIENCE"] = self._env_audience_backup
        if self._env_creds_backup is not None:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = self._env_creds_backup

    def test_reuses_the_cached_token_within_the_refresh_window_without_re_minting(self):
        with mock.patch.object(iap_token, "_mint_via_iam_credentials", return_value="tok-1") as iam_mint:
            first = iap_token.get_iap_token("https://example.com")
            second = iap_token.get_iap_token("https://example.com")
        self.assertEqual(first, "tok-1")
        self.assertEqual(second, "tok-1")
        iam_mint.assert_called_once()

    def test_remints_once_the_refresh_margin_has_passed_well_before_hard_expiry(self):
        with mock.patch.object(
            iap_token, "_mint_via_iam_credentials", side_effect=["tok-1", "tok-2"]
        ) as iam_mint:
            first = iap_token.get_iap_token("https://example.com")
            self._clock += 2701  # 45:01 in -- past the 2700s refresh margin, before the 3600s hard expiry
            second = iap_token.get_iap_token("https://example.com")
        self.assertEqual(first, "tok-1")
        self.assertEqual(second, "tok-2")
        self.assertEqual(iam_mint.call_count, 2)

    def test_falls_back_to_the_stale_but_not_yet_hard_expired_token_when_a_remint_attempt_fails(self):
        with mock.patch.object(
            iap_token, "_mint_via_iam_credentials", side_effect=["tok-1", RuntimeError("IAM Credentials API down")]
        ):
            first = iap_token.get_iap_token("https://example.com")
            self._clock += 2701
            second = iap_token.get_iap_token("https://example.com")
        self.assertEqual(first, "tok-1")
        self.assertEqual(second, "tok-1")  # stale but still valid -- better than no header at all

    def test_returns_none_once_both_the_refresh_margin_and_the_hard_expiry_have_passed_and_remint_still_fails(self):
        with mock.patch.object(
            iap_token,
            "_mint_via_iam_credentials",
            side_effect=["tok-1", RuntimeError("IAM Credentials API down")],
        ):
            iap_token.get_iap_token("https://example.com")
            self._clock += 3601  # past the hard 1h expiry too
            second = iap_token.get_iap_token("https://example.com")
        self.assertIsNone(second)

    def test_cache_is_keyed_per_audience_not_shared_globally(self):
        with mock.patch.object(
            iap_token, "_mint_via_iam_credentials", side_effect=lambda aud: f"tok-for-{aud}"
        ) as iam_mint:
            a = iap_token.get_iap_token("https://a.example.com")
            b = iap_token.get_iap_token("https://b.example.com")
            a_again = iap_token.get_iap_token("https://a.example.com")
        self.assertEqual(a, "tok-for-https://a.example.com")
        self.assertEqual(b, "tok-for-https://b.example.com")
        self.assertEqual(a_again, a)
        self.assertEqual(iam_mint.call_count, 2)  # a's second call was cached, not re-minted


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


class _RecordingAdapter:
    """A requests transport adapter that never touches the network: it just
    records the headers each outgoing request actually carried and returns
    an empty 200. Lets the session tests below run a real `requests.Session`
    end to end (header merge, auth hook, prepare) without a server.
    """

    def __init__(self):
        self.sent_headers: list[dict[str, str]] = []

    def send(self, request, **_kwargs):
        import requests

        self.sent_headers.append(dict(request.headers))
        resp = requests.Response()
        resp.status_code = 200
        resp.request = request
        resp.url = request.url
        resp._content = b""
        return resp

    def close(self):
        pass


class InstallIapAuthOnLongLivedSession(unittest.TestCase):
    """#3731, the caller half: the TTL cache in get_iap_token() only helps
    if the caller asks again per request. locustfile.py used to do
    `self.client.headers.update(iap_header())` once in on_start, freezing
    the first token into the session for the user's whole lifetime -- so a
    load test running past the JWT's 1h exp would start getting 401s even
    with the cache re-minting correctly underneath. install_iap_auth() must
    make every request on the session re-ask for the header.
    """

    def setUp(self):
        import requests

        iap_token.get_iap_token.cache_clear()
        self._env_audience_backup = os.environ.pop("IAP_AUDIENCE", None)
        self._env_creds_backup = os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
        self._clock = 1_000_000.0
        self._monotonic_patch = mock.patch.object(iap_token, "_monotonic", lambda: self._clock)
        self._monotonic_patch.start()
        self.session = requests.Session()
        self.adapter = _RecordingAdapter()
        self.session.mount("https://", self.adapter)

    def tearDown(self):
        self._monotonic_patch.stop()
        self.session.close()
        iap_token.get_iap_token.cache_clear()
        os.environ.pop("IAP_AUDIENCE", None)
        if self._env_audience_backup is not None:
            os.environ["IAP_AUDIENCE"] = self._env_audience_backup
        if self._env_creds_backup is not None:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = self._env_creds_backup

    def test_a_request_sent_after_the_refresh_margin_carries_the_re_minted_token(self):
        os.environ["IAP_AUDIENCE"] = "https://svc.example.com"
        with mock.patch.object(
            iap_token, "_mint_via_iam_credentials", side_effect=["tok-1", "tok-2"]
        ):
            iap_token.install_iap_auth(self.session)
            self.session.get("https://svc.example.com/api/health")
            self._clock += 2701  # 45:01 in -- the cache re-mints from here on
            self.session.get("https://svc.example.com/api/health")
        self.assertEqual(self.adapter.sent_headers[0]["Proxy-Authorization"], "Bearer tok-1")
        self.assertEqual(self.adapter.sent_headers[1]["Proxy-Authorization"], "Bearer tok-2")

    def test_per_request_app_authorization_header_is_left_alone(self):
        # Positive control for the "doesn't collide" half: locust tasks pass
        # the app's own JWT per request as `Authorization`; installing IAP
        # auth must add Proxy-Authorization alongside it, not replace it.
        os.environ["IAP_AUDIENCE"] = "https://svc.example.com"
        with mock.patch.object(iap_token, "_mint_via_iam_credentials", return_value="tok-1"):
            iap_token.install_iap_auth(self.session)
            self.session.get(
                "https://svc.example.com/api/me", headers={"Authorization": "Bearer app-jwt"}
            )
        sent = self.adapter.sent_headers[0]
        self.assertEqual(sent["Authorization"], "Bearer app-jwt")
        self.assertEqual(sent["Proxy-Authorization"], "Bearer tok-1")

    def test_iap_off_sends_no_proxy_authorization_and_never_tries_to_sign(self):
        # The state for the whole repo today: no IAP_AUDIENCE -> zero change.
        with mock.patch.object(iap_token, "_mint") as mint:
            iap_token.install_iap_auth(self.session)
            self.session.get("https://svc.example.com/api/health")
        self.assertNotIn("Proxy-Authorization", self.adapter.sent_headers[0])
        mint.assert_not_called()


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


class LocustfileWiresIapPerRequest(unittest.TestCase):
    """#3731 的修法真正落在 locustfile：每個 HttpUser 都要掛 install_iap_auth。

    library 的測試證明 install_iap_auth 本身會每次重問，但 locustfile 改回
    `self.client.headers.update(iap_header())` 時 library 測試照樣全綠——
    這支才鎖得住「壓測跑超過 1 小時開始 401」那個真正的 bug。
    """

    def setUp(self):
        import ast
        path = os.path.join(os.path.dirname(__file__), "..", "tests", "load-testing", "locustfile.py")
        with open(path, encoding="utf-8") as fh:
            self.source = fh.read()
        self.tree = ast.parse(self.source)

    def _http_users(self):
        import ast
        return [
            node for node in ast.walk(self.tree)
            if isinstance(node, ast.ClassDef)
            and any(getattr(base, "id", None) == "HttpUser" for base in node.bases)
        ]

    def test_every_http_user_installs_per_request_iap_auth(self):
        import ast
        users = self._http_users()
        self.assertGreater(len(users), 0, "locustfile 裡找不到任何 HttpUser，量具壞了")
        for cls in users:
            on_start = next(
                (n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "on_start"), None
            )
            self.assertIsNotNone(on_start, f"{cls.name} 沒有 on_start")
            calls = [
                n for n in ast.walk(on_start)
                if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "install_iap_auth"
            ]
            self.assertTrue(calls, f"{cls.name}.on_start 沒有 install_iap_auth(self.client)")

    def test_no_session_pins_a_one_time_iap_header(self):
        # 只看真正的呼叫（AST），檔頭註解裡把舊寫法當反例寫出來不算
        import ast
        pinned = [
            n for n in ast.walk(self.tree)
            if isinstance(n, ast.Call)
            and getattr(n.func, "attr", None) == "update"
            and any(isinstance(arg, ast.Call) and getattr(arg.func, "id", None) == "iap_header" for arg in n.args)
        ]
        self.assertEqual(pinned, [], "有 session 用 headers.update(iap_header()) 把第一張 token 釘死")


if __name__ == "__main__":
    unittest.main()
