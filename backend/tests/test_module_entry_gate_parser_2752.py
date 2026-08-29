"""module_entry_gate.py's stepConfig.ts parser must not be fooled by trailing
prose that happens to contain the phrase "enabled: false" (#2752).

REPRODUCED: `_enabled_step_ids()` finds each step's block by scanning to the
NEXT `id:` occurrence. For whichever entry is LAST in STEP_REGISTRY, there is
no next `id:` inside the object — the old code fell through to end-of-file,
which included the JSDoc comment above DEFAULT_STEP_SEQUENCE that literally
explains "set `enabled: false` to disable a step". That phrase poisoned the
last entry's block and made the gate misreport it as disabled, no matter what
its own `enabled:` value said.

Adding `classical-self-challenge` as the 4th new step in #2752 made it the new
last entry and hit this immediately: `python3 scripts/module_entry_gate.py`
reported "self_challenge 宣告對應 step classical-self-challenge，但那個 step
不存在或已停用" even though that step is `enabled: true`.
"""
from __future__ import annotations

import importlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import module_entry_gate as gate  # noqa: E402


# A minimal stepConfig.ts shape: two entries inside STEP_REGISTRY, the LAST one
# enabled, followed by prose (outside the object) that mentions "enabled: false"
# the way the real file's DEFAULT_STEP_SEQUENCE docstring does.
FIXTURE_TS = """
export const STEP_REGISTRY: Record<string, StepConfig> = {
  'first-step': {
    id: 'first-step',
    enabled: true,
  },
  'last-step': {
    id: 'last-step',
    enabled: true,
  },
};

// To disable a step globally: set `enabled: false` in STEP_REGISTRY.
export const DEFAULT_STEP_SEQUENCE: string[] = ['first-step', 'last-step'];
"""


def test_the_last_registry_entry_is_not_poisoned_by_trailing_prose(tmp_path, monkeypatch):
    fixture = tmp_path / "stepConfig.ts"
    fixture.write_text(FIXTURE_TS, encoding="utf-8")
    monkeypatch.setattr(gate, "STEP_CONFIG", fixture)

    ids = gate._enabled_step_ids()

    assert "last-step" in ids, (
        "the last STEP_REGISTRY entry was misread as disabled because of "
        "trailing prose outside the object — the exact #2752 regression"
    )
    assert "first-step" in ids


def test_a_genuinely_disabled_last_entry_is_still_caught(tmp_path, monkeypatch):
    """Mutation-style negative control: the parser must still detect a REAL
    `enabled: false` on the last entry — the fix must not swing to "always
    enabled" and silently stop being a gate at all."""
    fixture = tmp_path / "stepConfig.ts"
    fixture.write_text(
        FIXTURE_TS.replace(
            "  'last-step': {\n    id: 'last-step',\n    enabled: true,\n  },",
            "  'last-step': {\n    id: 'last-step',\n    enabled: false,\n  },",
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(gate, "STEP_CONFIG", fixture)

    ids = gate._enabled_step_ids()

    assert "last-step" not in ids
    assert "first-step" in ids
