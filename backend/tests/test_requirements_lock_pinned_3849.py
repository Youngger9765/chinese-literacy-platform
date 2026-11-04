"""Guard: requirements.lock must stay in sync with requirements.txt (#3849).

requirements.txt is the human-edited source of truth (open ranges, e.g.
`fastapi>=0.115,!=0.136.3`). requirements.lock is the machine-generated,
hash-pinned build artifact `pip install --require-hashes` actually installs
(Dockerfile + CI, see backend/README.md).

Before this guard existed, nothing stopped requirements.txt and
requirements.lock from drifting apart: widen a floor in requirements.txt
without regenerating the lock, and the Dockerfile keeps shipping the old
(now out-of-range) pinned version with nobody noticing — the exact "nobody
reviews what actually gets installed" gap #3849 closed. This test is cheap
and offline on purpose: it parses both files and cross-checks them, it does
not re-resolve the dependency graph or hit the network.

Three things it asserts:
1. Every top-level package requirements.txt declares is present in the lock.
2. The version the lock pins for that package actually satisfies the
   specifier requirements.txt declares (catches "I widened the floor but
   forgot to bump the lock").
3. requirements.lock is fully pinned (every line is `name==version`, every
   line carries at least one sha256 hash) — `--require-hashes` would reject
   anything else, but the point of this guard is to fail *before* CI tries.
"""

import re
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

BACKEND_DIR = Path(__file__).resolve().parent.parent
REQUIREMENTS_TXT = BACKEND_DIR / "requirements.txt"
REQUIREMENTS_LOCK = BACKEND_DIR / "requirements.lock"


def _parse_requirements_txt(path: Path) -> dict[str, Requirement]:
    """Return {canonical_name: Requirement} for every real requirement line."""
    reqs: dict[str, Requirement] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        req = Requirement(line)
        reqs[canonicalize_name(req.name)] = req
    return reqs


def _parse_requirements_lock(path: Path) -> dict[str, str]:
    """Return {canonical_name: pinned_version} for every `name==version \\` line."""
    pins: dict[str, str] = {}
    pin_re = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9][A-Za-z0-9._!+-]*)\s*\\?\s*$")
    for raw_line in path.read_text().splitlines():
        if raw_line.startswith((" ", "\t", "#")):
            continue
        m = pin_re.match(raw_line.rstrip())
        if m:
            pins[canonicalize_name(m.group(1))] = m.group(2)
    return pins


def _lock_blocks(path: Path) -> dict[str, list[str]]:
    """Return {canonical_name: [full block lines incl. continuations/hashes]}."""
    blocks: dict[str, list[str]] = {}
    current: str | None = None
    name_re = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==")
    for raw_line in path.read_text().splitlines():
        if raw_line.startswith((" ", "\t")):
            if current is not None:
                blocks[current].append(raw_line)
            continue
        if raw_line.startswith("#"):
            current = None
            continue
        m = name_re.match(raw_line)
        if m:
            current = canonicalize_name(m.group(1))
            blocks[current] = [raw_line]
        else:
            current = None
    return blocks


@pytest.fixture(scope="module")
def direct_requirements() -> dict[str, Requirement]:
    assert REQUIREMENTS_TXT.exists(), f"missing {REQUIREMENTS_TXT}"
    return _parse_requirements_txt(REQUIREMENTS_TXT)


@pytest.fixture(scope="module")
def locked_versions() -> dict[str, str]:
    assert REQUIREMENTS_LOCK.exists(), (
        f"missing {REQUIREMENTS_LOCK} — regenerate with:\n"
        "  cd backend && uv pip compile requirements.txt --generate-hashes "
        "--python-version 3.11 --python-platform x86_64-manylinux_2_28 "
        "--constraints requirements.lock -o requirements.lock\n"
        "(see backend/README.md)"
    )
    return _parse_requirements_lock(REQUIREMENTS_LOCK)


def test_every_direct_dependency_is_in_the_lock(direct_requirements, locked_versions):
    missing = sorted(set(direct_requirements) - set(locked_versions))
    assert not missing, (
        f"requirements.txt declares {missing} but requirements.lock has no pin for "
        "them — regenerate the lock (backend/README.md) before merging."
    )


def test_locked_version_satisfies_the_requirements_txt_specifier(
    direct_requirements, locked_versions
):
    violations = []
    for name, req in direct_requirements.items():
        pinned = locked_versions.get(name)
        if pinned is None:
            continue  # already reported by test_every_direct_dependency_is_in_the_lock
        if not req.specifier.contains(pinned, prereleases=True):
            violations.append(f"{name}: requirements.txt wants '{req.specifier}', lock pins {pinned}")
    assert not violations, (
        "requirements.lock is stale relative to requirements.txt — "
        "regenerate it (backend/README.md):\n" + "\n".join(violations)
    )


def test_lock_is_fully_pinned_with_hashes(locked_versions):
    blocks = _lock_blocks(REQUIREMENTS_LOCK)
    assert blocks, f"{REQUIREMENTS_LOCK} has no parseable `name==version` entries"
    no_hash = [name for name, lines in blocks.items() if not any("--hash=sha256:" in line for line in lines)]
    assert not no_hash, (
        f"these lock entries have no sha256 hash, so `pip install --require-hashes` "
        f"would refuse to install them: {sorted(no_hash)}"
    )
    assert len(blocks) == len(locked_versions)


def test_lock_has_no_loose_version_ranges():
    """Every resolved package line must be an exact pin, never a range."""
    loose = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\s*(>=|<=|~=|!=|>|<)")
    offenders = [
        line for line in REQUIREMENTS_LOCK.read_text().splitlines() if loose.match(line)
    ]
    assert not offenders, f"requirements.lock has non-exact pins (not generated by uv pip compile?): {offenders}"
