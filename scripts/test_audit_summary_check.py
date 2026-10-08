"""Tests for scripts/audit_summary_check.sh (#3340 audit MAJOR).

Run: python3 -m unittest scripts/test_audit_summary_check.py -v

The "Audit summary" job runs with `if: always()`; only an upstream `success`
may count as passing — `cancelled` / `skipped` mean the audit never finished.
"""
import os
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "audit_summary_check.sh")
WORKFLOW = os.path.join(HERE, "..", ".github", "workflows", "security-audit.yml")


def run(npm, pip):
    return subprocess.run(["bash", SCRIPT, npm, pip], capture_output=True, text=True)


class AuditSummary(unittest.TestCase):
    def test_both_success_passes(self):
        # Positive control.
        self.assertEqual(run("success", "success").returncode, 0)

    def test_failure_fails(self):
        self.assertNotEqual(run("failure", "success").returncode, 0)
        self.assertNotEqual(run("success", "failure").returncode, 0)

    def test_cancelled_fails(self):
        self.assertNotEqual(run("cancelled", "success").returncode, 0)
        self.assertNotEqual(run("success", "cancelled").returncode, 0)

    def test_skipped_fails(self):
        self.assertNotEqual(run("skipped", "success").returncode, 0)
        self.assertNotEqual(run("success", "skipped").returncode, 0)

    def test_empty_or_unknown_fails(self):
        self.assertNotEqual(run("", "success").returncode, 0)
        self.assertNotEqual(run("success", "weird").returncode, 0)

    def test_workflow_uses_this_script(self):
        with open(WORKFLOW) as f:
            text = f.read()
        self.assertIn("scripts/audit_summary_check.sh", text)


if __name__ == "__main__":
    unittest.main()
