#!/usr/bin/env python3
"""Trusted finalize step for claude-pr-review.yml.

This is the "trusted step [that] posts that file as a comment, after a
gitleaks scan of its content and a length cap" the redesign requires
(Claude Security finding find_01QFjr9CLgAJwsZv8m59RjLN). It runs AFTER the
review agent has exited, reads exactly ONE fixed file the agent was told to
write its review to, and is the only thing in this workflow with a tool
that can post to GitHub.

The agent itself is never given `gh pr comment` (or any posting tool) at
all -- see claude-pr-review.yml. Even if a fork PR's diff fully convinced
the model to try to publish something, there is no tool call available
that would do it. This script is what actually posts, and it only ever
reads the one path passed via --review-file.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from claude_agent_lib import scan_text_for_secrets  # noqa: E402

BOT_PREFIX = "> 🤖 由 Claude AI 代發（非 Young 本人）"
MAX_COMMENT_CHARS = 60_000  # GitHub's own comment body limit is ~65536


def run_gitleaks_if_available(text: str) -> list[str]:
    gitleaks = shutil.which("gitleaks")
    if not gitleaks:
        return []
    with tempfile.TemporaryDirectory() as td:
        (Path(td) / "review.txt").write_text(text, encoding="utf-8")
        result = subprocess.run(
            [gitleaks, "detect", "--no-git", "--source", td, "--exit-code", "2"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 2:
            return ["gitleaks detected a secret-shaped match in the review text"]
        if result.returncode not in (0, 2):
            return [f"gitleaks exited {result.returncode} unexpectedly: {result.stderr}"]
    return []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--pr", required=True)
    ap.add_argument("--review-file", required=True)
    args = ap.parse_args()

    path = Path(args.review_file)
    if not path.exists() or not path.read_text(encoding="utf-8").strip():
        body = (
            f"{BOT_PREFIX}\n\n"
            "⚠️ 這一輪沒有產生 review 內容（agent 可能提早結束或出錯），"
            "請工程師查看 run log。"
        )
        _post(args.repo, args.pr, body)
        print("no review content — posted fallback notice", file=sys.stderr)
        return 0

    review_text = path.read_text(encoding="utf-8")

    hits = scan_text_for_secrets(review_text)
    hits += run_gitleaks_if_available(review_text)
    if hits:
        body = (
            f"{BOT_PREFIX}\n\n"
            "⛔ 這一輪的 review 內容被安全政策拒絕發佈：偵測到疑似 secret"
            f"（{'、'.join(sorted(set(hits)))}）。review 內容不會被貼出來，"
            "請工程師查看 run log 確認。"
        )
        _post(args.repo, args.pr, body)
        # Log a count, not the hit list itself -- CodeQL's clear-text-logging
        # query (py/clear-text-logging-sensitive-data) flags any value
        # derived from a secret-scan function reaching a log sink, even
        # though these are just human-readable pattern LABELS ("GitHub
        # token", "AWS access key"), never the matched secret text itself.
        # The count is all a human needs from the run log; it also breaks
        # the taint chain CodeQL is (correctly, in general) suspicious of.
        print(f"REFUSED: secret scan hit ({len(hits)} pattern(s) matched)", file=sys.stderr)
        return 4

    truncated_note = ""
    if len(review_text) > MAX_COMMENT_CHARS:
        review_text = review_text[:MAX_COMMENT_CHARS]
        truncated_note = "\n\n_（review 內容過長，已截斷）_"

    body = f"{BOT_PREFIX}\n\n{review_text}{truncated_note}"
    _post(args.repo, args.pr, body)
    print("posted review comment", file=sys.stderr)
    return 0


def _post(repo: str, pr: str, body: str) -> None:
    result = subprocess.run(
        ["gh", "pr", "comment", pr, "--repo", repo, "--body", body],
    )
    if result.returncode != 0:
        raise RuntimeError("gh pr comment failed")


if __name__ == "__main__":
    raise SystemExit(main())
