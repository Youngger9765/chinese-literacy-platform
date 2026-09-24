"""#3299 — every transcribe fallback must log how long the passage was.

Why this lock exists
--------------------
The open half of #3299 is "should `_MIN_AUDIO_DURATION_MS` go up?".  The answer
turned out to be *no, not as a flat number*: the shortest key passage is 19
characters (G5-L24), which at the product's own G5 norm of 200 chars/min takes
5.7 s — so the 4 515 ms empty-transcript case observed in prod sits INSIDE the
legitimate range for short passages.  A gate that catches it would reject real
children reading the short ones.

The gate has to be relative to the passage, which means every fallback log must
carry the passage length.  It didn't, so the two prod events could not be
classified at all.

⚠️ Granularity matters here.  An earlier lock of mine only checked that a token
appeared *somewhere in the file* — six ways around it all passed.  This one
walks the AST and checks **each** `extra=` dict individually, so a newly added
fallback site that forgets the field fails even though the file still contains
plenty of other occurrences.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SOURCES = [
    REPO / "app" / "services" / "reading_transcription_service.py",
    REPO / "app" / "routes" / "learning" / "learning_reading.py",
]

EVENT = "reading_transcribe_fallback"
REQUIRED = "target_chars"


def _extra_keys(node: ast.AST) -> list[str] | None:
    """Statically resolve the key names of an `extra=` argument.

    Returns the key list for shapes we can read, or None for shapes we cannot.
    None is a hard failure below, not a pass — see `_fallback_extras`.
    """
    if isinstance(node, ast.Dict):
        if any(k is None for k in node.keys):  # {**spread, ...}
            return None
        keys = [k.value for k in node.keys if isinstance(k, ast.Constant)]
        return keys if len(keys) == len(node.keys) else None
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "dict":
        if node.args:  # dict(mapping, k=v)
            return None
        return [kw.arg for kw in node.keywords if kw.arg is not None] or None
    return None


def _fallback_extras(tree: ast.AST) -> tuple[list[tuple[int, list[str]]], list[int]]:
    """Every `extra=` on a logger call, split into (readable, unresolvable).

    ⚠️ Fail-closed on purpose.  An earlier version only understood `extra={...}`
    literals, so a new site written `extra=dict(event=..., reason=...)` — valid,
    ordinary Python — was invisible: the literal count stayed at 7, nothing was
    reported missing, and the lock stayed green while a real code path had no
    passage length.  Found by adversarial review, not by me.

    So: `dict(...)` is now understood, and anything still unreadable (a `**`
    spread, a shared helper, a variable) is reported as unresolvable and fails.
    A lock that silently skips what it cannot parse is decoration.
    """
    readable: list[tuple[int, list[str]]] = []
    unresolvable: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        # Only logger.<level>(...) calls — not every function taking `extra`.
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name)
                and fn.value.id == "logger"):
            continue
        for kw in node.keywords:
            if kw.arg != "extra":
                continue
            keys = _extra_keys(kw.value)
            if keys is None:
                unresolvable.append(kw.value.lineno)
                continue
            if EVENT in _event_values(kw.value):
                readable.append((kw.value.lineno, keys))
    return readable, unresolvable


def _event_values(node: ast.AST) -> set[str]:
    """The literal value(s) bound to an "event" key, if statically readable."""
    out: set[str] = set()
    if isinstance(node, ast.Dict):
        pairs = zip(node.keys, node.values)
    elif isinstance(node, ast.Call):
        pairs = [(ast.Constant(value=kw.arg), kw.value) for kw in node.keywords]
    else:
        return out
    for k, v in pairs:
        if (isinstance(k, ast.Constant) and k.value == "event"
                and isinstance(v, ast.Constant) and isinstance(v.value, str)):
            out.add(v.value)
    return out


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_every_fallback_log_carries_passage_length(path: Path) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    dicts, unresolvable = _fallback_extras(tree)

    # Positive control: if the walker finds nothing, the walker is broken —
    # "no violations" and "never looked" are otherwise indistinguishable.
    assert dicts, f"{path.name}: found no {EVENT} extra dicts at all — walker broken?"

    assert not unresolvable, (
        f"{path.name}: {len(unresolvable)} logger extra= argument(s) at lines "
        f"{unresolvable} are in a shape this lock cannot read statically.  That is "
        f"a failure, not a pass: extend `_extra_keys` so the site is checked."
    )

    missing = [lineno for lineno, keys in dicts if REQUIRED not in keys]
    assert not missing, (
        f"{path.name}: {len(missing)}/{len(dicts)} fallback logs are missing "
        f'"{REQUIRED}" (lines {missing}).  Without the passage length these '
        f"events cannot be told apart from a legitimate short reading — see #3299."
    )


def test_walker_counts_every_site_not_just_one() -> None:
    """The service has several fallback reasons; the lock must see all of them."""
    svc = ast.parse(SOURCES[0].read_text(encoding="utf-8"))
    assert len(_fallback_extras(svc)[0]) >= 7, (
        "expected at least 7 fallback sites in the service "
        "(silent/transcode/truncated/empty/hallucination/timeout/error)"
    )


def test_scorable_char_count_matches_the_unit_cpm_is_measured_in() -> None:
    """Punctuation must not inflate the count — CPM norms are per scorable char."""
    import sys

    sys.path.insert(0, str(REPO))
    from app.services.reading_transcription_service import scorable_char_count

    # G5-L24, the shortest key passage — the one that makes a flat gate unsafe.
    # 17, not 19: the two 、。 are punctuation.  Counting them is exactly the
    # mistake this unit exists to prevent — CPM is per *spoken* character, so a
    # punctuation-inclusive count silently inflates every expected duration.
    assert scorable_char_count("接下來發生的事，就是千古流傳的傳奇了。") == 17
    assert scorable_char_count("你好，世界！") == 4
    assert scorable_char_count("") == 0
    # Whitespace is not a spoken character.
    assert scorable_char_count("一 二\n三") == 3
