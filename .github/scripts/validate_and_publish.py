#!/usr/bin/env python3
"""Trusted publish step for claude-issue-agent.yml's SECOND job ("publish").

Why a second job, not a second step in the same job (2026-11 adversarial
review, BLOCKER): the agent step runs with Edit/Write on the whole checkout.
If this script ran later IN THE SAME checkout/job, the agent could have
already overwritten .github/scripts/claude_agent_lib.py (or this file
itself, or shadowed a stdlib module by creating e.g.
.github/scripts/json.py, since the scripts directory sits at the front of
sys.path) -- "the trusted step" would then execute code the untrusted
agent wrote, which defeats the entire redesign. So the agent job never
commits/pushes anything at all: it produces one artifact (a patch file +
report.json) and that's it. THIS script runs in a completely separate job,
on a separate runner, against a checkout the agent process never had any
access to -- claude_agent_lib.py as imported here is necessarily the real,
unmodified version, because this checkout exists only because this job
did its own fresh checkout.

Everything that decides whether to publish is therefore based on the PATCH
TEXT (produced by the agent job's "capture artifact" step, itself just a
plain git diff -- no custom script, nothing for the agent to have
tampered with) -- never on anything read back out of a working tree the
agent touched, and never on the agent's own self-reported JSON status
string. Guardrails, in order, each one exiting before anything is pushed or
posted if it trips:
  1. protected-path refusal, computed from the patch's own diff headers --
     refuses .github/**, any conftest.py, scripts/**, entrypoint.sh,
     Dockerfile*
  2. secret scan over the FULL patch text (gitleaks if available + the
     dependency-free regex fallback) -- the whole patch, not per-file reads,
     specifically so a secret hidden in a non-ASCII-named file can't escape
     by way of a path-decoding mismatch (2026-11 review, blocker: git's
     default core.quotePath=true C-escapes non-ASCII names, and reading
     "that path" from disk afterwards 404s and silently swallows the error
     -- this design never reads individual files back off disk at all)
  3. the same two scans ALSO run on the text this script is about to make
     public (the issue comment, PR title, PR body) -- including on the
     "nothing changed" path, since that text is still partly agent output
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from claude_agent_lib import (  # noqa: E402
    extract_changed_paths_from_patch,
    neutralize_closing_keywords,
    patch_safety_violations,
    protected_path_violations,
    scan_text_for_secrets,
)

BOT_PREFIX = "> 🤖 由 Claude AI 代發（非 Young 本人）"

PREVIEW_URL_TEMPLATE = (
    "前端 https://lingoleap-frontend-issue-{n}-958347263320.asia-east1.run.app\n"
    "後端 https://lingoleap-backend-issue-{n}-958347263320.asia-east1.run.app"
)

CTA_TEMPLATE = """---
### 👉 接下來換你

**要做的事**：{acceptance_steps}

**看完請回覆**（直接留言，選一個）：
- ✅ 「**驗收通過**」 → 我就結案
- ❌ 「**未通過**」＋哪一步跟預期不一樣 → 我接著修
- ❓ 看不懂或不確定 → 直接說，我換個方式解釋
"""

NEEDS_ENGINEER_FOOTER = (
    "---\n"
    "這一輪**需要工程師接手**，不會再自動重試。相關改動與分析都在上面，"
    "麻煩轉交給工程師查看。"
)

AGENT_CODE_DISCLAIMER = (
    "---\n"
    "⚠️ **這是自動化代理寫的程式碼**。CI 綠燈只證明既有測試沒被破壞，"
    "不代表這段改動安全或正確 —— **merge 前請工程師親自讀過完整 diff**，"
    "不要只看 CI 狀態就合併。\n"
)

SECRET_REDACTED_NOTICE = (
    "⛔ 這段內容被安全政策拒絕發佈：偵測到疑似 secret 的字串，內容已略過"
    "（不會把疑似 secret 的原文貼出來）。請工程師查看這個 run 的 log 確認。"
)


def _redact(text: str, *secrets: str) -> str:
    out = text or ""
    for s in secrets:
        if s:
            out = out.replace(s, "***")
    return out


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    kwargs.setdefault("text", True)
    kwargs.setdefault("capture_output", True)
    return subprocess.run(cmd, **kwargs)


def run_gitleaks_if_available(path_or_text: str, *, is_file: bool) -> tuple[list[str], bool]:
    """Returns (hits, gitleaks_ran). gitleaks_ran=False means the regex
    fallback in claude_agent_lib is the ONLY layer that ran -- logged
    explicitly by the caller so a human can tell the two cases apart,
    instead of a missing binary silently looking identical to "scanned and
    clean" (2026-11 review, should-fix)."""
    gitleaks = shutil.which("gitleaks")
    if not gitleaks:
        return [], False
    with tempfile.TemporaryDirectory() as td:
        if is_file:
            shutil.copy(path_or_text, Path(td) / "candidate")
        else:
            (Path(td) / "candidate").write_text(path_or_text, encoding="utf-8")
        result = run([gitleaks, "detect", "--no-git", "--source", td, "--exit-code", "2"])
        if result.returncode == 2:
            return ["gitleaks detected a secret-shaped match"], True
        if result.returncode not in (0, 2):
            return [f"gitleaks exited {result.returncode} unexpectedly: {result.stderr}"], True
        return [], True


def scan_both_layers(text: str) -> list[str]:
    hits = scan_text_for_secrets(text)
    gitleaks_hits, ran = run_gitleaks_if_available(text, is_file=False)
    print(f"gitleaks active: {'yes' if ran else 'no (regex-only layer ran)'}", file=sys.stderr)
    return hits + gitleaks_hits


def post_comment(repo: str, issue: str, body: str) -> None:
    r = run(["gh", "issue", "comment", issue, "--repo", repo, "--body", body], capture_output=False)
    if r is not None and getattr(r, "returncode", 0):
        raise RuntimeError("gh issue comment failed")


_SYMLINK_SUMMARY_RE_STRS = (" 120000", " 160000")


def post_apply_violations(repo_dir: str) -> list[str]:
    """Re-check paths and modes against what git ACTUALLY staged, after
    `git apply --index` -- not just what the pre-apply text parsing
    predicted (2026-11 round-2 review, blocker). `git apply` could in
    principle interpret something slightly differently than the text-based
    checks assumed; this is the belt to the pre-apply checks' suspenders.
    Uses `-z` (NUL-separated) output so a path containing a literal
    newline can't be split into two entries and partially miss a check.
    """
    violations: list[str] = []

    names = run(
        ["git", "-c", "core.quotepath=false", "diff", "--cached", "--name-only", "-z"],
        cwd=repo_dir,
    )
    staged_paths = [p for p in (names.stdout or "").split("\0") if p]
    violations += [f"protected path staged: {p}" for p in protected_path_violations(staged_paths)]

    summary = run(["git", "diff", "--cached", "--summary"], cwd=repo_dir)
    summary_text = summary.stdout or ""
    for line in summary_text.splitlines():
        if any(marker in line for marker in _SYMLINK_SUMMARY_RE_STRS):
            violations.append(f"risky mode staged: {line.strip()}")

    return violations


def safe_push(repo_dir: str, repo: str, branch: str, bot_email: str, github_token: str) -> subprocess.CompletedProcess:
    """Push `branch`, but never blindly force-push over work this bot didn't
    author itself (2026-11 review, should-fix: unconditional -f could
    discard a human's manual push to the same branch between rounds).

    - branch doesn't exist on origin yet -> plain push
    - branch exists and its tip was authored by `bot_email` (i.e. it's only
      ever held our own prior automated attempts) -> force-push is safe
    - branch exists with a different author -> refuse; the caller decides
      what to tell the issue
    """
    basic_auth = base64.b64encode(f"x-access-token:{github_token}".encode()).decode()
    git_auth = ["git", "-c", f"http.extraheader=AUTHORIZATION: basic {basic_auth}"]

    ls_remote = run(git_auth + ["ls-remote", "origin", f"refs/heads/{branch}"], cwd=repo_dir)
    remote_exists = bool((ls_remote.stdout or "").strip())

    force = False
    if remote_exists:
        fetch = run(git_auth + ["fetch", "origin", branch], cwd=repo_dir)
        if fetch.returncode == 0:
            author = run(["git", "log", "-1", "--format=%ae", "FETCH_HEAD"], cwd=repo_dir)
            remote_author = (author.stdout or "").strip()
            if remote_author == bot_email:
                force = True
            else:
                return subprocess.CompletedProcess(
                    args=["git", "push"], returncode=17,
                    stdout="", stderr=(
                        f"refusing to overwrite {branch}: its current tip was authored by "
                        f"{remote_author!r}, not this bot ({bot_email!r}) -- someone else's "
                        "work may be on that branch"
                    ),
                )

    push_args = git_auth + ["push"]
    if force:
        push_args.append("--force-with-lease")
    push_args += ["origin", f"HEAD:refs/heads/{branch}"]
    return run(push_args, cwd=repo_dir)


NO_SUMMARY_MESSAGE = (
    "⚠️ 這一輪沒有產生任何摘要（agent 可能提早結束、判定不需要處理，或執行中出錯），"
    "請工程師查看 run log 確認原因。"
)


def parse_agent_report(report_bytes: str | None) -> dict:
    """Parse the agent job's self-reported report.json into a dict.

    Pulled out of main() (2026-11, after a live canary run) so the three
    "something went wrong with the report file" paths -- missing file,
    invalid JSON, valid JSON that isn't an object (e.g. the agent wrote
    `{}` because it never got far enough to write findings_summary, or
    refused the whole task) -- are independently testable without having
    to drive the rest of main()'s subprocess/git side effects.

    Every fallback message says *why* there's nothing to show, instead of
    the old bare "(no summary)", which a live canary (issue #3917, run
    42294117055) showed up as the entire visible comment body with zero
    explanation of what happened.
    """
    if report_bytes is None:
        return {"findings_summary": "agent did not produce a report file, please check run log"}
    try:
        report = json.loads(report_bytes)
    except json.JSONDecodeError:
        return {"findings_summary": "agent report was not valid JSON, original content skipped, please check run log"}
    if not isinstance(report, dict):
        # agent wrote valid JSON that wasn't an object (a list, a bare
        # string, a number, null) -- `.get()` below would crash on any
        # of those. Should-fix, 2026-11 round-2 review.
        return {"findings_summary": "agent report JSON was not an object, original content skipped, please check run log"}
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--issue", required=True)
    ap.add_argument("--repo-dir", required=True, help="a FRESH checkout, never touched by the agent")
    ap.add_argument("--patch-file", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--base-branch", default="staging")
    ap.add_argument("--branch-name", required=True)
    ap.add_argument("--bot-email", default="noreply@anthropic.com")
    args = ap.parse_args()

    report_path = Path(args.report)
    report_bytes = report_path.read_text(encoding="utf-8") if report_path.exists() else None
    report = parse_agent_report(report_bytes)

    findings_summary = str(report.get("findings_summary") or NO_SUMMARY_MESSAGE)
    needs_engineer = bool(report.get("needs_engineer"))
    acceptance_steps = str(report.get("acceptance_steps") or "open the preview URL below and confirm the original issue is fixed")
    pr_title_raw = str(report.get("pr_title") or f"fix: automated change (Fixes #{args.issue})")
    # Neutralize any close/fix/resolve-#N the agent wrote so it can't
    # silently auto-close an unrelated issue when this PR merges (should-fix,
    # 2026-11 round-2 review). The ONE legitimate "Fixes #{args.issue}" is
    # added separately, directly in the pr_body template below -- never
    # through this value, so it's unaffected.
    pr_body_extra = neutralize_closing_keywords(str(report.get("pr_body_extra") or ""))

    agent_text_hits = scan_both_layers(
        "\n".join([findings_summary, acceptance_steps, pr_title_raw, pr_body_extra])
    )
    if agent_text_hits:
        # Count, not the hit list -- see the comment in
        # publish_pr_review_comment.py's equivalent print for why
        # (CodeQL py/clear-text-logging-sensitive-data; these are
        # human-readable pattern labels, never the matched secret text,
        # but the count is all a human needs from the log either way).
        print(f"REFUSED: agent-authored text failed secret scan ({len(agent_text_hits)} pattern(s) matched)", file=sys.stderr)
        post_comment(
            args.repo, args.issue,
            f"{BOT_PREFIX}\n\n{SECRET_REDACTED_NOTICE}\n\n這一輪的其他部分也不會發佈。",
        )
        return 6

    patch_path = Path(args.patch_file)
    patch_text = patch_path.read_text(encoding="utf-8", errors="replace") if patch_path.exists() else ""

    if not patch_text.strip():
        body = f"{BOT_PREFIX}\n\n{findings_summary}\n"
        if needs_engineer:
            body += f"\n{NEEDS_ENGINEER_FOOTER}\n"
        post_comment(args.repo, args.issue, body)
        print("no patch / empty patch, comment posted, nothing to publish")
        return 0

    structural_violations = patch_safety_violations(patch_text)
    if structural_violations:
        body = (
            f"{BOT_PREFIX}\n\n{findings_summary}\n\n---\n"
            "⛔ **這一輪的改動被安全政策拒絕發佈**：patch 的結構有安全疑慮，"
            "不會 commit / push / 開 PR：\n"
            + "\n".join(f"- {v}" for v in structural_violations)
            + "\n\n（malformed diff header／binary 檔案／symlink 或 submodule"
            "都不自動發佈，一律由人審查。）\n"
        )
        post_comment(args.repo, args.issue, body)
        print(f"REFUSED: patch structural safety violation: {structural_violations}", file=sys.stderr)
        return 9

    changed = extract_changed_paths_from_patch(patch_text)
    violations = protected_path_violations(changed)
    if violations:
        body = (
            f"{BOT_PREFIX}\n\n{findings_summary}\n\n---\n"
            "⛔ **這一輪的改動被安全政策拒絕發佈**：改到了受保護路徑，"
            "不會 commit / push / 開 PR：\n"
            + "\n".join(f"- `{f}`" for f in violations)
            + "\n\n這類路徑（`.github/**`、`conftest.py`、`scripts/**`、"
            "`entrypoint.sh`、`Dockerfile*`）控制的是這支 workflow／CI／容器"
            "本身之後怎麼跑，所以一律由人審查，不自動發佈。\n"
        )
        post_comment(args.repo, args.issue, body)
        print(f"REFUSED: protected path violation: {violations}", file=sys.stderr)
        return 3

    diff_hits = scan_both_layers(patch_text)
    if diff_hits:
        body = (
            f"{BOT_PREFIX}\n\n{findings_summary}\n\n---\n"
            f"{SECRET_REDACTED_NOTICE}\n"
        )
        post_comment(args.repo, args.issue, body)
        print(f"REFUSED: secret scan hit on patch ({len(diff_hits)} pattern(s) matched)", file=sys.stderr)
        return 4

    run(["git", "checkout", "-B", args.branch_name], cwd=args.repo_dir, check=True)

    check = run(["git", "apply", "--check", "--binary", str(patch_path)], cwd=args.repo_dir)
    if check.returncode != 0:
        body = (
            f"{BOT_PREFIX}\n\n{findings_summary}\n\n---\n"
            "⚠️ 這一輪的改動沒辦法乾淨套用到目前的 staging（可能跟同時進行的"
            "其他改動衝突），不會 commit / push / 開 PR。請工程師手動處理。\n"
        )
        post_comment(args.repo, args.issue, body)
        print(f"REFUSED: patch does not apply cleanly: {check.stderr}", file=sys.stderr)
        return 7

    run(["git", "apply", "--binary", "--index", str(patch_path)], cwd=args.repo_dir, check=True)

    # Re-check against what git ACTUALLY staged, not just what the pre-apply
    # text parsing predicted -- belt-and-suspenders in case `git apply`
    # interpreted something differently than assumed (2026-11 round-2
    # review, blocker). Nothing is committed yet, so a hit here just means
    # `git reset --hard` back to a clean tree -- no partial state to clean up.
    post_apply = post_apply_violations(args.repo_dir)
    if post_apply:
        run(["git", "reset", "--hard", "HEAD"], cwd=args.repo_dir)
        body = (
            f"{BOT_PREFIX}\n\n{findings_summary}\n\n---\n"
            "⛔ **這一輪的改動被安全政策拒絕發佈**：套用後重新檢查磁碟上實際"
            "變了什麼，發現跟 patch 文字分析的結果不一致，保守起見不發佈：\n"
            + "\n".join(f"- {v}" for v in post_apply)
            + "\n"
        )
        post_comment(args.repo, args.issue, body)
        print(f"REFUSED: post-apply re-check found: {post_apply}", file=sys.stderr)
        return 10

    commit_msg = f"fix(#{args.issue}): automated change from the issue-agent workflow\n\nRefs: #{args.issue}"
    run(
        ["git", "-c", "user.name=claude-issue-agent", "-c", f"user.email={args.bot_email}",
         "commit", "-m", commit_msg],
        cwd=args.repo_dir, check=True,
    )

    github_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not github_token:
        raise RuntimeError("GH_TOKEN/GITHUB_TOKEN not set for the trusted publish step")

    push = safe_push(args.repo_dir, args.repo, args.branch_name, args.bot_email, github_token)
    if push.returncode != 0:
        safe_stderr = _redact(push.stderr, github_token)
        body = (
            f"{BOT_PREFIX}\n\n{findings_summary}\n\n---\n"
            f"⚠️ 無法推上分支 `{args.branch_name}`：```\n{safe_stderr[:500]}\n```\n"
            "請工程師手動處理（分支上可能有別人的改動）。\n"
        )
        post_comment(args.repo, args.issue, body)
        print(f"REFUSED: push failed: {safe_stderr}", file=sys.stderr)
        return 8

    pr_title = pr_title_raw
    if "#" + str(args.issue) not in pr_title and f"Fixes #{args.issue}" not in pr_title:
        pr_title = f"{pr_title} (Fixes #{args.issue})"
    pr_body = (
        f"Fixes #{args.issue}\n\n"
        f"## Summary\n\n{pr_body_extra}\n\n"
        f"{AGENT_CODE_DISCLAIMER}\n"
        "## Automated by\n\n"
        "claude-issue-agent.yml's trusted publish job (a separate job, on a "
        "fresh checkout the agent never had write access to) applied this "
        "patch, committed, pushed, and opened this PR after the "
        "protected-path and secret-scan checks passed.\n"
    )

    pr = run(
        ["gh", "pr", "create", "--repo", args.repo, "--draft", "--base", args.base_branch,
         "--head", args.branch_name, "--title", pr_title, "--body", pr_body]
    )
    if pr.returncode != 0:
        safe_stderr = _redact(pr.stderr, github_token).strip()[:500]
        body = (
            f"{BOT_PREFIX}\n\n{findings_summary}\n\n---\n"
            f"⚠️ 改動已推上分支 `{args.branch_name}`，但自動開 PR 失敗："
            f"```\n{safe_stderr}\n```\n請工程師手動開 PR。\n"
        )
        post_comment(args.repo, args.issue, body)
        print(f"PR create failed: {safe_stderr}", file=sys.stderr)
        return 5

    pr_url = (pr.stdout or "").strip()
    comment = f"{BOT_PREFIX}\n\n{findings_summary}\n\n"
    comment += f"### 🔧 Pull Request\n\n{pr_url}\n\n"
    comment += AGENT_CODE_DISCLAIMER + "\n"
    comment += f"### 🧪 測試網址（幾分鐘後部署完成）\n\n{PREVIEW_URL_TEMPLATE.format(n=args.issue)}\n\n"
    if needs_engineer:
        comment += NEEDS_ENGINEER_FOOTER
    else:
        comment += CTA_TEMPLATE.format(acceptance_steps=acceptance_steps)
    post_comment(args.repo, args.issue, comment)
    print(f"published PR: {pr_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
