"""Regression test for fetch_trusted_issue_context.py's gh CLI field bug.

2026-11 canary run #42254697746 proved the bug exists in production: the
script called `gh issue view N --json number,title,body,authorAssociation,
author,comments,url`, and `gh issue view --json` does not support
`authorAssociation` as a top-level field at all (its own --help JSON FIELDS
list -- assignees, author, body, closed, closedAt, comments, ..., url --
never lists it). Requesting it makes the WHOLE command fail, which means
_gh_issue_view always raised, fetch_error was always set, skip was always
true, and the agent step never ran even once. The first canary "proved
nothing" because the very thing being tested never executed.

The fix switches to the REST API (`gh api repos/{o}/{r}/issues/{n}` and
`.../issues/{n}/comments`), which returns `author_association` directly.
These tests use the REAL response shape captured from this repo's own
issue #3917 (not an invented shape) to prove the new parsing works, plus a
structural lock that the broken `gh issue view --json ...authorAssociation`
invocation never reappears.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / ".github" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import fetch_trusted_issue_context as mod  # noqa: E402

# Captured verbatim (trimmed) from `gh api repos/Youngger9765/chinese-literacy-platform/issues/3917`
REAL_ISSUE_RESPONSE = {
    "title": "test: security canary for claude-issue-agent redesign — safe to close",
    "body": "這是一張安全重設計後的驗證用 issue，內容全部是測試，沒有真正的 bug，測試完會關閉。\n\n@claude ...",
    "author_association": "OWNER",
    "html_url": "https://github.com/Youngger9765/chinese-literacy-platform/issues/3917",
    "user": {"login": "Youngger9765"},
}

# Captured verbatim (trimmed) from
# `gh api repos/Youngger9765/chinese-literacy-platform/issues/3917/comments`
REAL_COMMENT_RESPONSE = [
    {
        "body": "> 🤖 由 Claude AI 代發（非 Young 本人）\n\n⚠️ 讀取這張 issue 的討論串時發生錯誤，這一輪不會開工。",
        "author_association": "CONTRIBUTOR",
        "user": {"login": "github-actions[bot]"},
    }
]


def _fake_subprocess_run(cmd, **kwargs):
    result = mock.Mock()
    result.returncode = 0
    if cmd[:2] == ["gh", "api"] and cmd[2].endswith("/comments"):
        result.stdout = json.dumps(REAL_COMMENT_RESPONSE)
    elif cmd[:2] == ["gh", "api"]:
        result.stdout = json.dumps(REAL_ISSUE_RESPONSE)
    else:
        raise AssertionError(f"unexpected subprocess call: {cmd}")
    result.stderr = ""
    return result


def test_gh_issue_view_parses_the_real_rest_api_response_shape():
    with mock.patch.object(mod.subprocess, "run", side_effect=_fake_subprocess_run):
        data = mod._gh_issue_view("Youngger9765/chinese-literacy-platform", "3917")

    assert data["authorAssociation"] == "OWNER"
    assert data["title"].startswith("test: security canary")
    assert data["url"] == "https://github.com/Youngger9765/chinese-literacy-platform/issues/3917"
    assert len(data["comments"]) == 1
    assert data["comments"][0]["authorAssociation"] == "CONTRIBUTOR"
    assert data["comments"][0]["author"]["login"] == "github-actions[bot]"


def test_gh_issue_view_never_uses_the_broken_gh_issue_view_json_command():
    """Structural lock: the exact broken invocation
    (`gh issue view ... --json ...authorAssociation...`) must never
    reappear. This is what silently made skip=true on every single run."""
    script = (SCRIPTS_DIR / "fetch_trusted_issue_context.py").read_text(encoding="utf-8")
    assert '"gh", "issue", "view"' not in script, (
        "gh issue view --json does not support authorAssociation as a "
        "top-level field (verified: `gh issue view --help`'s own JSON "
        "FIELDS list omits it) -- requesting it fails the whole command. "
        "Use the REST API (gh api repos/{o}/{r}/issues/{n}) instead."
    )
    assert '"repos/{repo}/issues/{issue}"' in script or "repos/{repo}/issues/{issue}" in script


def test_gh_issue_view_raises_cleanly_on_a_real_gh_api_failure():
    """The failure mode this bug actually produced: gh api / gh issue view
    returning a non-zero exit. main() must still turn this into a
    fetch_error + skip=true (fail closed), not crash the job -- but the
    underlying _gh_issue_view must surface it as a real exception the
    caller can catch, not silently return partial data."""
    def _failing_run(cmd, **kwargs):
        result = mock.Mock()
        result.returncode = 1
        result.stdout = ""
        result.stderr = 'Unknown JSON field: "authorAssociation"'
        return result

    with mock.patch.object(mod.subprocess, "run", side_effect=_failing_run):
        try:
            mod._gh_issue_view("o/r", "1")
            raise AssertionError("expected _gh_issue_view to raise on gh api failure")
        except RuntimeError as exc:
            assert "authorAssociation" in str(exc) or "failed" in str(exc)
