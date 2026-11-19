"""Guard: no backend dependency install may fetch unverified build deps (#3852).

`pip install --require-hashes -r requirements.lock` (#3849) verifies every
downloaded *distribution*. It does NOT verify what pip installs into the
isolated build env it creates for an sdist -- and jieba==0.42.1 ships only an
sdist. CI's pytest.yml log showed it plainly:

    Using cached jieba-0.42.1.tar.gz (19.2 MB)
    Installing build dependencies: started      <- setuptools>=40.8.0, floating, no hash

The fix, which this file locks, for every place that installs
backend/requirements.lock (Dockerfile + CI):

1. first `pip install --require-hashes --only-binary=:all: -r requirements-build.lock`
   (hash-pinned setuptools, the only build backend jieba needs);
2. then install requirements.lock with
   `--require-hashes --only-binary=:all: --no-binary=jieba --no-build-isolation`
   so every other package must come from a hash-verified wheel, and jieba is
   built against the setuptools from step 1 instead of a freshly fetched one.

Offline and cheap: parses the Dockerfile and workflow YAML, no network.
"""

from __future__ import annotations

import re
import shlex
from pathlib import Path

import pytest
import yaml

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DOCKERFILE = BACKEND_DIR / "Dockerfile"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
BUILD_LOCK = BACKEND_DIR / "requirements-build.lock"

# The only locked packages allowed to be built from source. Adding one here
# is a reviewed decision: it must build with nothing but requirements-build.lock.
SDIST_ALLOWLIST = {"jieba"}


def _dockerfile_run_commands() -> list[str]:
    """RUN instructions with backslash continuations joined."""
    joined = re.sub(r"\\\n", " ", DOCKERFILE.read_text())
    return [line.strip()[4:] for line in joined.splitlines() if line.strip().startswith("RUN ")]


def _workflow_run_scripts() -> list[tuple[str, str]]:
    scripts: list[tuple[str, str]] = []
    for wf in sorted(WORKFLOWS_DIR.glob("*.y*ml")):
        doc = yaml.safe_load(wf.read_text()) or {}
        for job_name, job in (doc.get("jobs") or {}).items():
            for step in job.get("steps") or []:
                run = step.get("run")
                if run:
                    scripts.append((f"{wf.name}:{job_name}", run))
    return scripts


def _install_scripts() -> list[tuple[str, str]]:
    """(location, script) for every script that pip-installs requirements.lock."""
    out = [("Dockerfile", " && ".join(_dockerfile_run_commands()))]
    out += _workflow_run_scripts()
    return [(loc, s) for loc, s in out if re.search(r"pip install[^\n]*requirements\.lock", s)]


def _pip_install_commands(script: str) -> list[list[str]]:
    """Split a shell script into argv lists of its `pip install` invocations."""
    cmds = []
    for chunk in re.split(r"\n|&&|;", re.sub(r"\\\n", " ", script)):
        try:
            argv = shlex.split(chunk.strip())
        except ValueError:
            continue
        if len(argv) >= 2 and argv[0] in {"pip", "pip3"} and argv[1] == "install":
            cmds.append(argv)
        elif len(argv) >= 4 and argv[1:3] == ["-m", "pip"] and argv[3] == "install":
            cmds.append(argv[2:])
    return cmds


def _flag_values(argv: list[str], flag: str) -> list[str]:
    vals = []
    for i, a in enumerate(argv):
        if a == flag and i + 1 < len(argv):
            vals.append(argv[i + 1])
        elif a.startswith(flag + "="):
            vals.append(a.split("=", 1)[1])
    return vals


def _target_lock(argv: list[str]) -> str | None:
    for v in _flag_values(argv, "-r") + _flag_values(argv, "--requirement"):
        return Path(v).name
    return None


INSTALL_SITES = _install_scripts()


def test_scanner_finds_every_known_install_site():
    """Positive control: if the scanner stops matching, every other test here is vacuous."""
    locs = {loc.split(":")[0] for loc, _ in INSTALL_SITES}
    assert {"Dockerfile", "pytest.yml", "spec-check.yml", "keypoints-manifest-gate.yml"} <= locs, locs


@pytest.mark.parametrize("loc,script", INSTALL_SITES, ids=[loc for loc, _ in INSTALL_SITES])
def test_build_lock_installed_first_with_hashes_and_wheels_only(loc, script):
    cmds = _pip_install_commands(script)
    targets = [_target_lock(c) for c in cmds]
    assert "requirements-build.lock" in targets, (
        f"{loc}: installs requirements.lock without first installing the hash-pinned "
        "requirements-build.lock -- jieba's build backend would come from wherever pip finds it"
    )
    first_build = targets.index("requirements-build.lock")
    first_main = targets.index("requirements.lock")
    assert first_build < first_main, f"{loc}: requirements-build.lock must be installed before requirements.lock"
    build_cmd = cmds[first_build]
    assert "--require-hashes" in build_cmd, f"{loc}: {build_cmd}"
    assert ":all:" in _flag_values(build_cmd, "--only-binary"), f"{loc}: {build_cmd}"


@pytest.mark.parametrize("loc,script", INSTALL_SITES, ids=[loc for loc, _ in INSTALL_SITES])
def test_main_lock_install_never_creates_an_isolated_build_env(loc, script):
    main_cmds = [c for c in _pip_install_commands(script) if _target_lock(c) == "requirements.lock"]
    assert main_cmds, f"{loc}: matched requirements.lock but parsed no pip install argv"
    for argv in main_cmds:
        assert "--require-hashes" in argv, f"{loc}: {argv}"
        assert "--no-build-isolation" in argv, (
            f"{loc}: without --no-build-isolation pip fetches setuptools for jieba's "
            f"build from PyPI with no hash check: {argv}"
        )
        assert ":all:" in _flag_values(argv, "--only-binary"), (
            f"{loc}: every package except the sdist allow-list must come from a wheel: {argv}"
        )
        no_binary = {p for v in _flag_values(argv, "--no-binary") for p in v.split(",")}
        assert no_binary == SDIST_ALLOWLIST, (
            f"{loc}: --no-binary must be exactly {sorted(SDIST_ALLOWLIST)}, got {sorted(no_binary)}"
        )


def test_build_lock_is_exact_and_hashed():
    text = BUILD_LOCK.read_text()
    pins = re.findall(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+)", text, re.M)
    assert ("setuptools", "84.2.1") in [(n.lower(), v) for n, v in pins], pins
    assert "--hash=sha256:" in text
    assert not re.search(r"^[A-Za-z0-9][A-Za-z0-9._-]*\s*(>=|<=|~=|!=|>|<)", text, re.M)
