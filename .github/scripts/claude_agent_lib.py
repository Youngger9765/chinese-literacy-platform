"""Shared, dependency-free logic for the two Claude GitHub Actions agents.

Why this file exists (Claude Security findings find_01G9Gm8oJ3dRZN4X2HMbQoP7 and
find_01QFjr9CLgAJwsZv8m59RjLN, 2026-11): both `claude-issue-agent.yml` and
`claude-pr-review.yml` let an autonomous Claude Code agent read text that an
untrusted GitHub user can write (an issue body/comment, or a fork PR's diff).
The only thing that used to stand between that text and a write-scoped
GITHUB_TOKEN / the long-lived CLAUDE_CODE_OAUTH_TOKEN was the model's own
judgement about whether to follow injected instructions.

This module holds every piece of that gate that can be expressed as plain,
testable Python instead of model judgement:
  - stripping HTML comments (the classic injection hiding spot) before any
    text reaches the agent's prompt or context file
  - deciding whether a GitHub author_association counts as "trusted"
  - refusing a diff that touches a path that could change how CI/the
    container/a future run of this very workflow behaves
  - a deterministic (non-LLM) secret-shaped-string scanner used as a second
    layer alongside the real `gitleaks` binary
  - counting how many times this bot has already worked an issue, so the
    3-round cap is enforced by a script, not by the model counting its own
    prior comments

Both `.github/scripts/fetch_trusted_issue_context.py` and
`.github/scripts/validate_and_publish.py` import this module. Keeping the
logic here (not duplicated inline in two scripts) is what makes
`backend/tests/test_claude_agent_lib_security.py` able to flip one behavior
and watch exactly one place need to change.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

TRUSTED_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})

# Paths the trusted publish step refuses to push, no matter what the agent
# wrote. These are the files that control how THIS workflow (or the test
# container, or CI itself) behaves next time -- letting an agent run change
# them silently would mean "safety enforced by tool policy" quietly becomes
# "safety enforced by whatever the last injected diff rewrote the policy to".
PROTECTED_PATH_PATTERNS = (
    re.compile(r"^\.github/"),
    re.compile(r"(^|/)conftest\.py$"),
    re.compile(r"^scripts/"),
    re.compile(r"(^|/)entrypoint\.sh$"),
    re.compile(r"(^|/)Dockerfile"),
    # `git apply` already refuses any hunk targeting a `.git/` path outright
    # ("error: invalid path '.git/...'", verified locally) -- this entry is
    # defense in depth so the refusal is OUR clear message (named in the
    # issue comment) rather than relying solely on git's own internal
    # rejection, which would otherwise surface as a generic "patch does not
    # apply cleanly" with no explanation of why.
    re.compile(r"^\.git/"),
)

# Deterministic fallback/second-layer secret scanner. Real `gitleaks` is the
# primary scan (see run_gitleaks in validate_and_publish.py); this regex list
# has zero external dependencies so it can run (and be mutation-tested) with
# no network access and no installed binary.
SECRET_PATTERNS = (
    ("GitHub token", re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}")),
    ("Google OAuth/API token", re.compile(r"\bya29\.[A-Za-z0-9_-]{20,}")),
    ("Google API key", re.compile(r"\bAIza[A-Za-z0-9_-]{20,}")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("Generic API key", re.compile(r"\bsk-[A-Za-z0-9]{20,}")),
    ("Private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    (
        "Bearer token in text",
        re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*"),
    ),
)

# The exact marker every published comment from these two workflows carries
# (see docs/issue-claude-agent.md). Counting it is how the round cap works
# without trusting the model's own "which round am I on" arithmetic.
BOT_COMMENT_MARKER = "🤖 由 Claude AI 代發（非 Young 本人）"

HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def strip_html_comments(text: str) -> str:
    """Remove every HTML comment from *text*.

    HTML comments render invisibly on github.com but are plain text in the
    API response this workflow reads (`gh issue view --json body,comments`,
    `gh pr diff`) -- exactly where the published injection technique this
    repo already defends against (docs/issue-claude-agent.md; Microsoft,
    2026-05) hides its payload. Stripping happens before text is written to
    any context file the agent later Reads, regardless of who authored it.
    """
    if not text:
        return text
    return HTML_COMMENT_RE.sub("", text)


def is_trusted_association(association: str | None) -> bool:
    """Whether a GitHub `author_association` counts as an insider.

    OWNER/MEMBER/COLLABORATOR mirrors the existing trigger gate in both
    workflows. CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE, and anything else
    (including a missing/unexpected value) is untrusted -- fail closed.
    """
    return bool(association) and association in TRUSTED_ASSOCIATIONS


def protected_path_violations(changed_files: list[str]) -> list[str]:
    """Return the subset of *changed_files* the publish step must refuse.

    Order of checks matches PROTECTED_PATH_PATTERNS; a file can match more
    than one pattern but is only returned once.
    """
    hits = []
    for path in changed_files:
        normalized = path.strip()
        if not normalized:
            continue
        if any(p.search(normalized) for p in PROTECTED_PATH_PATTERNS):
            hits.append(normalized)
    return hits


# `diff --git a/<path> b/<path>` header line, as produced by
# `git -c core.quotepath=false diff --binary`. quotepath=false is what keeps
# a non-ASCII path (e.g. containing Chinese characters) printed as raw UTF-8
# instead of a C-style-quoted octal-escaped string that this regex (and any
# naive string match against PROTECTED_PATH_PATTERNS) would silently fail to
# recognize -- a real bypass found in adversarial review 2026-11: a
# protected-looking rename done through a non-ASCII intermediate path, or a
# secret-carrying file given a non-ASCII name, must not escape the checks
# below just because quoting mangled its name in the diff header.
_DIFF_HEADER_RE = re.compile(r"^diff --git a/(.+) b/(.+)$", re.MULTILINE)


def extract_changed_paths_from_patch(patch_text: str) -> list[str]:
    """Pull every path a unified diff/patch touches, from its `diff --git`
    headers. Used by the trusted publish step to run `protected_path_violations`
    against a patch file BEFORE ever applying it to a working tree -- the
    check happens on text, not on `git diff --name-only` against a
    potentially agent-tampered checkout."""
    paths: set[str] = set()
    for m in _DIFF_HEADER_RE.finditer(patch_text):
        paths.add(m.group(1))
        paths.add(m.group(2))
    return sorted(paths)


# Any line starting "diff --git " at all, clean or not -- used to detect a
# header the strict extractor silently can't parse (2026-11 round-2 review,
# blocker). A header git couldn't print in the clean `a/X b/Y` form (a path
# containing a literal `"`, backslash, or tab) would otherwise just not
# match `_DIFF_HEADER_RE` and vanish from `extract_changed_paths_from_patch`
# silently -- the same shape of bypass as the quotepath one, through a
# different escaping trigger. Fail closed: if any such line exists, the
# whole patch is rejected rather than guessing at what the real path was.
_DIFF_GIT_LINE_RE = re.compile(r"^diff --git (.*)$", re.MULTILINE)
_CLEAN_HEADER_BODY_RE = re.compile(r'^a/([^"\\\t]+) b/([^"\\\t]+)$')


def find_malformed_diff_headers(patch_text: str) -> list[str]:
    """Return every `diff --git` line that is NOT in the clean, unquoted
    `a/<path> b/<path>` form -- i.e. every header `extract_changed_paths_from_patch`
    could not have parsed correctly. A non-empty result means: reject the
    whole patch, don't try to partially trust it."""
    malformed = []
    for m in _DIFF_GIT_LINE_RE.finditer(patch_text):
        rest = m.group(1)
        if not _CLEAN_HEADER_BODY_RE.match(rest):
            malformed.append(m.group(0))
    return malformed


# A git binary patch (`GIT binary patch` section) or a diff that fell back
# to "Binary files a/X and b/X differ" both encode/hide the actual content
# change from any text-based scanner -- base85 in the former case, nothing
# at all in the latter. Our secret scanners only look at plain text, so
# either marker means "this patch could be smuggling a secret (or anything
# else) completely invisibly" (2026-11 round-2 review, blocker). The fix is
# to refuse the whole patch rather than attempt to scan inside an encoding
# none of our scanners understand.
_BINARY_PATCH_MARKERS = (
    re.compile(r"^GIT binary patch$", re.MULTILINE),
    re.compile(r"^Binary files .* differ$", re.MULTILINE),
)


def find_binary_patch_markers(patch_text: str) -> list[str]:
    hits = []
    for pattern in _BINARY_PATCH_MARKERS:
        hits.extend(m.group(0) for m in pattern.finditer(patch_text))
    return hits


# Git file modes: 120000 = symlink, 160000 = gitlink (submodule reference).
# A symlink's "content" in a patch is just a short target-path string --
# tiny enough to sail through any secret scan -- but once applied and later
# read by some OTHER process that assumes it's reading a plain file (a
# future CI step, a script that `cat`s a committed file), it can disclose
# an arbitrary file on that process's filesystem (../../ escapes already
# refused by `git apply` itself for the entries directly under this repo,
# but a symlink is a persistent, reusable version of the same idea that
# outlives this one job). A gitlink lets a `git submodule update --init`
# anywhere downstream clone and execute code from an attacker-chosen URL.
# Neither has any legitimate use in an automated bug-fix patch (2026-11
# round-2 review, blocker).
_RISKY_MODE_MARKERS = (
    re.compile(r"^new file mode 120000$", re.MULTILINE),
    re.compile(r"^new mode 120000$", re.MULTILINE),
    re.compile(r"^new file mode 160000$", re.MULTILINE),
)


def find_risky_file_modes(patch_text: str) -> list[str]:
    hits = []
    for pattern in _RISKY_MODE_MARKERS:
        hits.extend(m.group(0) for m in pattern.finditer(patch_text))
    return hits


def patch_safety_violations(patch_text: str) -> list[str]:
    """Run every structural patch-safety check (not the protected-path or
    secret-content checks, which are separate) and return a combined,
    human-readable list of violations. Empty means the patch's STRUCTURE is
    safe to apply -- callers still need `extract_changed_paths_from_patch`
    + `protected_path_violations` and a secret-content scan on top of this."""
    violations = []
    malformed = find_malformed_diff_headers(patch_text)
    if malformed:
        violations.append(
            f"{len(malformed)} diff header(s) not in the clean a/X b/Y form "
            "(path contains a quote/backslash/tab, or similar escaping)"
        )
    binary = find_binary_patch_markers(patch_text)
    if binary:
        violations.append(
            f"{len(binary)} binary file change(s) (GIT binary patch / "
            "Binary files ... differ) -- content is not scannable as text"
        )
    risky_modes = find_risky_file_modes(patch_text)
    if risky_modes:
        violations.append(
            f"{len(risky_modes)} symlink/gitlink creation(s) ({', '.join(risky_modes)})"
        )
    return violations


# GitHub auto-closes the issue named by `close(s|d)`/`fix(es|ed)`/
# `resolve(s|d)` immediately followed by `#<number>` with no space, when
# that text appears in a merged PR's body (or a commit message on the
# default branch). Agent-authored free text (pr_body_extra) must not be
# able to silently close an unrelated issue this way -- whether from a
# prompt-injection attempt or just the model echoing something it read
# (2026-11 round-2 review, should-fix). The one legitimate "Fixes #N" this
# workflow adds itself is built directly into the PR body template, never
# through this function, so it's never touched by it.
_CLOSING_KEYWORD_RE = re.compile(
    r"\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)(\s+)#(\d+)",
    re.IGNORECASE,
)


def neutralize_closing_keywords(text: str) -> str:
    """Break the adjacency GitHub's closing-keyword parser requires
    (keyword, whitespace, then `#` immediately followed by digits) by
    inserting a space after the `#`. The text stays readable; GitHub's
    parser no longer recognizes it as a closing reference."""
    return _CLOSING_KEYWORD_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}# {m.group(3)}", text)


def scan_text_for_secrets(text: str) -> list[str]:
    """Deterministic secret-shaped-string scan. Returns human-readable hits.

    This is the fallback/second layer described in the module docstring --
    it never needs network access or an installed binary, so it is the part
    of the gitleaks gate that `backend/tests` can mutation-test directly.
    """
    hits = []
    for label, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            hits.append(label)
    return hits


@dataclass
class IssueContext:
    """Result of filtering one issue's title/body/comments by trust."""

    included_title: str | None = None
    included_body: str | None = None
    excluded_issue_author: bool = False
    included_comments: list[str] = field(default_factory=list)
    excluded_comment_count: int = 0
    round_count: int = 0


# Empirically verified against this repo's own history (2026-11 review,
# blocker + follow-up check): `gh issue view --json comments` reports a
# comment the default GITHUB_TOKEN posted via `gh issue comment` with
# `author.login == "github-actions"` (no "[bot]" suffix) and
# `authorAssociation == "CONTRIBUTOR"` -- not "github-actions[bot]"/"NONE",
# which is what the first version of this file assumed. Checked directly:
# `gh issue view 3066/3067/3068 --repo Youngger9765/chinese-literacy-platform
# --json comments` (preview-deploy.yml / preview-cleanup.yml comments, both
# posted the same way this workflow posts) all show
# {"login": "github-actions"} / "CONTRIBUTOR". Separately, comments the
# claude-code-action itself posts (tag mode / track_progress, NOT used by
# this redesign) show up as login "claude", association "CONTRIBUTOR" --
# included here for completeness, not because this workflow relies on it.
# Round counting must not silently stop working because of which spelling a
# given `gh`/API version happens to return -- that would make the
# MAX_ROUNDS cap a no-op. Both "github-actions" and "github-actions[bot]"
# (kept as a defensive alternate in case a future `gh` version reverts to
# the REST-style name) are reserved system identities no ordinary GitHub
# user can register, so accepting either does not let an outsider inflate
# the count; a random user's login never matches, no matter what text they
# paste (see
# test_round_counting_ignores_a_lookalike_from_a_non_bot_login).
DEFAULT_BOT_LOGINS = ("github-actions", "github-actions[bot]")


def build_issue_context(
    *,
    issue_title: str,
    issue_body: str,
    issue_author_association: str | None,
    comments: list[dict],
    bot_logins: tuple[str, ...] = DEFAULT_BOT_LOGINS,
) -> IssueContext:
    """Apply the trust filter to one issue's title/body/comments.

    `comments` is the list shape `gh issue view --json comments` returns:
    each item has at least `body`, `authorAssociation`, and `author.login`.
    The issue's own title and body are included only when the ISSUE's
    author (not whoever later typed `@claude`) is OWNER/MEMBER/COLLABORATOR
    -- this is the exact gap finding find_01G9Gm8oJ3dRZN4X2HMbQoP7 names:
    "the gate checks only who triggers the run, not who wrote the rest of
    the thread," and the issue body is part of that thread even when a
    trusted collaborator is the one who later typed `@claude` on it.

    Round counting is deliberately a separate pass over the SAME
    `comments` list, matched by `bot_logins` rather than by
    `authorAssociation`: a comment the bot itself posted via the default
    `GITHUB_TOKEN` is reported with `authorAssociation: "CONTRIBUTOR"`
    (empirically verified, not "NONE" -- see the DEFAULT_BOT_LOGINS
    comment above), the same association an ordinary first-time outside
    contributor gets. Gating the round count on `is_trusted_association`
    would therefore be wrong in BOTH directions: it would never match the
    bot's own comments (cap never engages), and "CONTRIBUTOR" is not a
    trusted association anyway (correctly excluded from `included_comments`
    for an actual outside commenter). Matching on login instead sidesteps
    both problems. The bot's own past comments are counted but not fed
    back into `included_comments` -- the agent only needs the round
    NUMBER, not a replay of its own prior reports.
    """
    ctx = IssueContext()
    if is_trusted_association(issue_author_association):
        ctx.included_title = strip_html_comments(issue_title or "")
        ctx.included_body = strip_html_comments(issue_body or "")
    else:
        ctx.excluded_issue_author = True

    for comment in comments:
        assoc = comment.get("authorAssociation")
        body = comment.get("body") or ""
        login = (comment.get("author") or {}).get("login")

        if login in bot_logins and BOT_COMMENT_MARKER in body:
            ctx.round_count += 1
            continue

        if is_trusted_association(assoc):
            ctx.included_comments.append(strip_html_comments(body))
        else:
            ctx.excluded_comment_count += 1

    return ctx
