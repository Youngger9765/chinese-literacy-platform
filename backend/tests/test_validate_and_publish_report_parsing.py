"""Unit tests for `.github/scripts/validate_and_publish.py`'s
`parse_agent_report()` / `NO_SUMMARY_MESSAGE` — the "what do we tell the
case owner when the agent produced nothing" path.

Why this exists (2026-11, live canary issue #3917, run 42294117055): the
agent self-refused an injected-instruction canary issue entirely (0-byte
patch, `report.json` left as the capture step's own `{}` fallback). The
publish job's only visible output was a bot-marked comment whose entire
body was the literal string "(no summary)" -- true, but gives a case
owner or engineer reading the issue zero signal about whether that's
expected (agent judged nothing needed doing) or broken (agent crashed).

Each fallback message now says *why* there's nothing to show. The tests
below cover the three ways `report.json` can fail to carry a real
`findings_summary` plus the live-canary shape itself (file exists, valid
JSON, is an object, just has no `findings_summary` key) -- revert the fix
and `test_empty_object_report_uses_the_explanatory_fallback_not_bare_no_summary`
goes red, which is the one that matches what the canary actually produced.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / ".github" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import validate_and_publish as vap  # noqa: E402


def test_missing_report_file_gets_a_specific_message():
    report = vap.parse_agent_report(None)
    assert "did not produce a report file" in report["findings_summary"]


def test_invalid_json_gets_a_specific_message():
    report = vap.parse_agent_report("{not valid json")
    assert "was not valid JSON" in report["findings_summary"]


def test_non_object_json_gets_a_specific_message():
    # agent wrote a bare JSON array/string/number/null instead of an object
    report = vap.parse_agent_report("[1, 2, 3]")
    assert "was not an object" in report["findings_summary"]


def test_valid_object_report_passes_through_unchanged():
    report = vap.parse_agent_report('{"findings_summary": "real summary text"}')
    assert report == {"findings_summary": "real summary text"}


def test_empty_object_report_uses_the_explanatory_fallback_not_bare_no_summary():
    """The exact shape the live canary produced: report.json exists, is
    valid JSON, is an object -- just has no findings_summary key at all
    (the capture step's own `{}` fallback, because the agent never wrote
    the file). `parse_agent_report` correctly returns `{}` unchanged (it
    isn't this function's job to supply the fallback text — main() does
    that via `report.get("findings_summary") or NO_SUMMARY_MESSAGE`) but
    that downstream fallback must not be the old bare "(no summary)"."""
    report = vap.parse_agent_report("{}")
    assert report == {}
    findings_summary = str(report.get("findings_summary") or vap.NO_SUMMARY_MESSAGE)
    assert findings_summary == vap.NO_SUMMARY_MESSAGE
    assert findings_summary != "(no summary)"
    assert "請工程師查看 run log" in findings_summary
