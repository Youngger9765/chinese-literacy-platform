"""#3055 — issue @claude 自動開工代理的安全結構鎖 (TDD).

2026-11 安全重設計（第一版）：鎖的是「agent 這一步有沒有 Bash、能不能讀
.git//proc/HOME/runner temp 以外的任何東西、workflow 權限有沒有
id-token」—— 把安全邊界從「模型會不會聽話」換成「工具政策允不允許」
（Claude Security finding find_01G9Gm8oJ3dRZN4X2HMbQoP7）。

2026-11 第二版（對抗式複審後）：第一版漏了一個更根本的洞 —— agent 仍有
Edit/Write 可以碰 `.github/scripts/*.py` 這些信任腳本自己的原始碼，
而「信任步驟」原本跟 agent 同一個 job、同一個 checkout 執行，等於可能
執行 agent 竄改過的程式碼。現在拆成兩個 job：`agent`（只讀/想/寫報告，
從不 commit/push/開 PR，job 權限只剩 issues:write）與 `publish`（全新
checkout，agent 的 Edit/Write 從未碰過，只看 agent job 產出的 patch
文字做決定）。本檔同時鎖兩個 job 各自的權限邊界與兩者之間的 artifact
交接，而不是單一 job 內的單一步驟順序。

每一條斷言 revert 對應的設計決策都應該變紅 —— 本檔刻意不測「prompt 寫了
什麼安全宣告」，因為那正是舊設計被打穿的地方。
"""

from pathlib import Path

import yaml

WF = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "claude-issue-agent.yml"
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / ".github" / "scripts"


def _load():
    raw = WF.read_text(encoding="utf-8")
    return raw, yaml.safe_load(raw)


def _agent_job(doc):
    return doc["jobs"]["agent"]


def _publish_job(doc):
    return doc["jobs"]["publish"]


def _agent_step(doc):
    steps = _agent_job(doc)["steps"]
    agent_steps = [s for s in steps if "claude-code-action" in str(s.get("uses", ""))]
    assert len(agent_steps) == 1, "expected exactly one claude-code-action step"
    return agent_steps[0]


def _allowed_tools_string(doc) -> str:
    step = _agent_step(doc)
    return str(step["with"].get("claude_args", ""))


def _settings_json_text(raw: str) -> str:
    """The settings.json heredoc is written inline in a prior `run:` step —
    pull out the body between the two `JSON` heredoc markers. The closing
    marker is indented to match the surrounding YAML block scalar, so the
    search allows leading whitespace before it."""
    import re

    m = re.search(
        r"cat > \.claude-issue-agent/settings\.json <<'JSON'\n(.*?)\n[ \t]*JSON\n",
        raw,
        re.DOTALL,
    )
    assert m, "could not locate the settings.json heredoc in the workflow file"
    return m.group(1)


# ── Trigger gate (unchanged by this redesign, still the first line of defense) ──


def test_trigger_gate_requires_insider_association():
    raw, doc = _load()
    cond = _agent_job(doc)["if"]
    for assoc in ("OWNER", "MEMBER", "COLLABORATOR"):
        assert assoc in cond
    assert cond.count("author_association") >= 2, (
        "issues 與 issue_comment 兩條觸發路徑必須各自把關"
    )
    assert "@claude" in cond
    assert "!github.event.issue.pull_request" in cond


# ── find_01G9Gm8oJ3dRZN4X2HMbQoP7: no Bash at all for the agent ──────────


def test_agent_allowlist_has_no_bash():
    """The core fix. Revert: add Bash(...) back to --allowedTools -> red."""
    allowed = _allowed_tools_string(_load()[1])
    import re

    m = re.search(r'--allowedTools\s+"([^"]*)"', allowed)
    assert m, "agent step must set --allowedTools explicitly"
    allowed_list = [t.strip() for t in m.group(1).split(",")]
    assert allowed_list == ["Read", "Grep", "Glob", "Edit", "Write"], (
        f"agent allowedTools changed: {allowed_list} — Bash (or any exec/network "
        "tool) must never be in this list"
    )
    assert "Bash" not in allowed_list


def test_agent_explicitly_disallows_bash_and_network_tools():
    """Belt-and-suspenders: --disallowedTools always wins over --allowedTools
    for the same pattern, so this is a second, independent gate."""
    allowed = _allowed_tools_string(_load()[1])
    import re

    m = re.search(r'--disallowedTools\s+"([^"]*)"', allowed)
    assert m, "agent step must set --disallowedTools explicitly"
    disallowed = [t.strip() for t in m.group(1).split(",")]
    for tool in ("Bash", "WebFetch", "WebSearch", "Agent"):
        assert tool in disallowed, f"{tool} must be explicitly disallowed"


def test_no_bash_anywhere_in_the_agent_steps_with_block():
    """The settings input and claude_args are the only places tool access is
    granted for the agent step -- assert the literal string "Bash(" (a
    scoped allow rule, the shape the old vulnerable version used) is absent
    from the whole file, not just the allowedTools list.

    `curl`/`wget` themselves are now legitimately present in the file (the
    trusted "Validate, scan, and publish" step downloads a pinned gitleaks
    release with curl) -- the thing that must stay absent is network/exec
    tool access reachable BY THE AGENT, so this checks the agent step's own
    `with:` block specifically, not the whole file."""
    _, doc = _load()
    agent = _agent_step(doc)
    agent_with_text = str(agent.get("with", ""))
    assert "Bash(" not in agent_with_text, (
        "a scoped Bash(...) allow rule reappeared in the agent step — "
        "the agent must have zero exec capability, not a narrowed one"
    )
    for tool in ("curl", "wget", "Bash(nc", "ssh:", "scp:"):
        assert tool not in agent_with_text, f"{tool!r} must not appear in the agent step's config"


# ── deny paths: .git/**, /proc/**, $HOME/**, runner temp, outside workspace ──


def test_agent_settings_deny_git_proc_home_and_runner_temp():
    """Revert any one of these deny entries -> red. This is the literal
    checklist the redesign spec calls out by name."""
    raw, _ = _load()
    settings_text = _settings_json_text(raw)
    settings = __import__("json").loads(settings_text)
    deny = settings["permissions"]["deny"]

    assert "Bash" in deny
    assert any(".git/**" in d for d in deny), "missing .git/** deny"
    assert any("proc" in d for d in deny), "missing /proc/** deny"
    assert any(d.startswith("Read(~/") or d.startswith("Edit(~/") for d in deny), (
        "missing $HOME (~/) deny"
    )
    assert any("runner.temp" in d for d in deny), (
        "missing runner-temp deny (the one path-shaped value that has to be "
        "templated at run time, since the actual path varies by runner)"
    )


def test_agent_settings_deny_writes_to_agent_config_files():
    """Claude Security finding find_01DYS1ZqNpdcAmH7VSV1YkJA: this agent
    job HAS Edit+Write (unlike the pr-review job, which denies bare
    Edit). Without an explicit deny, the agent could rewrite .claude/**,
    CLAUDE.md, AGENTS.md, or .mcp.json -- which would steer every
    subsequent agent run in this repo, including this one's own next
    run. Revert any one of these deny entries -> red."""
    raw, _ = _load()
    settings = __import__("json").loads(_settings_json_text(raw))
    deny = settings["permissions"]["deny"]

    for path in (".claude/**", "CLAUDE.md", "AGENTS.md", ".mcp.json"):
        assert any(d == f"Edit({path})" or d == f"Edit(**/{path})" for d in deny), (
            f"missing Edit({path}) deny"
        )
        assert any(d == f"Write({path})" or d == f"Write(**/{path})" for d in deny), (
            f"missing Write({path}) deny"
        )


def test_agent_settings_block_everything_outside_the_working_directory():
    """blockReads/WritesOutsideWorkingDirectories is the official, documented
    mechanism that blocks file-tool access outside the checkout IN EVERY
    PERMISSION MODE, including bypassPermissions — see
    https://code.claude.com/docs/en/permissions#block-file-tool-reads-and-writes-outside-the-working-directories
    This is the "any path outside the workspace" half of the deny list; the
    explicit entries above cover the one path that's INSIDE the workspace
    (.git/**) plus belt-and-suspenders for the others."""
    raw, _ = _load()
    settings = __import__("json").loads(_settings_json_text(raw))
    perms = settings["permissions"]
    assert perms.get("blockReadsOutsideWorkingDirectories") is True
    assert perms.get("blockWritesOutsideWorkingDirectories") is True


def test_agent_settings_allow_list_is_exactly_file_tools():
    raw, _ = _load()
    settings = __import__("json").loads(_settings_json_text(raw))
    assert set(settings["permissions"]["allow"]) == {"Read", "Grep", "Glob", "Edit", "Write"}


# ── find_01G9Gm8oJ3dRZN4X2HMbQoP7 + already-fixed: no id-token ──────────


def test_no_id_token_write():
    _, doc = _load()
    for job_name, job in (("agent", _agent_job(doc)), ("publish", _publish_job(doc))):
        assert "id-token" not in job["permissions"], (
            f"{job_name} job: id-token must be entirely absent (not even "
            "id-token: read) — neither job calls Google Cloud"
        )


def test_agent_job_has_no_contents_or_pull_request_write():
    """Blocker fix (2026-11 review): the job that runs the untrusted-
    influenced agent must not hold the tokens that could commit/push/open a
    PR, even though the agent itself has no tool to use them -- defense in
    depth against anything this review (or a future one) didn't think of."""
    _, doc = _load()
    perms = _agent_job(doc)["permissions"]
    assert isinstance(perms, dict), "permissions 必須逐項宣告, 不可 write-all"
    assert set(perms) == {"issues"}, (
        f"agent job must hold ONLY issues:write, got {perms} — contents/"
        "pull-requests write must live in the publish job only"
    )


def test_publish_job_permissions_are_scoped_not_writeall():
    _, doc = _load()
    perms = _publish_job(doc)["permissions"]
    assert isinstance(perms, dict), "permissions 必須逐項宣告, 不可 write-all"
    assert set(perms) <= {"contents", "pull-requests", "issues"}, (
        f"多出非必要權限: {set(perms) - {'contents', 'pull-requests', 'issues'}}"
    )


def test_publish_job_runs_on_a_separate_fresh_checkout_pinned_to_agent_base_sha():
    """The core fix for 'the trusted step runs code the agent could have
    rewritten': the publish job must checkout the exact commit the AGENT
    job started from (not `staging` moving forward, and not anything from
    the agent job's own, possibly-tampered, working tree), via a job
    `needs:`/`outputs:` handoff, and that checkout must not persist
    credentials either."""
    _, doc = _load()
    assert _publish_job(doc)["needs"] == "agent"
    assert "needs.agent.outputs.skip" in str(_publish_job(doc)["if"])
    assert _agent_job(doc)["outputs"]["base_sha"] == "${{ steps.base.outputs.sha }}"

    base_step = [s for s in _agent_job(doc)["steps"] if s.get("id") == "base"]
    assert base_step, "agent job missing the id: base step that captures its starting commit"
    assert "git rev-parse HEAD" in str(base_step[0].get("run", ""))

    steps = _publish_job(doc)["steps"]
    checkout = [s for s in steps if "actions/checkout" in str(s.get("uses", ""))]
    assert checkout, "publish job missing its own actions/checkout step"
    assert checkout[0]["with"]["ref"] == "${{ needs.agent.outputs.base_sha }}"
    assert checkout[0]["with"]["persist-credentials"] is False


def test_agent_job_never_commits_pushes_or_opens_a_pr():
    """Structural proof the agent job's own steps hold no git-push/gh-pr-create
    capability at all -- that logic must live only in the publish job."""
    _, doc = _load()
    for step in _agent_job(doc)["steps"]:
        run_text = str(step.get("run", ""))
        assert "git push" not in run_text, f"agent job step {step.get('name')!r} pushes directly"
        assert "gh pr create" not in run_text, f"agent job step {step.get('name')!r} opens a PR directly"


def test_checkout_does_not_persist_credentials():
    _, doc = _load()
    steps = _agent_job(doc)["steps"]
    checkout = [s for s in steps if "actions/checkout" in str(s.get("uses", ""))]
    assert checkout, "missing actions/checkout step"
    assert checkout[0]["with"]["persist-credentials"] is False


# ── find_01G9Gm8oJ3dRZN4X2HMbQoP7: trusted step does the protected-path
#    refusal and the gitleaks scan, not the agent ─────────────────────────


def test_trusted_publish_step_exists_and_is_not_the_agent():
    _, doc = _load()
    steps = _publish_job(doc)["steps"]
    publish = [s for s in steps if "validate_and_publish.py" in str(s.get("run", ""))]
    assert publish, "missing the trusted 'validate, scan, and publish' step"
    assert "claude-code-action" not in str(publish[0].get("uses", ""))
    # The whole publish JOB runs with if: always() (see
    # test_publish_job_runs_on_a_separate_fresh_checkout...), so an
    # interrupted agent run still gets a comment, matching the old
    # interruption-notice behavior -- checked at the job level now, not a
    # per-step `if:`, since the step itself doesn't need its own condition
    # once the whole job is already gated that way.
    assert "always()" in str(_publish_job(doc)["if"])


def test_protected_path_refusal_logic_exists_and_actually_catches_the_listed_paths():
    """Structural: the script referenced by the trusted step exists and its
    protected-path function actually matches .github/**, conftest.py,
    scripts/**, entrypoint.sh, Dockerfile* — i.e. this is provably not a
    no-op, not just a grep for the word "protected"."""
    import sys

    sys.path.insert(0, str(SCRIPTS_DIR))
    import claude_agent_lib as lib  # noqa: E402

    hits = lib.protected_path_violations(
        [
            ".github/workflows/anything.yml",
            "conftest.py",
            "backend/tests/conftest.py",
            "scripts/anything.py",
            "entrypoint.sh",
            "Dockerfile",
        ]
    )
    assert len(hits) == 6, f"expected all six protected paths to be caught, got {hits}"

    clean = lib.protected_path_violations(["backend/app/main.py", "frontend/src/App.tsx"])
    assert clean == [], "ordinary application files must not be flagged"


def test_gitleaks_scan_is_wired_into_the_publish_job_with_checksum_verification():
    """Both the real `gitleaks` binary (pinned version, sha256-verified
    before use — should-fix from the 2026-11 review) and the dependency-free
    regex fallback must be present in the publish job."""
    _, doc = _load()
    steps = _publish_job(doc)["steps"]
    install = [s for s in steps if "gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" in str(s.get("run", ""))]
    assert install, "publish job must actually download the pinned gitleaks release"
    install_text = str(install[0]["run"])
    assert "sha256" in install_text.lower() or "SHA256" in install_text, (
        "gitleaks download must be checksum-verified before use, not installed blind"
    )
    assert "releases/download" in install_text

    publish = [s for s in steps if "validate_and_publish.py" in str(s.get("run", ""))]
    assert publish, "missing the step that invokes validate_and_publish.py"
    assert "--patch-file" in str(publish[0]["run"])


def test_publish_step_logs_whether_gitleaks_was_actually_active():
    """Structural+functional: the shared lib must emit a yes/no signal a
    human can find in the run log, instead of a missing binary silently
    looking identical to 'scanned and clean' (2026-11 review, should-fix)."""
    import sys

    sys.path.insert(0, str(SCRIPTS_DIR))
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "validate_and_publish", SCRIPTS_DIR / "validate_and_publish.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    hits, ran = mod.run_gitleaks_if_available("ordinary text", is_file=False)
    assert isinstance(ran, bool)


def test_publish_script_never_force_pushes_unconditionally():
    """`git push -f`/`--force` with no further check must not reappear —
    only `safe_push`'s conditional `--force-with-lease` (gated on the
    remote tip being this bot's own prior commit) is allowed."""
    script = (SCRIPTS_DIR / "validate_and_publish.py").read_text(encoding="utf-8")
    assert '"push", "-f"' not in script
    assert "'-f'" not in script
    assert "--force-with-lease" in script


def test_pr_body_and_comment_disclose_agent_written_code():
    """Should-fix (2026-11 review): the PR body/issue comment must say a
    human needs to review the diff, and must not imply CI passing is
    sufficient to merge."""
    script = (SCRIPTS_DIR / "validate_and_publish.py").read_text(encoding="utf-8")
    assert "AGENT_CODE_DISCLAIMER" in script
    assert "請工程師親自讀過完整 diff" in script or "review the full diff" in script.lower()


def test_secret_regex_scanner_actually_detects_a_token_shaped_string():
    """Not a structural grep — proves the deterministic second layer has
    teeth (red/green: comment out any one pattern in claude_agent_lib.py
    and this specific assertion goes red for that pattern)."""
    import sys

    sys.path.insert(0, str(SCRIPTS_DIR))
    import claude_agent_lib as lib  # noqa: E402

    token = "gh" + "p_" + "x" * 36
    assert lib.scan_text_for_secrets(f"export TOKEN={token}") == ["GitHub token"]
    assert lib.scan_text_for_secrets("totally ordinary diff content") == []


# ── runaway cost / concurrency (unchanged, still load-bearing) ──────────


def test_runaway_cost_controls():
    _, doc = _load()
    assert _agent_job(doc)["timeout-minutes"] <= 45
    assert _publish_job(doc)["timeout-minutes"] <= 30
    assert "concurrency" in doc
    assert "issue.number" in str(doc["concurrency"].get("group", ""))


def test_round_cap_short_circuits_the_agent_step():
    """The 3-round cap is enforced by the trusted fetch-context script's
    `skip` output, not by the model counting its own prior comments —
    assert the agent step (and the publish job) are actually conditioned
    on it."""
    _, doc = _load()
    steps = _agent_job(doc)["steps"]
    agent = _agent_step(doc)
    assert "steps.ctx.outputs.skip" in str(agent.get("if", ""))
    ctx_step = [s for s in steps if s.get("id") == "ctx"]
    assert ctx_step, "missing the id: ctx trusted context-fetch step"
    assert "fetch_trusted_issue_context.py" in str(ctx_step[0].get("run", ""))
    assert "needs.agent.outputs.skip" in str(_publish_job(doc)["if"])


def test_github_token_passed_explicitly_to_the_agent_action():
    """Should-fix (2026-11 review): with id-token removed, the official
    docs say the action's default GitHub-App auth path needs id-token;
    since neither job sets it, the agent step must pass its own job token
    explicitly instead so the action can still start. Safe here because the
    agent job's permissions are issues:write only (see
    test_agent_job_has_no_contents_or_pull_request_write)."""
    _, doc = _load()
    agent = _agent_step(doc)
    assert agent["with"].get("github_token") == "${{ github.token }}"


# ── artifact handoff between the two jobs ────────────────────────────────


def test_artifact_upload_and_download_names_match():
    _, doc = _load()
    agent_steps = _agent_job(doc)["steps"]
    upload = [s for s in agent_steps if "upload-artifact" in str(s.get("uses", ""))]
    assert upload, "agent job missing the artifact-upload step"
    upload_name = upload[0]["with"]["name"]

    publish_steps = _publish_job(doc)["steps"]
    download = [s for s in publish_steps if "download-artifact" in str(s.get("uses", ""))]
    assert download, "publish job missing the artifact-download step"
    download_name = download[0]["with"]["name"]

    assert upload_name == download_name
    assert "issue.number" in upload_name


def test_capture_artifact_step_is_plain_git_with_quotepath_disabled():
    """BLOCKER fix: the step that turns 'whatever the agent changed' into
    an artifact must be pure git (nothing for the agent to have tampered
    with that would change ITS OWN behavior), and must disable
    core.quotepath so a non-ASCII filename survives into the patch as raw
    UTF-8 instead of a C-escaped string the publish job's checks can't
    recognize (2026-11 review, blocker)."""
    _, doc = _load()
    steps = _agent_job(doc)["steps"]
    capture = [s for s in steps if s.get("id") == "capture"]
    assert capture, "missing the id: capture artifact step"
    run_text = str(capture[0]["run"])
    # the quotepath flag must be on THIS SPECIFIC diff command, not merely
    # present somewhere else in the step (e.g. on the `git add` line,
    # which doesn't need it -- quotepath only affects how `git diff`/`log`
    # RENDER paths in their text output, not which files `git add` stages)
    assert "git -c core.quotepath=false diff --cached --binary" in run_text, (
        "core.quotepath=false must be set specifically on the diff command "
        "that generates the patch text -- that's the one whose OUTPUT a "
        "non-ASCII filename needs to survive into unescaped"
    )
    # The ephemeral context/report dir must be excluded from what gets
    # captured -- via .gitignore (see test_gitignore_excludes_ephemeral_dirs),
    # NOT via an explicit `git add -- . ':!.claude-issue-agent'` pathspec.
    # Live canary run #42286478174 proved that exact combination is broken:
    # once a path is gitignored, `git add` hard-refuses (exit 1) the moment
    # any pathspec -- even a negative/exclude one -- names it at all. Plain
    # `git add -A` needs no exclusion pathspec; a gitignored directory is
    # already left out of its expansion with no error.
    assert ":!.claude-issue-agent" not in run_text, (
        "this exact pathspec form reliably exits 1 once the path is "
        "gitignored (verified locally and in run #42286478174) -- use "
        "plain `git add -A` and rely on .gitignore instead"
    )
    assert "git -c core.quotepath=false add -A" in run_text
    # and it must not invoke any custom .py script -- nothing for the agent
    # to have poisoned that this step would then execute
    assert ".py" not in run_text


# ── round-2 adversarial review (2026-11): job-condition correctness ─────


def test_publish_job_condition_handles_the_agent_job_being_entirely_skipped():
    """BLOCKER fix: `needs.agent.outputs.skip != 'true'` was inverted the
    wrong way -- when the agent job's OWN trigger gate rejects the event
    (e.g. a non-collaborator), the whole job is skipped and its outputs are
    the empty string, not "false". `'' != 'true'` is TRUE, so the old
    condition let publish run for ANY rejected event. The fix must check
    both that the agent job actually ran (`result != 'skipped'`) AND that
    it explicitly reported skip == 'false' (not merely "not true")."""
    _, doc = _load()
    cond = str(_publish_job(doc)["if"])
    assert "needs.agent.result != 'skipped'" in cond
    assert "needs.agent.outputs.skip == 'false'" in cond
    # the old, inverted form must not reappear
    assert "needs.agent.outputs.skip != 'true'" not in cond


# ── round-2 adversarial review (2026-11): patch structural safety wired in ──


def test_patch_structural_safety_check_is_wired_into_the_publish_script():
    """`patch_safety_violations` (malformed headers / binary patches /
    symlink-gitlink modes) must actually be called, not just importable."""
    script = (SCRIPTS_DIR / "validate_and_publish.py").read_text(encoding="utf-8")
    assert "patch_safety_violations(patch_text)" in script


def test_post_apply_reverification_is_wired_in_and_resets_on_violation():
    """BLOCKER fix: after `git apply --index`, re-derive what's actually
    staged (not what the pre-apply text parsing predicted) and re-check it.
    A hit must `git reset --hard` before refusing -- nothing committed."""
    script = (SCRIPTS_DIR / "validate_and_publish.py").read_text(encoding="utf-8")
    assert "def post_apply_violations(" in script
    assert "post_apply_violations(args.repo_dir)" in script
    assert '"reset", "--hard", "HEAD"' in script
    assert "core.quotepath=false" in script
    assert '"--name-only", "-z"' in script, "must parse staged paths NUL-separated"


def test_report_non_dict_json_does_not_crash():
    script = (SCRIPTS_DIR / "validate_and_publish.py").read_text(encoding="utf-8")
    assert "isinstance(report, dict)" in script


def test_closing_keyword_neutralization_is_applied_to_agent_pr_text():
    script = (SCRIPTS_DIR / "validate_and_publish.py").read_text(encoding="utf-8")
    assert "neutralize_closing_keywords(str(report.get(\"pr_body_extra\")" in script


# ── live canary run #42286478174: `git add` + gitignored exclusion pathspec ──


def test_git_add_dash_a_handles_a_gitignored_ephemeral_dir_without_erroring(tmp_path):
    """Reproduces the actual bug (not just a string check): once a path is
    listed in .gitignore, `git add -- . ':!<that path>'` hard-refuses with
    exit 1 ("The following paths are ignored by one of your .gitignore
    files") the moment the pathspec machinery resolves a pattern that
    NAMES an ignored path -- even as a negative/exclude pattern. This is
    exactly what made the "Capture agent diff" step fail in run
    #42286478174, right after the agent itself had run successfully.
    `git add -A` needs no exclusion pathspec at all; a gitignored
    directory is already left out of its expansion, no error."""
    import subprocess

    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "."], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "t@t.com"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True)
    (repo / ".gitignore").write_text(".claude-issue-agent/\n", encoding="utf-8")
    subprocess.run(["git", "add", ".gitignore"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "init"], cwd=repo, check=True)

    (repo / ".claude-issue-agent").mkdir()
    (repo / ".claude-issue-agent" / "report.json").write_text("{}", encoding="utf-8")
    (repo / "newfile.txt").write_text("hello\n", encoding="utf-8")

    # The OLD, broken form: must reproduce the real failure (red without the fix)
    broken = subprocess.run(
        ["git", "-c", "core.quotepath=false", "add", "--", ".", ":!.claude-issue-agent"],
        cwd=repo,
    )
    assert broken.returncode != 0, (
        "if this now exits 0, git's own behavior changed and the YAML "
        "comment's claim needs re-verifying -- don't just delete this test"
    )

    # The FIX: plain `git add -A`, relying on .gitignore alone
    fixed = subprocess.run(["git", "-c", "core.quotepath=false", "add", "-A"], cwd=repo)
    assert fixed.returncode == 0

    staged = subprocess.run(
        ["git", "diff", "--cached", "--name-only"], cwd=repo, capture_output=True, text=True
    )
    staged_files = staged.stdout.split()
    assert staged_files == ["newfile.txt"]
    assert ".claude-issue-agent/report.json" not in staged_files


def test_gitignore_excludes_ephemeral_dirs():
    """The .gitignore entry is what actually does the excluding now (not a
    pathspec on the `git add` line) -- assert it's still there."""
    gitignore = (Path(__file__).resolve().parents[2] / ".gitignore").read_text(encoding="utf-8")
    assert ".claude-issue-agent/" in gitignore
    assert ".claude-pr-review/" in gitignore
