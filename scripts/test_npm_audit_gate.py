"""Tests for scripts/npm_audit_gate.py (#3340).

Run: python3 -m unittest scripts/test_npm_audit_gate.py -v

Why this exists: the workflow used to pass `--ignore=<id>` to `npm audit`,
but npm has no such flag — it is silently swallowed, so the npm allowlist
never suppressed anything. These tests pin the replacement gate's behaviour,
each allowlist case paired with a control that must still fail.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import npm_audit_gate as gate  # noqa: E402

GATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "npm_audit_gate.py")


def advisory(source, name, severity, ghsa):
    return {
        "source": source,
        "name": name,
        "dependency": name,
        "title": f"{name} advisory",
        "url": f"https://github.com/advisories/{ghsa}",
        "severity": severity,
        "range": "*",
    }


def audit(*vulns):
    """Build a minimal `npm audit --json` (v7+) payload."""
    out = {}
    for name, severity, via in vulns:
        out[name] = {"name": name, "severity": severity, "via": via, "isDirect": False}
    return {"auditReportVersion": 2, "vulnerabilities": out, "metadata": {}}


BRACES = advisory(1240992, "braces", "high", "GHSA-vfj7-8cjw-p6xm")
UNDICI = advisory(1239999, "undici", "high", "GHSA-3wwx-pv8p-q78v")
UUID = advisory(1119441, "uuid", "moderate", "GHSA-w5hq-g745-h8pq")

# Shape of the real tree on 2026-10-08: braces advisory propagated up to tailwindcss.
TAILWIND_CHAIN = audit(
    ("braces", "high", [BRACES]),
    ("micromatch", "high", ["braces"]),
    ("chokidar", "high", ["braces"]),
    ("fast-glob", "high", ["micromatch"]),
    ("tailwindcss", "high", ["chokidar", "fast-glob", "micromatch"]),
)


def allow(*ids):
    return {
        "npm": list(ids),
        "_justifications": {i: "test justification" for i in ids},
    }


class BlockingAdvisories(unittest.TestCase):
    def test_unlisted_high_blocks(self):
        blocking = gate.blocking_advisories(TAILWIND_CHAIN, allow())
        self.assertEqual([a["source"] for a in blocking], [1240992])

    def test_allowlisted_by_npm_id_clears_whole_transitive_chain(self):
        self.assertEqual(gate.blocking_advisories(TAILWIND_CHAIN, allow("1240992")), [])

    def test_allowlisted_by_ghsa_id_clears_whole_transitive_chain(self):
        self.assertEqual(
            gate.blocking_advisories(TAILWIND_CHAIN, allow("GHSA-vfj7-8cjw-p6xm")), []
        )

    def test_allowlisting_one_advisory_does_not_hide_another_high(self):
        # Control: the allowlist must be per-advisory, not a blanket pass.
        report = audit(("braces", "high", [BRACES]), ("undici", "high", [UNDICI]))
        blocking = gate.blocking_advisories(report, allow("1240992"))
        self.assertEqual([a["source"] for a in blocking], [1239999])

    def test_moderate_never_blocks(self):
        report = audit(("uuid", "moderate", [UUID]))
        self.assertEqual(gate.blocking_advisories(report, allow()), [])

    def test_critical_blocks(self):
        crit = advisory(1, "evil", "critical", "GHSA-aaaa-bbbb-cccc")
        report = audit(("evil", "critical", [crit]))
        self.assertEqual(len(gate.blocking_advisories(report, allow())), 1)

    def test_same_advisory_reported_twice_counted_once(self):
        report = audit(("braces", "high", [BRACES, dict(BRACES)]))
        self.assertEqual(len(gate.blocking_advisories(report, allow())), 1)


class AllowlistValidation(unittest.TestCase):
    def test_entry_without_justification_is_rejected(self):
        with self.assertRaises(gate.GateError):
            gate.validate_allowlist({"npm": ["1240992"], "_justifications": {}})

    def test_entry_with_justification_is_accepted(self):
        gate.validate_allowlist(allow("1240992"))

    def test_missing_npm_key_is_empty(self):
        gate.validate_allowlist({"pip": ["X"], "_justifications": {"X": "y"}})


class MalformedReport(unittest.TestCase):
    def test_npm_error_payload_fails_closed(self):
        # `npm audit` prints {"error": ...} when the registry is unreachable;
        # an empty "vulnerabilities" must not be read as "clean".
        with self.assertRaises(gate.GateError):
            gate.blocking_advisories({"error": {"code": "ENOAUDIT"}}, allow())

    def test_missing_vulnerabilities_key_fails_closed(self):
        with self.assertRaises(gate.GateError):
            gate.blocking_advisories({"metadata": {}}, allow())


class Cli(unittest.TestCase):
    def run_cli(self, report, allowlist):
        with tempfile.TemporaryDirectory() as d:
            rp = os.path.join(d, "audit.json")
            ap = os.path.join(d, "allow.json")
            with open(rp, "w") as f:
                json.dump(report, f)
            with open(ap, "w") as f:
                json.dump(allowlist, f)
            return subprocess.run(
                [sys.executable, GATE, rp, ap], capture_output=True, text=True
            )

    def test_cli_fails_on_unlisted_high(self):
        r = self.run_cli(TAILWIND_CHAIN, allow())
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("GHSA-vfj7-8cjw-p6xm", r.stdout)

    def test_cli_passes_when_allowlisted(self):
        r = self.run_cli(TAILWIND_CHAIN, allow("1240992"))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("allowlisted", r.stdout)

    def test_cli_exit_2_on_bad_report(self):
        r = self.run_cli({"error": {"code": "ENOAUDIT"}}, allow())
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
