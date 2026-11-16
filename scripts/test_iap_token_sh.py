"""Tests for scripts/lib/iap-token.sh's gcloud fallback (#3733).

Why: the GitHub runners that run the deploy health checks have no
`google-auth` Python package, so scripts/iap_token.py silently returns
nothing there -- with IAP on, every CI health check would go out without a
token and see Google's login page. The bash helper falls back to
`gcloud iam service-accounts sign-jwt` (IAM Credentials signs for the
SA named in IAP_SIGNING_SA_EMAIL; same claims shape #3730 proved IAP
accepts). These run the real script under bash with fake `python3` /
`gcloud` on PATH.

Run: python3 -m pytest scripts/test_iap_token_sh.py -q   (from repo root)
"""
from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HELPER = REPO / "scripts" / "lib" / "iap-token.sh"
SA = "ci-sa@proj.iam.gserviceaccount.com"
AUD = "https://frontend-x-958347263320.asia-east1.run.app"


def _exe(path: Path, body: str) -> None:
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class Harness:
    def __init__(self, python_out: str = "", gcloud_ok: bool = True):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.bin = self.dir / "bin"
        self.bin.mkdir()
        self.log = self.dir / "gcloud.log"
        self.claims_copy = self.dir / "claims.json"
        _exe(self.bin / "python3", f"#!/bin/bash\nprintf '%s' '{python_out}'\n")
        if gcloud_ok:
            gcloud = (
                "#!/bin/bash\n"
                f'echo "$*" >> "{self.log}"\n'
                # args: iam service-accounts sign-jwt <claims> <out> --iam-account=...
                f'cp "$4" "{self.claims_copy}"\n'
                'printf "header.payload.sig" > "$5"\n'
            )
        else:
            gcloud = f'#!/bin/bash\necho "$*" >> "{self.log}"\nexit 1\n'
        _exe(self.bin / "gcloud", gcloud)

    def run(self, audience: str, sa: str | None = SA) -> subprocess.CompletedProcess:
        env = {"PATH": f"{self.bin}:/usr/bin:/bin", "HOME": str(self.dir)}
        if sa is not None:
            env["IAP_SIGNING_SA_EMAIL"] = sa
        return subprocess.run(
            ["bash", "-c", f'source "{HELPER}"; iap_token "$1"', "_", audience],
            env=env, capture_output=True, text=True, timeout=30,
        )

    def gcloud_calls(self) -> list[str]:
        return self.log.read_text().splitlines() if self.log.exists() else []

    def close(self):
        self.tmp.cleanup()


class GcloudFallback(unittest.TestCase):
    def setUp(self):
        self.h = None

    def tearDown(self):
        if self.h:
            self.h.close()

    def test_no_audience_is_a_pure_noop(self):
        self.h = Harness()
        r = self.h.run("")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")
        self.assertEqual(self.h.gcloud_calls(), [])

    def test_python_path_empty_falls_back_to_gcloud_sign_jwt(self):
        self.h = Harness(python_out="")
        r = self.h.run(AUD)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "header.payload.sig")
        calls = self.h.gcloud_calls()
        self.assertEqual(len(calls), 1)
        self.assertIn("iam service-accounts sign-jwt", calls[0])
        self.assertIn(f"--iam-account={SA}", calls[0])

    def test_fallback_claims_have_the_shape_iap_accepts(self):
        self.h = Harness(python_out="")
        before = int(time.time())
        self.h.run(AUD)
        claims = json.loads(self.h.claims_copy.read_text())
        self.assertEqual(claims["iss"], SA)
        self.assertEqual(claims["sub"], SA)
        self.assertEqual(claims["aud"], AUD)
        self.assertGreaterEqual(claims["iat"], before - 5)
        self.assertGreater(claims["exp"], claims["iat"])
        self.assertLessEqual(claims["exp"] - claims["iat"], 3600)

    def test_python_token_wins_and_gcloud_is_not_called(self):
        self.h = Harness(python_out="from-python")
        r = self.h.run(AUD)
        self.assertEqual(r.stdout.strip(), "from-python")
        self.assertEqual(self.h.gcloud_calls(), [])

    def test_gcloud_failure_degrades_to_empty_not_an_error(self):
        self.h = Harness(python_out="", gcloud_ok=False)
        r = self.h.run(AUD)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")

    def test_no_signing_sa_means_no_gcloud_attempt(self):
        self.h = Harness(python_out="")
        r = self.h.run(AUD, sa=None)
        self.assertEqual(r.stdout, "")
        self.assertEqual(self.h.gcloud_calls(), [])

    def test_token_never_leaks_to_stderr(self):
        self.h = Harness(python_out="")
        r = self.h.run(AUD)
        self.assertNotIn("header.payload.sig", r.stderr)


if __name__ == "__main__":
    unittest.main()
