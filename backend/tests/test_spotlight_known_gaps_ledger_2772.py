"""The 43-lesson spotlight gap ledger was stale — this locks the corrected version.

#2772: `content_known_gaps.yaml` recorded 43 lessons as "no renderable 閱讀聚光燈
content" back on 2026-08-15 (#2683). Re-reading the actual `spotlight.yml` files
on disk today shows 41 of those 43 now carry real, renderable content — the
multimodal re-extraction that continued through #2736 fixed them, but nobody
went back to prune the ledger. Two things made the original count look worse
than it was:

  1. It only ever meant to track lessons truly missing the content, but was
     never re-verified against the corpus as the extractor kept improving.
  2. A naive "does `sections_present` say 閱讀聚光燈" check (which is what this
     audit tried first) misses the section entirely for two other lesson
     genres that print the same slot under a different name — 品格聚光燈
     (character-education track, 體-L*) and 文言文聚光燈 (classical-Chinese
     track, 文-L*). Matching only the literal string "閱讀聚光燈" wrongly
     flagged ~45 genuinely-fine lessons as gaps.

This is the same shape of bug as `nextStepFooter.test.tsx` in #2771 (a lock
whose match was too narrow to see everything it needed to see) — recorded here
so the next audit doesn't repeat either mistake.

Two locks:
  - a ceiling on how many lessons the ledger may claim have no spotlight
    content (regression: nobody may casually re-inflate this without a real
    reason showing up in a PR)
  - every lesson currently on the list must actually have zero renderable
    spotlight content on disk today, so the list can't silently go stale
    again in the other direction (claiming a gap that was already fixed)
"""
from pathlib import Path

import yaml

BACKEND_ROOT = Path(__file__).resolve().parent.parent
LESSONS_ROOT = BACKEND_ROOT / "data" / "lessons"
KNOWN_GAPS_PATH = BACKEND_ROOT / "data" / "curriculum_qa" / "content_known_gaps.yaml"

# Ratchet: this may only go down (a lesson gets its spotlight content built),
# never up without a human deciding that's real and updating this constant.
SPOTLIGHT_GAP_CEILING = 7

# Same set the loader treats as decorative-only (backend/data/curriculum_qa/
# content_known_gaps.yaml#blocks_present_but_none_renderable's own definition).
NON_RENDERABLE_BLOCK_TYPES = {"figure", "guide", "self_check"}


def _latest_version(uid_dir: Path) -> Path | None:
    versions = sorted(
        (c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
    )
    return versions[-1] if versions else None


def _has_renderable_spotlight_content(uid: str) -> bool:
    uid_dir = LESSONS_ROOT / uid
    if not uid_dir.is_dir():
        return False
    vdir = _latest_version(uid_dir)
    if not vdir:
        return False
    sp_path = vdir / "spotlight.yml"
    if not sp_path.exists():
        return False
    doc = yaml.safe_load(sp_path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or "error" in doc:
        return False
    inner = doc.get("spotlight", doc)
    if not isinstance(inner, dict) or "error" in inner:
        return False
    blocks = inner.get("blocks") or []
    return any(
        isinstance(b, dict) and b.get("type") not in NON_RENDERABLE_BLOCK_TYPES
        for b in blocks
    )


def _load_known_gap_uids() -> list[str]:
    doc = yaml.safe_load(KNOWN_GAPS_PATH.read_text(encoding="utf-8"))
    return [entry["lesson_uid"] for entry in doc.get("lessons", [])]


def test_the_ledger_does_not_reinflate_past_its_ceiling():
    uids = _load_known_gap_uids()
    assert len(uids) <= SPOTLIGHT_GAP_CEILING, (
        f"content_known_gaps.yaml now lists {len(uids)} spotlight gaps, above the "
        f"ceiling of {SPOTLIGHT_GAP_CEILING} set by #2772's 2026-08-19 re-audit. "
        "If this grew for a real reason (a genuine new gap was found), raise the "
        "ceiling deliberately in this test and say why. If it grew because someone "
        "pasted the old #2683 43-lesson list back in, that list was stale — see "
        "resolved.spotlight_render_null_2683 in the yaml for why."
    )


def test_every_listed_gap_is_still_actually_a_gap_today():
    """The other direction: the ledger must not go stale by claiming a gap that
    was already fixed. Every UID on the list has to have zero renderable
    spotlight content on disk right now."""
    uids = _load_known_gap_uids()
    still_gap = [uid for uid in uids if not _has_renderable_spotlight_content(uid)]
    assert still_gap == uids, (
        f"content_known_gaps.yaml claims these lessons have no spotlight content, "
        f"but they now do: {sorted(set(uids) - set(still_gap))}. "
        "Prune them (see #2772 for the reconciliation method)."
    )
