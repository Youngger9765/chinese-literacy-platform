#!/usr/bin/env python3
"""spotlight_to_lesson_content.py — deterministic bridge adapter (Phase 1, DEV7).

Part of the 閱讀聚光燈 EDD refactor (SPOTLIGHT_REFACTOR_PLAN.md). Translates the
team's already-shipped deterministic extraction artifacts (per-lesson
``.spotlight.yml`` + the ``story_structure_table`` inside ``_parsed_*/<code>.yml``)
into the new typed contract (``backend/app/schemas/lesson_content.Lesson``), then
validates the result with ``Lesson.model_validate``.

WHY THIS EXISTS (bridge, not AI)
--------------------------------
The new ``lesson_content`` contract is a *typed superset* of the old flat spotlight
schema (``KeypointsTable`` was designed 1:1 against the parser's ``extract_keypoints``).
This adapter proves the bridge on the 教授七課 (DEV7) with ZERO AI, ZERO network,
ZERO DB — purely deterministic field mapping. Anything it cannot resolve is marked
``needs_review=True`` and logged to a sibling known-gaps file — it NEVER fabricates a
pass. A ``Lesson.model_validate`` failure is a *mapping bug* (fail LOUD), NOT a content
gap (that would be logged, not raised).

SCOPE (this round)
------------------
* DEV7 only (the 7 教授 courses). TEST metrics are reported separately elsewhere.
* Adapter emits ONLY what the spotlight source deterministically contains:
  presentation blocks (paragraph/figure) + ONE spotlight exercise (guided_steps /
  graphic_text_integration) + (optionally, behind ``--with-keypoints``) ONE
  keypoints_table exercise sourced from ``_parsed`` ``story_structure_table``.
* It does NOT synthesize reading-comprehension MCQ blocks (no source in the spotlight),
  so adapter output is a *subset* of the hand-transcribed fixtures — by design. Its
  golden is frozen in its OWN dir, never diffed against the hand fixtures.

KNOWN-GAP REASONS introduced by this adapter (schema-MAPPING gaps, distinct from the
content-ABSENCE enum in content_evidence_gate.py — written to a SIBLING file
``content_known_gaps.adapter.yaml`` so the machine-checked gate enum stays untouched):
  * multi_choice_unsplittable_options       — a （複選）option run could not be split
  * multi_choice_incomplete_answer          — clean （複選）options, only 1 correct known
  * keypoints_blank_null_answer             — an empty 【】 fill (KeypointBlank.answer needs >=1)
  * keypoints_choice_distractor_unrecoverable — a □-pick with no recoverable distractors
  * answer_not_in_options                   — a single answer string absent from its options
  * strategy_type_unmapped                  — a strategy_type code with no kind mapping
  * no_anchorable_block                     — a spotlight with zero non-exercise blocks
  * no_keypoints_source                     — story_structure_table missing/empty
  * keypoints_source_is_merged_range        — keypoints sourced from a MERGED multi-lesson range
                                               file (a curriculum slot whose parsed YAML is a
                                               <grade>-L<n>-<m> compound); the table spans several
                                               lessons, so attaching the whole table to ONE lesson
                                               is only approximate → needs_review
  * keypoints_source_suffix_resolved        — keypoints sourced from the suffix-stripped base
                                               parsed file (an a/b variant with no exact file
                                               borrows the base lesson's table) → needs_review
  * no_anchorable_passage_in_source         — an exercise whose source has ZERO presentation
                                               (passage/figure/table) blocks: no in-document
                                               text span to anchor to. A source-shape FACT, not
                                               a defect — kept anchors=[] + needs_review (honest
                                               NEEDS_REVIEW, never a fake green)
  * fill_table_stub_no_inline_content       — a fill_table block that is a bare {type} stub (no
                                               rows/answers); its real content is the _parsed
                                               story_structure_table (recovered as ex-keypoints),
                                               so the empty stub itself yields no block
  * matching_type_unsupported               — a `match` block (answer-bearing) has no dedicated
                                               contract kind this round; emitted as a `custom`
                                               ExerciseBlock (needs_review) so its answers are
                                               NEVER silently dropped, pending a future kind

NO HARDCODED LESSON IDS / COURSE NAMES anywhere below (overfit lint self-passes).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any, Optional

import yaml

# Import the contract via the same sys.path trick the eval uses.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))

from pydantic import ValidationError  # noqa: E402

from app.schemas.lesson_content import Lesson  # noqa: E402
from app.services.lesson_code_normalization import (  # noqa: E402
    MULTI_LESSON_PRIMARY,
    halfwidth,
    normalize_manifest_code,
)

# ═══════════════════════════════════════════════════════════════════════════
#  Paths (all under the worktree root; tests/fixtures dir, NOT catalog)
# ═══════════════════════════════════════════════════════════════════════════

SPOTLIGHT_DIR = _REPO_ROOT / "backend" / "data" / "lessons" / "spotlight" / "dev7"
PARSED_DIR = _REPO_ROOT / "backend" / "data" / "lessons" / "_parsed_2026-05-01"
DEFAULT_OUT_DIR = _REPO_ROOT / "backend" / "tests" / "fixtures" / "lesson_content_dev7"
DEFAULT_GAPS_OUT = (
    _REPO_ROOT / "backend" / "data" / "curriculum_qa" / "content_known_gaps.adapter.yaml"
)
GAPS_SECTION = "spotlight-edd-adapter"


# ═══════════════════════════════════════════════════════════════════════════
#  MODULE-LEVEL CONSTANTS (data-driven, overfit-safe — keyed on CODES only)
# ═══════════════════════════════════════════════════════════════════════════

# gap (c): strategy_type CODE → contract question kind. guided_steps is the
# documented catch-all per the issue-2205 family taxonomy. NEVER key on lesson id/title.
STRATEGY_TYPE_TO_KIND: dict[str, str] = {
    "summary_pse": "guided_steps",
    "summary_psr": "guided_steps",
    "summary_structure": "guided_steps",
    "image_text": "graphic_text_integration",
    "table_text": "graphic_text_integration",
}
DEFAULT_KIND = "guided_steps"  # documented catch-all

# Multi-select markers. 複選/多選 => multi. "(N選M)" with M>=2 => multi.
# "二選一"/"三選一" (M==1) => SINGLE pick; "三選二"/"4選2" (M>=2) => multi.
_MULTI_WORD_RE = re.compile(r"複選|多選")
_N_XUAN_M_RE = re.compile(r"[（(]\s*([二三四五六七八九十\d]+)\s*選\s*([二三四五六七八九十\d]+)\s*[）)]")
_CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}

# Split a mashed option string on ②③④… circled markers or standalone □ separators,
# mirroring build_lesson_schema.split_inline_box_options semantics (re-implemented
# locally so we never depend on the extractor's internals).
_INLINE_DISTRACTOR_RE = re.compile(r"[②③④⑤⑥⑦⑧⑨⑩]|□")

# 【 ... 】 fills in a keypoints cell.
_BLANK_RE = re.compile(r"【\s*(.*?)\s*】")
# 圖N / 表N label derivation from a bind_paragraph hint (never hardcode a specific N).
_FIGURE_LABEL_RE = re.compile(r"([圖表][一二三四五六七八九十\d]+)")
# a/b (…) sub-letter suffix on an already-normalized code (a '<grade>-L<n><letter>' form maps
# to its base '<grade>-L<n>'). Used ONLY as a last-resort fallback when the exact a/b parsed
# file is absent (the a/b variant shares the base lesson's article/table).
_SUFFIX_RE = re.compile(r"^((?:G\d+|文)-L\d+)([a-z])$")


def _cn_to_int(token: str) -> int:
    if token.isdigit():
        return int(token)
    return _CN_NUM.get(token, 0)


def _is_multi_marker(prompt: str) -> bool:
    """True iff the prompt marks a 可複選 (multi-pick) question."""
    if _MULTI_WORD_RE.search(prompt or ""):
        return True
    for m in _N_XUAN_M_RE.finditer(prompt or ""):
        if _cn_to_int(m.group(2)) >= 2:
            return True
    return False


def _split_inline_distractors(option: str) -> list[str]:
    """Split one option like '全身大致為黑色 ②身形大小接近' → ['全身大致為黑色','身形大小接近'].
    Strips a trailing standalone □. Returns the atomic sub-options (>=1)."""
    parts = [p.strip() for p in _INLINE_DISTRACTOR_RE.split(option or "")]
    return [p for p in parts if p]


# ═══════════════════════════════════════════════════════════════════════════
#  Normalization helper (answer-string ↔ option matching ONLY; never for stored text)
# ═══════════════════════════════════════════════════════════════════════════


def _norm(s: Optional[str]) -> str:
    """Collapse internal whitespace (incl. U+3000) to single spaces, strip, and
    halfwidth() fullwidth ASCII. Used ONLY to match an answer string against option
    strings (both sides normalized identically). Stored text stays verbatim."""
    text = halfwidth(s or "")
    text = text.replace("　", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _index_of(needle: str, haystack: list[str]) -> Optional[int]:
    """Return the index of the first haystack entry equal to needle, else None.
    Caller passes pre-normalized strings on both sides."""
    for i, h in enumerate(haystack):
        if h == needle:
            return i
    return None


# ═══════════════════════════════════════════════════════════════════════════
#  Gap accumulator
# ═══════════════════════════════════════════════════════════════════════════


class GapLog:
    """Accumulates schema-mapping known-gaps, deduped by (lesson_code, step, reason)."""

    def __init__(self) -> None:
        self._items: list[dict[str, Any]] = []
        self._seen: set[tuple[str, str, str]] = set()

    def add(self, lesson_code: str, reason: str, step: str = "", detail: str = "") -> None:
        key = (lesson_code, str(step), reason)
        if key in self._seen:
            return
        self._seen.add(key)
        entry: dict[str, Any] = {"lesson_code": lesson_code, "reason": reason}
        if step:
            entry["step"] = step
        if detail:
            entry["detail"] = detail
        self._items.append(entry)

    def for_lesson(self, lesson_code: str) -> list[dict[str, Any]]:
        return [g for g in self._items if g["lesson_code"] == lesson_code]

    @property
    def items(self) -> list[dict[str, Any]]:
        return list(self._items)


# ═══════════════════════════════════════════════════════════════════════════
#  1. load
# ═══════════════════════════════════════════════════════════════════════════


def load_spotlight(path: Path) -> dict[str, Any]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or "spotlight" not in raw:
        raise ValueError(f"{path} missing 'spotlight' root")
    spot = raw["spotlight"]
    if not isinstance(spot, dict):
        raise ValueError(f"{path} 'spotlight' is not a mapping")
    return spot


def resolve_parsed_source(lesson_code: str) -> tuple[Optional[Path], str]:
    """Range/補零-aware resolution of the _parsed keypoints source for a lesson code.

    Resolution order (fail-closed, content-verified — NEVER guesses a neighbour by bare
    number, which is exactly the 補零碰撞 / 缺檔鄰號錯綁 class content-mapping-integrity
    warns about):

      1. EXACT bare-normalized file ``<norm>.yml``. This is the authority for these
         spotlight sources: the spotlight/catalog/*.spotlight.yml files are keyed to the
         Layer-2 (parsed) numbering, so the bare-normalized name is the correct twin when the
         file exists. Content-verified on the G8 block whose bare-normalized file and curriculum
         override map DISAGREE — the spotlight's actual story matches the BARE file, so routing
         through the curriculum override (catalog_to_parsed_code) would MIS-bind it to a
         neighbour's story (張冠李戴). Bare-first is therefore the honest choice here.
      2. MULTI_LESSON_PRIMARY range file (only when the exact file is absent). A curriculum
         slot covered by a merged multi-lesson YAML (a <grade>-L<n>-<m> compound). The table
         inside spans several lessons → kind='merged_range' so the caller flags it.
      3. Suffix-stripped base file (only when exact + range both absent AND the code carries an
         a/b sub-letter). Content-verified: the sole such catalog case's spotlight story matches
         its suffix-stripped base parsed file (NOT the curriculum override target).
         kind='suffix_base'.

    Returns (path_or_None, source_kind) where source_kind ∈
    {'exact', 'merged_range', 'suffix_base', 'none'}. NO self-padding (per resolve_identity).
    """
    norm = normalize_manifest_code(lesson_code)

    exact = PARSED_DIR / f"{norm}.yml"
    if exact.exists():
        return exact, "exact"

    rng = MULTI_LESSON_PRIMARY.get(norm)
    if rng:
        rng_path = PARSED_DIR / f"{rng}.yml"
        if rng_path.exists():
            return rng_path, "merged_range"

    m = _SUFFIX_RE.match(norm)
    if m:
        base_path = PARSED_DIR / f"{m.group(1)}.yml"
        if base_path.exists():
            return base_path, "suffix_base"

    return None, "none"


def load_parsed(lesson_code: str) -> tuple[dict[str, Any], str]:
    """Load the _parsed keypoints source for a lesson code (range/補零/suffix-aware).

    Returns (parsed_dict, source_kind). parsed_dict is {} when no source resolves
    (source_kind='none'); source_kind is one of 'exact' | 'merged_range' | 'suffix_base'
    | 'none' so ``build_keypoints_exercise`` can honestly flag approximate sources.
    """
    path, kind = resolve_parsed_source(lesson_code)
    if path is None:
        return {}, kind
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return (raw if isinstance(raw, dict) else {}), kind


# ═══════════════════════════════════════════════════════════════════════════
#  2. identity (gap f) — pass-through via the registry normalizer, NO self-padding
# ═══════════════════════════════════════════════════════════════════════════


def resolve_identity(spot: dict[str, Any]) -> tuple[str, str]:
    raw_code = spot.get("lesson")
    if not raw_code:
        raise ValueError("spotlight.lesson is missing")
    lesson_code = normalize_manifest_code(str(raw_code))
    # Fixtures use id == lesson_code; NEVER derive/pad.
    return lesson_code, lesson_code


# ═══════════════════════════════════════════════════════════════════════════
#  3. presentation blocks (gap b) — stable synthetic ids by TYPE-COUNTER
# ═══════════════════════════════════════════════════════════════════════════


def build_presentation_blocks(
    blocks: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Single ordered pass. passage → one paragraph block per paragraph string
    (p1,p2,…), figure(referent=image) → fig1,fig2,…, figure(referent=table)/table →
    tbl1,tbl2,…. guide/self_check/fill_table/single/multi/free_text emit NO
    presentation block. Returns (presentation_block_dicts, ordered_anchor_ids)."""
    out: list[dict[str, Any]] = []
    anchor_ids: list[str] = []
    p_n = fig_n = tbl_n = 0

    for b in blocks:
        t = b.get("type")
        if t == "passage":
            for para in b.get("paragraphs", []) or []:
                text = str(para)
                if not text.strip():
                    continue  # ParagraphBlock.text needs min_length 1
                p_n += 1
                bid = f"p{p_n}"
                out.append({"id": bid, "type": "paragraph", "text": text})
                anchor_ids.append(bid)
        elif t == "figure":
            referent = b.get("referent")
            bind = str(b.get("bind_paragraph") or "")
            label_m = _FIGURE_LABEL_RE.search(bind)
            label = label_m.group(1) if label_m else None
            asset = b.get("asset")
            if referent == "table":
                tbl_n += 1
                bid = f"tbl{tbl_n}"
            else:
                fig_n += 1
                bid = f"fig{fig_n}"
            fig: dict[str, Any] = {"id": bid, "type": "figure", "asset": asset, "caption": None}
            if label:
                fig["label"] = label
            out.append(fig)
            anchor_ids.append(bid)
        # guide / self_check / fill_table / single / multi / free_text → no presentation block
    return out, anchor_ids


# ═══════════════════════════════════════════════════════════════════════════
#  5. spotlight exercise (gap a/c/d) — one guided_steps|graphic_text per lesson
# ═══════════════════════════════════════════════════════════════════════════


def _make_step(
    b: dict[str, Any], lesson_code: str, gaps: GapLog, step_ref: str
) -> tuple[dict[str, Any], bool]:
    """Build one GuidedStep dict from a single/multi/free_text block.
    Returns (step_dict, unresolved) where unresolved=True forces block needs_review."""
    t = b.get("type")
    prompt = str(b.get("prompt") or "").strip() or "（無題幹）"

    if t == "free_text":
        ref = b.get("answer")
        return (
            {
                "prompt": prompt,
                "type": "free_text",
                "answer": None,
                "reference_answer": (str(ref) if ref else None),
            },
            False,
        )

    if t == "multi":
        # Genuine multi block (ZERO in DEV7 but implemented for robustness).
        options = [str(o) for o in (b.get("options") or [])]
        answers = b.get("answer") or []
        if not isinstance(answers, list):
            answers = [answers]
        norm_opts = [_norm(o) for o in options]
        idxs: list[int] = []
        unresolved = False
        for a in answers:
            idx = _index_of(_norm(str(a)), norm_opts)
            if idx is None:
                unresolved = True
                gaps.add(lesson_code, "answer_not_in_options", step_ref, str(a))
            elif idx not in idxs:
                idxs.append(idx)
        return (
            {
                "prompt": prompt,
                "type": "multi_select",
                "options": options,
                "answer": sorted(idxs),
            },
            unresolved,
        )

    # single
    options = [str(o) for o in (b.get("options") or [])]
    answer = b.get("answer")
    norm_opts = [_norm(o) for o in options]

    if not _is_multi_marker(prompt):
        # Clean single-select: resolve answer string → index.
        idx = _index_of(_norm(str(answer)), norm_opts) if answer is not None else None
        if idx is None:
            gaps.add(lesson_code, "answer_not_in_options", step_ref, str(answer))
            return (
                {"prompt": prompt, "type": "select", "options": options, "answer": None},
                True,
            )
        return (
            {"prompt": prompt, "type": "select", "options": options, "answer": idx},
            False,
        )

    # single WITH multi-marker (複選 / N選M, M>=2) → gap d/G4 restoration attempt.
    splits = [_split_inline_distractors(o) for o in options]
    if any(len(s) > 1 for s in splits):
        # Splittable inline-② case: rebuild flattened atomic options; the correct set
        # is the split of the stored answer string (extractor packed the inline run in it).
        flat: list[str] = []
        for s in splits:
            flat.extend(s)
        ans_parts = _split_inline_distractors(str(answer)) if answer is not None else []
        norm_flat = [_norm(o) for o in flat]
        idxs: list[int] = []
        unresolved = False
        for a in ans_parts:
            idx = _index_of(_norm(a), norm_flat)
            if idx is None:
                unresolved = True
            elif idx not in idxs:
                idxs.append(idx)
        if len(flat) < 2 or len(idxs) < 1:
            # Could not build a safe multi_select — fall back to flagged select is unsafe
            # (options may be <2). Log and mark unresolved with the original options.
            gaps.add(lesson_code, "multi_choice_unsplittable_options", step_ref, str(answer))
            return (
                {"prompt": prompt, "type": "select", "options": options, "answer": None},
                True,
            )
        if len(idxs) < 2:
            # Detected 複選 packaging (multi-marker options) but recovered only ONE correct
            # index → the full correct set almost certainly wasn't restored. Flag for review
            # (else a genuine full multi-pick grades as wrong), matching the non-splittable
            # sibling's honesty (multi_choice_incomplete_answer) below.
            gaps.add(lesson_code, "multi_choice_single_recovered", step_ref, str(answer))
            unresolved = True
        return (
            {
                "prompt": prompt,
                "type": "multi_select",
                "options": flat,
                "answer": sorted(idxs),
            },
            unresolved,
        )

    # Not splittable (clean options, only options[0] known as the single stored answer).
    # We CANNOT recover the full 複選 set → keep select + needs_review + honest gap.
    idx = _index_of(_norm(str(answer)), norm_opts) if answer is not None else None
    gaps.add(lesson_code, "multi_choice_incomplete_answer", step_ref, str(answer))
    if idx is None:
        gaps.add(lesson_code, "answer_not_in_options", step_ref, str(answer))
        return (
            {"prompt": prompt, "type": "select", "options": options, "answer": None},
            True,
        )
    return (
        {"prompt": prompt, "type": "select", "options": options, "answer": idx},
        True,  # unresolved: prompt says 複選 but only one answer known
    )


def _first_guide_text(blocks: list[dict[str, Any]]) -> Optional[str]:
    for b in blocks:
        if b.get("type") == "guide":
            txt = str(b.get("text") or "").strip()
            if txt:
                return txt
    return None


def group_spotlight_exercise(
    spot: dict[str, Any], anchor_ids: list[str], gaps: GapLog, lesson_code: str
) -> Optional[dict[str, Any]]:
    """Collapse the run of single/multi/free_text blocks into ONE exercise block.
    Returns the ExerciseBlock dict, or None if the lesson has no answer steps."""
    blocks = spot.get("blocks") or []
    step_blocks = [b for b in blocks if b.get("type") in ("single", "multi", "free_text")]
    if not step_blocks:
        return None

    strategy_type = str(spot.get("strategy_type") or "")
    kind = STRATEGY_TYPE_TO_KIND.get(strategy_type)
    if kind is None:
        gaps.add(lesson_code, "strategy_type_unmapped", detail=strategy_type)
        kind = DEFAULT_KIND

    strategy_name = str(spot.get("strategy_name") or "").strip() or "閱讀聚光燈"
    instruction = _first_guide_text(blocks) or strategy_name

    steps: list[dict[str, Any]] = []
    any_unresolved = False
    for i, b in enumerate(step_blocks):
        step, unresolved = _make_step(b, lesson_code, gaps, step_ref=f"spotlight#{i + 1}")
        steps.append(step)
        any_unresolved = any_unresolved or unresolved

    # assembled block-level answer list: select→int, multi_select→list[int], free_text→None
    block_answer: list[Any] = []
    for s in steps:
        if s["type"] == "free_text":
            block_answer.append(None)
        else:
            block_answer.append(s["answer"])

    if not anchor_ids:
        # Gap 2: a spotlight whose source has ZERO presentation (passage/figure/table) blocks
        # has no in-document span to anchor to — a source-shape FACT, not a defect. Keep
        # anchors=[] but flag it honestly (needs_review) so it lands as NEEDS_REVIEW (🟡),
        # never a fake green and never a silent 🟠. (Kept the legacy no_anchorable_block reason
        # too, so existing DEV7 ledger entries / tests stay stable.)
        gaps.add(lesson_code, "no_anchorable_block", "ex-spotlight")
        gaps.add(lesson_code, "no_anchorable_passage_in_source", "ex-spotlight")

    return {
        "id": "ex-spotlight",
        "type": "exercise",
        "question": {
            "kind": kind,
            "strategy_name": strategy_name,
            "instruction": instruction,
            "steps": steps,
        },
        "answer_space": "free_text",
        "answer": block_answer,
        "grader": "rubric_ai",
        "anchors": [{"block_id": bid} for bid in anchor_ids],
        "needs_review": any_unresolved or not anchor_ids,
    }


# ═══════════════════════════════════════════════════════════════════════════
#  6. keypoints exercise (gap e) — source = _parsed story_structure_table
# ═══════════════════════════════════════════════════════════════════════════


def build_keypoints_exercise(
    parsed: dict[str, Any],
    lesson_code: str,
    passage_table_anchor_ids: list[str],
    gaps: GapLog,
    source_kind: str = "exact",
) -> Optional[dict[str, Any]]:
    """Build the ex-keypoints block from the _parsed story_structure_table.

    Gap 2 (anchor semantics): keypoints_table is 『整篇文章重點』, so it anchors to the
    PASSAGE/TABLE presentation blocks it summarizes (``passage_table_anchor_ids``) — NOT a
    single arbitrary figure (the old ``last_figure_id`` was semantically wrong and left 80/113
    figure-less lessons with anchors=[]). When the source has ZERO passage/table blocks there
    is genuinely no in-document span to anchor to → we keep anchors=[] AND set
    needs_review=True AND log ``no_anchorable_passage_in_source`` (honest NEEDS_REVIEW, never a
    fake green).

    Gap 1 (source honesty): ``source_kind`` records how the parsed file was resolved.
    'merged_range' / 'suffix_base' sources are only APPROXIMATE for a single lesson, so the
    block is flagged needs_review + a matching gap reason is logged. 'exact' is clean.
    """
    passage_table_anchor_ids = list(passage_table_anchor_ids or [])
    sst = parsed.get("story_structure_table")
    if not isinstance(sst, list) or not sst:
        gaps.add(lesson_code, "no_keypoints_source", "ex-keypoints")
        return None

    rows_in = list(sst)
    title: Optional[str] = None
    # A leading single-element row is the title row.
    if rows_in and isinstance(rows_in[0], list) and len(rows_in[0]) == 1:
        title = str(rows_in[0][0]).strip() or None
        rows_in = rows_in[1:]

    rows_out: list[dict[str, Any]] = []
    blanks_out: list[dict[str, Any]] = []
    any_nested = False

    for i, row in enumerate(rows_in, start=1):
        if not isinstance(row, list) or not row:
            continue
        label = str(row[0]).strip() or f"項目{i}"
        sub_label: Optional[str] = None
        if len(row) >= 3:
            sub_label = str(row[1]).strip() or None
            if sub_label:
                any_nested = True
        cell = str(row[-1])

        blank_ids: list[str] = []
        fills = _BLANK_RE.findall(cell)
        for k, fill in enumerate(fills, start=1):
            answer = str(fill).strip()
            if not answer:
                # Empty 【 】 — KeypointBlank.answer cannot be empty; skip + log.
                gaps.add(lesson_code, "keypoints_blank_null_answer", f"r{i}.b{k}")
                continue
            bid = f"r{i}.b{k}"
            blank_ids.append(bid)
            blanks_out.append({"id": bid, "answer": answer})

        # Honesty: only the LAST cell is scanned for 【】 fills; a 【】 in an interior column
        # (wider rows) would be silently dropped. Flag it (module contract: answers are never
        # silently dropped) rather than shipping an incomplete row.
        for extra in row[1:-1]:
            if _BLANK_RE.search(str(extra)):
                gaps.add(lesson_code, "keypoints_interior_blank_dropped", f"r{i}", str(extra)[:40])
                break

        rows_out.append({"label": label, "sub_label": sub_label, "blank_ids": blank_ids})

    if not blanks_out:
        # No recoverable blanks — nothing verifiable to emit.
        gaps.add(lesson_code, "no_keypoints_source", "ex-keypoints", "no non-empty 【】 fills")
        return None

    structure = "nested" if any_nested else "flat"
    answer_dict = {b["id"]: b["answer"] for b in blanks_out}

    # Gap 2: anchor the whole-article 重點表 to the passage/table blocks it summarizes.
    anchors = [{"block_id": bid} for bid in passage_table_anchor_ids]
    needs_review = False
    if not anchors:
        # No passage/table block exists in the source → nothing in-document to anchor to.
        # A source-shape FACT, not a bug: keep anchors=[] but flag it honestly.
        gaps.add(lesson_code, "no_anchorable_passage_in_source", "ex-keypoints")
        needs_review = True

    # Gap 1: an approximate (merged-range / suffix-base) source is honestly flagged.
    if source_kind == "merged_range":
        gaps.add(lesson_code, "keypoints_source_is_merged_range", "ex-keypoints")
        needs_review = True
    elif source_kind == "suffix_base":
        gaps.add(lesson_code, "keypoints_source_suffix_resolved", "ex-keypoints")
        needs_review = True

    return {
        "id": "ex-keypoints",
        "type": "exercise",
        "question": {
            "kind": "keypoints_table",
            "structure": structure,
            "title": title,
            "rows": rows_out,
            "blanks": blanks_out,
        },
        "answer_space": "text",
        "answer": answer_dict,
        "grader": "exact",
        "anchors": anchors,
        "needs_review": needs_review,
    }


# ═══════════════════════════════════════════════════════════════════════════
#  7/8. assemble + validate
# ═══════════════════════════════════════════════════════════════════════════


def build_match_exercise(
    match_blocks: list[dict[str, Any]],
    anchor_ids: list[str],
    gaps: GapLog,
    lesson_code: str,
) -> Optional[dict[str, Any]]:
    """Gap 3: a `match` block is answer-bearing (left clue → right answer) but the contract
    has no dedicated matching kind, and we deliberately do NOT extend it for the 2 corpus
    lessons that use it. To avoid SILENTLY DROPPING real answers we emit ONE `custom`
    ExerciseBlock that preserves every left→right pair machine-comparably and routes to human
    review (CustomQuestion REQUIRES needs_review=True). Also logs ``matching_type_unsupported``
    and surfaces "matching 型別未支援" in the report.

    Returns the ExerciseBlock dict, or None if there is nothing answer-bearing to preserve.
    """
    pairs: list[dict[str, str]] = []
    render_lines: list[str] = []
    for bi, b in enumerate(match_blocks):
        col_left = str(b.get("col_left") or "左").strip()
        col_right = str(b.get("col_right") or "右").strip()
        for r in b.get("rows", []) or []:
            if not isinstance(r, dict):
                continue
            left = str(r.get("left") or "").strip()
            right = str(r.get("right") or "").strip()
            if not left or not right:
                continue
            pairs.append({"left": left, "right": right})
            render_lines.append(f"{left}  →  {right}")

    if not pairs:
        return None

    gaps.add(lesson_code, "matching_type_unsupported", "ex-match", f"{len(pairs)} pair(s)")

    # answer = the ordered list of correct right-hand values (machine-comparable, not prose).
    answer = [p["right"] for p in pairs]
    render_hint = "配對題 (matching, 契約未支援型別):\n" + "\n".join(render_lines)
    return {
        "id": "ex-match",
        "type": "exercise",
        "question": {
            "kind": "custom",
            "prompt": "配對題：將左欄線索對應到右欄答案。",
            "render_hint": render_hint,
        },
        "answer_space": "text",
        "answer": answer,
        "grader": "manual",
        "anchors": [{"block_id": bid} for bid in anchor_ids],
        "needs_review": True,  # required for custom; also honest (unsupported type)
    }


def assemble_lesson(
    spot: dict[str, Any], parsed: dict[str, Any], gaps: GapLog, with_keypoints: bool,
    parsed_source_kind: str = "exact",
) -> dict[str, Any]:
    lesson_id, lesson_code = resolve_identity(spot)
    blocks_in = spot.get("blocks") or []

    presentation, anchor_ids = build_presentation_blocks(blocks_in)

    all_blocks: list[dict[str, Any]] = list(presentation)

    spotlight = group_spotlight_exercise(spot, anchor_ids, gaps, lesson_code)
    if spotlight is not None:
        all_blocks.append(spotlight)

    # Gap 3: `match` blocks are answer-bearing but have no contract kind this round.
    # Emit them as a `custom` block (needs_review) so answers are NEVER silently dropped.
    match_blocks = [b for b in blocks_in if b.get("type") == "match"]
    if match_blocks:
        match_ex = build_match_exercise(match_blocks, anchor_ids, gaps, lesson_code)
        if match_ex is not None:
            all_blocks.append(match_ex)

    # Gap 3: `fill_table` blocks in this corpus are bare {type} stubs — the real content is
    # the _parsed story_structure_table (recovered as ex-keypoints below). Emitting nothing
    # from an empty stub is correct, but log it so the "we saw it, it was empty, we skipped it"
    # decision is on the record (never a silent skip). guide/self_check are intentionally not
    # emitted (教學鷹架 / 後設認知檢核, non-graded — see the audit note in the report).
    for b in blocks_in:
        if b.get("type") == "fill_table" and set(b.keys()) == {"type"}:
            gaps.add(lesson_code, "fill_table_stub_no_inline_content", "fill_table")

    if with_keypoints:
        # Gap 2: keypoints_table is 『整篇文章重點』, so it anchors to the text spans it
        # summarizes — the PASSAGE (p*) + TABLE (tbl*) presentation blocks — NOT a single
        # arbitrary figure (the old last-figure anchor was semantically wrong). ONLY when the
        # lesson has NO passage/table block at all (a pure 圖文 lesson whose content IS its
        # figures) do we fall back to anchoring the figures, so a figure-only lesson stays
        # legitimately anchored instead of being penalised. A lesson with zero presentation
        # blocks of any kind is handled honestly inside build_keypoints_exercise (needs_review
        # + no_anchorable_passage_in_source).
        passage_table_ids = [
            b["id"]
            for b in presentation
            if b["type"] == "paragraph" or b["id"].startswith("tbl")
        ]
        keypoint_anchor_ids = passage_table_ids or [
            b["id"] for b in presentation if b["id"].startswith("fig")
        ]
        kp = build_keypoints_exercise(
            parsed, lesson_code, keypoint_anchor_ids, gaps, parsed_source_kind
        )
        if kp is not None:
            all_blocks.append(kp)

    title = spot.get("title") or parsed.get("title") or None

    return {
        "id": lesson_id,
        "lesson_code": lesson_code,
        "title": title,
        "blocks": all_blocks,
    }


def to_lesson(lesson_dict: dict[str, Any]) -> Lesson:
    """Validate — fail LOUD. A ValidationError here is a MAPPING bug, not a gap."""
    return Lesson.model_validate(lesson_dict)


# ═══════════════════════════════════════════════════════════════════════════
#  9. write
# ═══════════════════════════════════════════════════════════════════════════


def write_yaml(lesson_dict: dict[str, Any], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        yaml.safe_dump(lesson_dict, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


def write_gaps(gaps: GapLog, gaps_out: Path) -> None:
    """Write/merge the adapter known-gaps into its OWN top-level section, deduped."""
    gaps_out.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {}
    if gaps_out.exists():
        loaded = yaml.safe_load(gaps_out.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            existing = loaded

    section = existing.get(GAPS_SECTION) or []
    seen: set[tuple] = {
        (e.get("lesson_code"), e.get("step", ""), e.get("reason")) for e in section
        if isinstance(e, dict)
    }
    for g in gaps.items:
        key = (g.get("lesson_code"), g.get("step", ""), g.get("reason"))
        if key not in seen:
            seen.add(key)
            section.append(g)

    existing[GAPS_SECTION] = section
    header = (
        "# Adapter schema-MAPPING known-gaps (spotlight_to_lesson_content.py).\n"
        "# SIBLING of content_known_gaps.yaml — the machine-checked content-ABSENCE\n"
        "# enum in content_evidence_gate.py is NOT touched by this file.\n"
    )
    gaps_out.write_text(
        header + yaml.safe_dump(existing, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


# ═══════════════════════════════════════════════════════════════════════════
#  Public convenience: build one lesson dict (used by tests)
# ═══════════════════════════════════════════════════════════════════════════


def build_lesson_dict(
    lesson_code: str, gaps: Optional[GapLog] = None, with_keypoints: bool = False
) -> tuple[dict[str, Any], GapLog]:
    """Load DEV7 sources for a code and return (lesson_dict, gaps)."""
    gaps = gaps or GapLog()
    spot = load_spotlight(SPOTLIGHT_DIR / f"{lesson_code}.spotlight.yml")
    parsed, parsed_kind = load_parsed(lesson_code)
    lesson_dict = assemble_lesson(spot, parsed, gaps, with_keypoints, parsed_kind)
    return lesson_dict, gaps


def dev7_codes() -> list[str]:
    """The 7 DEV7 codes, discovered from the dev7 dir (gold_manifest.json excluded)."""
    codes = []
    for p in sorted(SPOTLIGHT_DIR.glob("*.spotlight.yml")):
        codes.append(p.name[: -len(".spotlight.yml")])
    return codes


# ═══════════════════════════════════════════════════════════════════════════
#  CLI (10)
# ═══════════════════════════════════════════════════════════════════════════


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--lesson", action="append", default=[], help="lesson code (repeatable)")
    ap.add_argument("--dev7", action="store_true", help="process all 7 DEV7 lessons")
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="output dir for *.lesson.yml")
    ap.add_argument("--with-keypoints", action="store_true", help="emit ex-keypoints (default OFF)")
    ap.add_argument("--gaps-out", default=str(DEFAULT_GAPS_OUT), help="known-gaps YAML (sibling)")
    args = ap.parse_args(argv)

    codes = list(args.lesson)
    if args.dev7:
        codes = dev7_codes()
    if not codes:
        ap.error("no lessons (pass --lesson <code> or --dev7)")

    out_dir = Path(args.out_dir)
    gaps = GapLog()
    any_fail = False

    for code in codes:
        try:
            lesson_dict, _ = build_lesson_dict(code, gaps, args.with_keypoints)
        except (ValueError, FileNotFoundError) as e:
            any_fail = True
            print(f"🔴 LOAD FAIL {code}: {e}")
            continue
        try:
            lesson = to_lesson(lesson_dict)
        except ValidationError as e:
            any_fail = True
            print(f"🔴 SCHEMA FAIL {code}: {e.error_count()} error(s)\n{e}")
            continue

        out_path = out_dir / f"{lesson.lesson_code}.lesson.yml"
        write_yaml(lesson_dict, out_path)

        exercises = [b for b in lesson.blocks if b.type == "exercise"]
        n_steps = sum(
            len(getattr(b.question, "steps", []) or []) for b in exercises
        )
        n_review = sum(1 for b in exercises if b.needs_review)
        n_gaps = len(gaps.for_lesson(lesson.lesson_code))
        print(
            f"🟢 {lesson.lesson_code:<8} blocks={len(lesson.blocks):>2} "
            f"exercises={len(exercises)} steps={n_steps:>2} "
            f"needs_review={n_review} gaps={n_gaps}"
        )

    write_gaps(gaps, Path(args.gaps_out))
    print(f"\nwrote gaps → {args.gaps_out} ({len(gaps.items)} entries this run)")

    if any_fail:
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
