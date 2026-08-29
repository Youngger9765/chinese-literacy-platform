"""The #2742 gate must actually run when the thing it guards changes.

PR #2806 added the gate — `backend/specs/test_tts_cache_fingerprint_spec.py`
compares the pronunciation fingerprint against the one the GCS cache was warmed
with, so a table edit turns CI red instead of silently orphaning every cached
clip. That part works.

What was left open is which PRs run it. The gate lives in `backend/specs/`, and
the only workflow that executes `backend/specs/` is `spec-check.yml`, which is
path-filtered. Its filter lists `backend/app/services/**` — so editing
`PHONEME_CORRECTIONS` in normalization.py does trigger it — but it does not list
`backend/data/tts/**`.

The fingerprint depends on both. `_load_taiwan_corrections()` reads
`data/tts/taiwan_pronunciation.json` and merges it into `PHONEME_CORRECTIONS`
*before* the digest is computed, and normalization.py's own docstring says that
regenerating that file is the intended way to add pronunciation coverage
("Adding coverage means regenerating the file, not appending another tuple
here"). Verified 2026-08-21: changing one alias in that file moves the
fingerprint and turns the gate red locally.

So the most likely way anyone will ever change the fingerprint is the one path
CI does not watch. The workflows that do trigger on `backend/data/tts/**`
(pytest.yml, deploy.yml, staging-deploy.yml, preview-deploy.yml) never run
`specs/` at all — pytest.yml contains zero references to it.

This file is the lock on the wiring rather than on the behaviour: for every
input the fingerprint is computed from, some workflow that actually runs the
gate has to trigger on it. It fails on the parent commit for
taiwan_pronunciation.json, which is the whole point.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_DIR = REPO_ROOT / ".github" / "workflows"

# Repo-relative paths whose *content* feeds CORRECTIONS_FINGERPRINT. Keep this
# list honest — test_every_declared_input_really_feeds_the_fingerprint below
# refuses to let it become decorative.
FINGERPRINT_INPUTS = (
    "backend/app/services/tts/normalization.py",
    "backend/data/tts/taiwan_pronunciation.json",
)

# A workflow runs the gate if it invokes the spec directly or goes through
# run-ci.sh, which collects backend/specs/ wholesale.
GATE_MARKERS = ("test_tts_cache_fingerprint_spec", "run-ci.sh")


def _pattern_to_regex(pattern: str) -> re.Pattern[str]:
    """GitHub Actions path glob -> regex.

    `**` crosses directory separators, a lone `*` does not — the distinction is
    the entire question here, since `backend/**` covers data/tts while
    `backend/data/lessons/**` does not.
    """
    out: list[str] = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def _gate_workflows() -> dict[str, list[str]]:
    """{workflow filename: pull_request path filters} for workflows running the gate.

    A workflow with no `paths:` filter runs on every pull request, which counts
    as covering everything — represented as ['**'].
    """
    found: dict[str, list[str]] = {}
    for wf in sorted(WORKFLOW_DIR.glob("*.yml")):
        text = wf.read_text(encoding="utf-8")
        if not any(marker in text for marker in GATE_MARKERS):
            continue
        # `on:` parses as the boolean True in YAML 1.1, which is why this looks
        # for both spellings rather than just the string.
        triggers = yaml.safe_load(text).get("on") or yaml.safe_load(text).get(True) or {}
        pr = triggers.get("pull_request")
        if pr is None:
            continue
        found[wf.name] = list(pr.get("paths") or ["**"]) if isinstance(pr, dict) else ["**"]
    return found


class TestTheInputListIsHonest:
    @pytest.mark.parametrize("rel", FINGERPRINT_INPUTS)
    def test_declared_input_exists(self, rel):
        assert (REPO_ROOT / rel).is_file(), f"{rel} is declared as a fingerprint input but is missing"

    def test_every_declared_input_really_feeds_the_fingerprint(self):
        """Without this, a stale entry makes the coverage check guard nothing.

        normalization.py is self-evident (it defines the digest). The JSON is
        checked by confirming its rows actually reach PHONEME_CORRECTIONS — if
        someone stops loading that file, this says so instead of leaving a path
        being policed for no reason.
        """
        from app.services.tts.normalization import PHONEME_CORRECTIONS

        rows = json.loads(
            (REPO_ROOT / "backend/data/tts/taiwan_pronunciation.json").read_text(encoding="utf-8")
        )["corrections"]
        assert rows, "taiwan_pronunciation.json has no corrections to contribute"
        words = {w for w, _ in PHONEME_CORRECTIONS}
        assert any(r["word"] in words for r in rows), (
            "no row from taiwan_pronunciation.json reached PHONEME_CORRECTIONS — "
            "either the loader broke, or this file no longer feeds the fingerprint "
            "and should come off FINGERPRINT_INPUTS"
        )


class TestTheGateIsWired:
    def test_some_workflow_runs_the_gate(self):
        """Positive control. If the detector matched nothing, every coverage
        assertion below would fail for the wrong reason."""
        assert _gate_workflows(), (
            "no workflow appears to run the #2742 fingerprint gate at all — "
            f"looked for {GATE_MARKERS} across {WORKFLOW_DIR}"
        )

    @pytest.mark.parametrize("rel", FINGERPRINT_INPUTS)
    def test_changing_a_fingerprint_input_triggers_the_gate(self, rel):
        gate = _gate_workflows()
        covering = [
            name
            for name, patterns in gate.items()
            if any(
                _pattern_to_regex(p).match(rel)
                for p in patterns
                if not p.startswith("!")
            )
        ]
        assert covering, (
            f"editing {rel} moves CORRECTIONS_FINGERPRINT — and therefore the cache "
            f"key of every sentence in the corpus — but no workflow that runs the "
            f"#2742 gate is triggered by it.\n\n"
            f"A PR that changes only this file gets a fully green CI and silently "
            f"orphans the whole audio cache: exactly the failure #2742 is about.\n\n"
            f"Workflows that do run the gate, and what they watch:\n"
            + "\n".join(f"  {n}: {p}" for n, p in gate.items())
            + f"\n\nFix: add a path covering {rel} to one of them, or run the spec "
            f"from a workflow that already triggers on it."
        )


class TestThePatternMatcher:
    """The coverage check is only as good as this; a matcher that says yes to
    everything would make the lock above permanently, silently green."""

    @pytest.mark.parametrize(
        "pattern,path,expected",
        [
            ("backend/**", "backend/data/tts/taiwan_pronunciation.json", True),
            ("backend/app/services/**", "backend/app/services/tts/normalization.py", True),
            ("backend/data/lessons/**", "backend/data/tts/taiwan_pronunciation.json", False),
            ("backend/data/tts/**", "backend/data/tts/taiwan_pronunciation.json", True),
            ("backend/*.py", "backend/data/tts/x.json", False),
            ("backend/*", "backend/data/tts/x.json", False),
            ("specs/**", "backend/specs/x.py", False),
            ("**", "anything/at/all.txt", True),
        ],
    )
    def test_glob_semantics(self, pattern, path, expected):
        assert bool(_pattern_to_regex(pattern).match(path)) is expected
