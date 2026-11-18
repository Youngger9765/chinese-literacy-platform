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

SCOPE (二修, uid tree)
---------------------
* One ordered pass over the spotlight blocks (section 5): passage / figure → reading
  column; guide / concept_box → the next question group's instruction; single / multi /
  free_text → guided_steps steps; sub_block / exercise → a question group each (label →
  step.section, lead text → step.context); table / fill_table → exercise-column tables
  (fill_table rows that carry options or blanks become steps too); matching → one select
  per left item; ordering → OrderingQuestion; self_check and trailing text → paragraphs.
* Every source block (nested included) lands in ``Coverage``: consumed, or dropped with a
  reason. ``lesson_content_loader`` serves a lesson ONLY when nothing was dropped.
* Optionally (``with_keypoints``) ONE keypoints_table exercise from the uid tree's
  ``keypoints.yml``.

DROP REASONS (Coverage — a lesson with any of these stays on the legacy renderer):
  * no_correct_answer_choice   — 「沒有標準答案」的選擇題；契約的 select 沒有這種表達
  * choice_answer_missing / answer_not_printed — 選擇題沒有答案 / 教師版沒印答案
  * answer_not_in_options      — 答案對不到任何選項
  * choice_lt2_options         — 選項少於 2 個（常見：選項印在圖片裡）
  * multi_marker_single_answer — 題目寫「可複選」卻只有一個答案
  * no_prompt                  — 找不到題幹
  * matching_* / ordering_* / table_cell_is_mapping / nested_table / exercise_rows_table /
    fill_table_signpost / unsupported_type / unsupported_nested_type — 形狀還沒支援

KNOWN-GAP REASONS (GapLog — logged, lesson still served):
  * no_anchorable_passage_in_source — the spotlight has no presentation block to anchor to
    (the 課文 lives in another step). A source-shape fact: logged, NOT needs_review —
    needs_review would badge every question 「此題內容可能與本課不符」.
  * strategy_type_unmapped          — a strategy_type with no kind mapping (→ guided_steps)
  * keypoints_*                     — see build_keypoints_exercise

NO HARDCODED LESSON IDS / COURSE NAMES anywhere below (overfit lint self-passes).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any, Optional

import yaml

# #2680: anchored on the backend root (this file is backend/app/services/…) so it
# resolves identically in the container (/app/app/services → /app) and locally.
# The old anchor assumed this module sat at repo-root/scripts/, which it no longer does.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent

# #2680: this module now lives inside the app package, so the plain package
# imports below resolve without the old sys.path trick (which pointed at
# backend/app/backend after the move and was silently useless).
from pydantic import ValidationError

from app.schemas.lesson_content import Lesson
from app.services.lesson_code_normalization import (
    MULTI_LESSON_PRIMARY,
    halfwidth,
    normalize_manifest_code,
)

# ═══════════════════════════════════════════════════════════════════════════
#  Paths (all under the worktree root; tests/fixtures dir, NOT catalog)
# ═══════════════════════════════════════════════════════════════════════════

# The uid tree written by scripts/build_lesson_uid_tree.py:
#   data/lessons/<lesson_uid>/<version_id>/{lesson,spotlight,keypoints}.yml
# The two constants that stood here (`spotlight/dev7/`, `_parsed_2026-05-01/`) were
# both keyed by lesson CODE and both deleted with the first edition (#2683).
LESSONS_ROOT = _BACKEND_ROOT / "data" / "lessons"
DEFAULT_OUT_DIR = _BACKEND_ROOT / "tests" / "fixtures" / "lesson_content_dev7"
DEFAULT_GAPS_OUT = (
    _BACKEND_ROOT / "data" / "curriculum_qa" / "content_known_gaps.adapter.yaml"
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


def resolve_identity(
    spot: dict[str, Any],
    identity: Optional[str] = None,
    lesson_code: Optional[str] = None,
) -> tuple[str, str]:
    """(lesson_id, lesson_code) for this spotlight.

    二修之後身分是 `lesson_uid`，而且它住在 spotlight 檔的**根層**，不在 `spotlight:`
    底下 —— `lesson_uid_loader` 拆外層時只帶 `section_no`，所以呼叫端必須明講
    （`identity=`）。以前這裡只認一修的 `spot["lesson"]`，二修 payload 沒有這個 key，
    結果全庫 172 課都在這裡 raise、被 loader 的 fail-closed 吃成 `lesson_content: null`。

    順序：呼叫端給的 `identity` → payload 自帶的 `lesson_uid` → 一修的 `lesson` 課碼。
    `lesson_code` 是課在目錄裡的**位置**（會隨改版移動），呼叫端有就用它，沒有就跟 id 同值。
    """
    uid = identity or spot.get("lesson_uid")
    if uid:
        return str(uid), str(lesson_code or uid)
    raw_code = spot.get("lesson")
    if not raw_code:
        raise ValueError("spotlight has no identity (no lesson_uid, no lesson)")
    code = normalize_manifest_code(str(raw_code))
    # 一修 fixture：id == lesson_code；NEVER derive/pad.
    return code, code


# ═══════════════════════════════════════════════════════════════════════════
#  5. spotlight walk — one ordered pass, every source block accounted for
# ═══════════════════════════════════════════════════════════════════════════
#
# 以前這一節把全課的 single/multi/free_text 收成**一個** `ex-spotlight`，其餘類型
# （sub_block、fill_table、exercise、matching、ordering、concept_box、self_check、table）
# 一律不產出。二修語料裡那些類型才是大宗：`sub_block` 底下包著 300 多題，
# 172 課裡 0 課的 block 類型完全落在舊的處理範圍內。補上身分之後實測產出中位數
# 1 個 block，legacy `BlockSequenceRenderer` 給學生的是 13 個 —— 直接切換是降級。
#
# 所以改成照原稿順序走一遍，每個來源 block（含巢狀）都要在 `Coverage` 留一筆：
# 被轉成什麼，或為什麼沒轉（dropped + reason）。loader 只在 dropped 為 0 時才供應
# `lesson_content`，否則維持 null、學生繼續走 legacy —— 沒轉完的課不會被切換過去。
#
# 選項與答案的解讀**照 legacy 渲染器**（`reading-spotlight/spotlightBlockLogic.ts`
# `resolveSingleCorrect`），因為那是學生今天看到的行為：
#   * `options` 可以是 list，也可以是 `{代號: 文字}`；順序照 YAML 原序，不重排
#   * 數字答案從 1 起算（全庫 312 個數字答案沒有 0，也沒有超過選項數的）
#   * 字串答案先比代號（A/B/1/2），再比選項文字


_SECTION_HEADER_RE = re.compile(r"^\d+\.\s*(讓我們來看|進階挑戰)")
# 教材明印「沒有標準答案」「沒有正確答案」，或抽取者註記「學生自填」→ 這一塊的題目都沒有正解
_NO_ANSWER_TEXT_RE = re.compile(r"沒有(標準|正確)答案|學生自填")


def _says_no_answer(b: dict[str, Any]) -> bool:
    return bool(b.get("no_correct_answer")) or bool(_NO_ANSWER_TEXT_RE.search(_join(
        b.get("instruction"), b.get("note"), b.get("prompt"), b.get("sub_instruction"))))
_QUESTION_TYPES = ("single", "multi", "free_text")


class Coverage:
    """每個來源 block 走完之後的去向。``dropped`` 非空 = 這課不能切換到新渲染器。"""

    def __init__(self) -> None:
        self.consumed: list[tuple[str, str]] = []
        # 轉不成正式 block、改用只讀 `generic` 畫出來的（內容在，但不能作答）
        self.fallback: list[dict[str, str]] = []
        self.dropped: list[dict[str, str]] = []

    def ok(self, path: str, t: str) -> None:
        self.consumed.append((path, t))

    def drop(self, path: str, t: str, reason: str) -> None:
        self.dropped.append({"path": path, "type": t, "reason": reason})

    def generic(self, path: str, t: str, reason: str) -> None:
        self.fallback.append({"path": path, "type": t, "reason": reason})


class _Drop(Exception):
    """A source block the contract cannot carry faithfully (reason = ledger key)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _txt(v: Any) -> str:
    """Scalar → stripped text ('' for None / containers). YAML gives `label: 2.0` sometimes."""
    if v is None or isinstance(v, (list, dict, bool)):
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def _join(*parts: Any, sep: str = "\n") -> str:
    return sep.join(t for t in (_txt(p) for p in parts) if t)


def _opts_as_list(options: Any) -> tuple[list[str], Optional[list[str]]]:
    """選項 → (文字清單, 代號清單或 None)。`{1:'甲',2:'乙'}` 與 `['甲','乙']` 兩種都收，
    字典照原序（代號本身就是教材印的順序，排序會讓答案位置對不上）。"""
    if isinstance(options, dict):
        return [str(v) for v in options.values()], [str(k).strip() for k in options.keys()]
    if isinstance(options, list):
        return [str(o) for o in options], None
    return [], None


def _answer_index(raw: Any, opts: list[str], keys: Optional[list[str]]) -> Optional[int]:
    """來源的一個答案 → 0-based 選項位置；解不出來回 None（呼叫端決定怎麼處理）。"""
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, list):
        return _answer_index(raw[0], opts, keys) if len(raw) == 1 else None
    if isinstance(raw, int):
        return raw - 1 if 1 <= raw <= len(opts) else None
    s = str(raw).strip()
    if not s:
        return None
    if keys:
        want = s.upper()
        for i, k in enumerate(keys):
            if k.upper() == want:
                return i
    if s.isdigit():
        n = int(s)
        return n - 1 if 1 <= n <= len(opts) else None
    norm_opts = [_norm(o) for o in opts]
    idx = _index_of(_norm(s), norm_opts)
    if idx is not None:
        return idx
    # legacy 也接受「選項包含答案 / 答案包含選項」—— 但只在唯一命中時才採用
    hits = [i for i, o in enumerate(norm_opts) if o and (_norm(s) in o or o in _norm(s))]
    return hits[0] if len(hits) == 1 else None


def _answer_indices(raw: Any, opts: list[str], keys: Optional[list[str]]) -> Optional[list[int]]:
    if raw is None or isinstance(raw, bool):
        return None
    items = raw if isinstance(raw, list) else re.split(r"[、,，\s]+", str(raw).strip())
    out: list[int] = []
    for a in items:
        if a in ("", None):
            continue
        i = _answer_index(a, opts, keys)
        if i is None:
            return None
        if i not in out:
            out.append(i)
    return sorted(out) if out else None


def _model_answer_value(b: dict[str, Any]) -> bool:
    """`value` 是不是教師版的示範答案。抽取時用 `answer_carrier` 記錄答案的載體，
    教師版答案一律是橘色手寫；那種 `value` 是**答案**，不能當題幹畫給學生看
    （legacy `renderSubBlock` 會把它原樣畫出來 —— 等於把答案印在題目上）。"""
    carrier = _txt(b.get("answer_carrier"))
    return bool(_txt(b.get("value"))) and not b.get("blanks") and (
        "橘色手寫" in carrier or "示範答案" in carrier
    )


def _reference_text(b: dict[str, Any]) -> Optional[str]:
    """free_text 的參考答案：`answer` 字串、`answer_free_text`、`answers` 清單、
    `blanks[].answer`，或示範答案形狀的 `value`。"""
    if isinstance(b.get("answer"), str) and b["answer"].strip():
        return b["answer"].strip()
    if _model_answer_value(b):
        return _txt(b.get("value"))
    for k in ("answer_text", "result"):
        if _txt(b.get(k)):
            return _txt(b[k])
    parts: list[str] = []
    aft = b.get("answer_free_text")
    for src in (b.get("answers"), b.get("blanks"), aft if isinstance(aft, list) else [aft]):
        for a in src or []:
            t = _txt(a.get("answer")) if isinstance(a, dict) else _txt(a)
            if t:
                parts.append(t)
    return "；".join(parts) or None


def _prompt_of(b: dict[str, Any]) -> str:
    """題幹。抽取者寫過三個名字（prompt / instruction / stem，legacy `promptOf` 同序），
    前面接小標（label / sub_label / intro / quote），後面接提示（hint）。
    不收 `value` / `teacher_note` —— 前者常是答案，後者是教師版的字。"""
    mains: list[str] = []
    for k in ("instruction", "sub_instruction", "text", "prompt", "stem"):
        t = _txt(b.get(k))
        if t and t not in mains:
            mains.append(t)
    if not mains and isinstance(b.get("paragraphs"), list):
        mains = [_txt(p) for p in b["paragraphs"]]
    # `value` 通常是題目的一部分（填空句、待判斷的句子）；示範答案形狀的不是 —— 那是答案。
    value = None if _model_answer_value(b) else _join(b.get("value"), b.get("value_tail"), sep="")
    if not mains and not value and not any(_txt(b.get(k)) for k in ("label", "sub_label", "intro", "event")):
        # 表格形狀的小題：題幹散在以欄名為 key 的欄位裡（例：`上位概念: 比賽【時間】`）
        mains = [_txt(v) for k, v in b.items()
                 if isinstance(v, str) and not _row_meta_key(k) and k not in _PROMPT_SKIP_KEYS]
    base = _join(b.get("label"), b.get("sub_label"), b.get("intro"), b.get("quote"),
                 b.get("event"), b.get("clue"), b.get("emotion"), *mains, value, b.get("hint"))
    if not base:
        return ""
    return _join(base, *_extra_visible(b, base))


# ── 「這個欄位學生看得到嗎」—— 語料的欄位名不固定（content / tip / viewpoint / 中文欄名…），
#    所以反過來列：答案欄、抽取者註記、結構欄以外的字串，一律當成印在紙上的字。
_ANSWER_KEYS = {"answer", "answers", "answer_free_text", "answer_text", "result", "selected",
                "subject", "answer_label", "answer_chain", "student_filled"}
_META_KEY_RE = re.compile(
    r"note|carrier|errata|source_text|_answers?$|blanks|teacher|circled|marker|_printed|layout|"
    r"shape|placement|provenance|_ref$|^asset$|^referent$|bind|^id$|option_label|shows_sentences_from|"
    r"^delete_|^type$|^strategy_|^lesson"
)


def _extra_visible(b: dict[str, Any], used: str) -> list[str]:
    """`b` 裡還沒被用到（不在 `used` 裡）的學生可見字串，照原稿欄位順序。"""
    seen = _norm(used)
    out: list[str] = []
    for k, v in b.items():
        k = str(k)
        if not isinstance(v, str) or not v.strip() or k in _ANSWER_KEYS or _META_KEY_RE.search(k):
            continue
        if k == "explanation" and not b.get("prefilled"):
            continue  # 解析 = 答案的理由；只有「範例」題（已填好示範）才印給學生
        if k == "value" and _model_answer_value(b):
            continue
        t = v.strip()
        if _norm(t) and _norm(t) not in seen:
            out.append(t)
            seen += _norm(t)
    return out


# 不是題幹的字串欄：型別、抽取者註記、答案載體
_PROMPT_SKIP_KEYS = {"type", "answer_carrier", "teacher_note", "source_text", "errata_ref",
                     "answer_free_text", "prompt_note", "options_note"}


def _note_text(b: dict[str, Any]) -> str:
    """只有說明、沒有作答的小項（例句、關鍵詞、課文摘句）→ 一段文字。"""
    kw = b.get("keywords")
    base = _join(b.get("label"), b.get("sub_label"), b.get("stem"), b.get("text"),
                 b.get("passage"), None if _model_answer_value(b) else b.get("value"),
                 "、".join(_txt(k) for k in kw) if isinstance(kw, list) else None)
    return _join(base, *_extra_visible(b, base))


def _infer_type(b: dict[str, Any], option_bank: Any = None) -> Optional[str]:
    """沒寫 `type` 的小題（巢在 sub_block / exercise 裡）照欄位推型別。"""
    t = b.get("type")
    if t:
        return str(t)
    ans = b.get("answers", b.get("answer"))
    if b.get("items"):
        # 有 items 就是容器 —— 就算它自己也帶 options（會考題：題幹＋選項在容器上，
        # items 是解題步驟 ❶～❹）。先判成單選的話，底下的步驟會整串不見。
        return "sub_block"
    if b.get("options") is not None:
        return "multi" if isinstance(ans, list) and len(ans) > 1 else "single"
    if option_bank and (b.get("stem") or b.get("prompt")):
        return "single"
    if isinstance(b.get("table"), dict):
        return "item_table"
    if (b.get("blanks") is not None or isinstance(b.get("answer"), str)
            or b.get("answer_free_text") is not None or _model_answer_value(b)):
        return "free_text"
    if b.get("items") is not None:
        return "sub_block"
    if any(_txt(b.get(k)) for k in ("stem", "text", "passage", "value", "label", "sub_label")):
        return "note"
    return None


def _build_step(b: dict[str, Any], t: str, option_bank: Any = None) -> dict[str, Any]:
    """One single/multi/free_text source block → one GuidedStep dict, or raise _Drop."""
    prompt = _prompt_of(b)
    if not prompt:
        raise _Drop("no_prompt")

    nca = bool(b.get("no_correct_answer"))
    if t == "free_text":
        step = {"prompt": prompt, "type": "free_text", "answer": None,
                "reference_answer": None if nca else _reference_text(b)}
        if nca:
            step["no_correct_answer"] = True
        return step

    opts, keys = _opts_as_list(b.get("options") if b.get("options") is not None else option_bank)
    if len(opts) < 2:
        raise _Drop("choice_lt2_options")
    if nca:
        # 沒有標準答案（自我覺察、個人經驗、自我檢核、規劃、分流）：作答即完成、不判對錯。
        is_multi = t == "multi" or _is_multi_marker(prompt)
        return {"prompt": prompt, "type": "multi_select" if is_multi else "select",
                "options": opts, "answer": None, "no_correct_answer": True}
    raw = b.get("answers") if b.get("answers") is not None else b.get("answer")
    if raw is None:
        # `answers_printed: false` = 有標準答案但教師版沒印 —— 一樣不能判分，但原因不同
        raise _Drop("answer_not_printed" if b.get("answers_printed") is False else "choice_answer_missing")

    if t == "multi" or (isinstance(raw, list) and len(raw) > 1):
        idxs = _answer_indices(raw, opts, keys)
        if idxs is None:
            raise _Drop("answer_not_in_options")
        return {"prompt": prompt, "type": "multi_select", "options": opts, "answer": idxs}

    idx = _answer_index(raw, opts, keys)
    if idx is None:
        raise _Drop("answer_not_in_options")
    if _is_multi_marker(prompt):
        # 題目寫「可複選」卻只有一個答案：單選 UI 會把另一個正解判錯。
        raise _Drop("multi_marker_single_answer")
    return {"prompt": prompt, "type": "select", "options": opts, "answer": idx}


def _make_step(
    b: dict[str, Any], lesson_code: str, gaps: GapLog, step_ref: str
) -> tuple[dict[str, Any], bool]:
    """Compat shim: (step_dict, unresolved). A drop comes back as an answer-less step +
    unresolved=True, and the reason is logged on ``gaps``."""
    t = b.get("type") or _infer_type(b) or "single"
    try:
        return _build_step(b, t), False
    except _Drop as d:
        reason = "answer_not_in_options" if d.reason == "choice_answer_missing" else d.reason
        gaps.add(lesson_code, reason, step_ref, _txt(b.get("answer")))
        opts, _ = _opts_as_list(b.get("options"))
        step_type = "free_text" if t == "free_text" else "select"
        step: dict[str, Any] = {"prompt": _prompt_of(b) or "（無題幹）", "type": step_type, "answer": None}
        if step_type == "select":
            step["options"] = opts
        return step, True


_ROW_META_SUFFIXES = ("_options", "_answer", "_answers", "_blanks", "_note", "_notes",
                      "_source_text", "_errata_ref", "_label", "_label_printed", "_title", "_group")
# 附在某一欄上、學生看得到的小標（「例」「範例」「相異」）—— 畫在那一格的前面
_CELL_LABEL_SUFFIXES = ("_label", "_label_printed", "_title", "_group")
_ROW_META_KEYS = {"index", "answer", "answers", "options", "blanks", "note", "notes", "answer_free_text",
                  "label",
                  "no_correct_answer", "answer_carrier", "answer_note", "circled_connectives",
                  "circled_keywords", "circled_terms", "example", "checked"}


def _row_meta_key(k: Any) -> bool:
    """表格列裡不是「格子內容」的欄：答案、選項、抽取者的註記。"""
    k = str(k)
    return k in _ROW_META_KEYS or k.endswith(_ROW_META_SUFFIXES) or k.startswith("circled")


def _table_rows(b: dict[str, Any]) -> tuple[list[str], list[list[str]]]:
    headers, _, rows = _table_layout(b)
    return headers, rows


def _table_layout(b: dict[str, Any]) -> tuple[list[str], list[Optional[str]], list[list[str]]]:
    """table / fill_table → (headers, 每欄對應的原稿 key, rows)，照 legacy 的兩種 rows 形狀：
    陣列的陣列，或「以欄名為 key 的物件 + columns」。物件形狀只取 columns 列出的欄，
    所以同一列裡的 `answer` / `*_options` 不會被畫進格子。"""
    columns = [_txt(c) for c in (b.get("columns") or b.get("headers") or [])]
    raw_rows = b.get("rows") or []
    col_keys: list[Optional[str]] = list(columns)

    def cell(v: Any) -> str:
        if isinstance(v, list):
            return "\n".join(_txt(x) for x in v)
        if isinstance(v, dict):
            # 格子本身就是一組勾選選項（例：動物例子 ①竹節蟲 ②石虎 ③枯葉蝶）
            return "　".join(f"{k}. {_txt(x)}" for k, x in v.items())
        return _txt(v)

    keyed = [r for r in raw_rows if isinstance(r, dict)]
    if keyed:
        # 欄名跟列的 key 常差一個空白（`A 事件` vs `A事件`）；對不上的欄照樣畫、
        # columns 沒列到的內容欄補在後面 —— 寧可多一欄，不可少一格。
        def nk(k: Any) -> str:
            return re.sub(r"\s+", "", str(k))
        content_keys: list[str] = []
        for r in keyed:
            for k in r:
                if not _row_meta_key(k) and str(k) not in content_keys:
                    content_keys.append(str(k))
        by_norm = {nk(k): k for k in content_keys}
        col_keys = [by_norm.get(nk(c)) for c in columns]
        extra = [k for k in content_keys if k not in col_keys]
        if not columns and not extra:
            raise _Drop("keyed_rows_without_columns")
        columns = columns + extra
        col_keys = col_keys + extra
    rows: list[list[str]] = []
    for r in raw_rows:
        if isinstance(r, dict):
            label_line = _txt(r.get("label"))
            row = []
            for ci, k in enumerate(col_keys):
                lab = "" if k is None else _join(*(r.get(f"{k}{suf}") for suf in _CELL_LABEL_SUFFIXES))
                # `k is not None`，不是 `if k`：沒有表頭的那一欄 key 是空字串，它的格子照樣要畫
                row.append(_join(lab if ci else _join(label_line, lab), cell(r.get(k)) if k is not None else ""))
            rows.append(row)
        elif isinstance(r, list):
            rows.append([cell(x) for x in r])
        else:
            rows.append([cell(r)])
    return columns, col_keys, rows


_GENERIC_HEADING_KEYS = ("label", "sub_label", "title")
_GENERIC_TEXT_KEYS = ("intro", "instruction", "sub_instruction", "quote", "prompt", "stem", "text",
                      "event", "clue", "emotion", "value", "value_tail", "hint")
_GENERIC_TAIL_KEYS = ("closing", "reflection", "tail")


def _generic_parts(b: Any, depth: int = 0) -> list[dict[str, Any]]:
    """原稿 block → 只讀的標題／文字／選項／表格，照原稿順序。**不收任何答案欄**：
    answer / answers / blanks / *_answer / teacher_note / 示範答案形狀的 value 都不進來。"""
    if isinstance(b, str):
        return [{"kind": "text", "text": b, "depth": depth}] if b.strip() else []
    if isinstance(b, list):
        return [p for x in b for p in _generic_parts(x, depth)]
    if not isinstance(b, dict):
        return []
    parts: list[dict[str, Any]] = []
    for k in _GENERIC_HEADING_KEYS:
        if _txt(b.get(k)):
            parts.append({"kind": "heading", "text": _txt(b[k]), "depth": depth})
    for k in _GENERIC_TEXT_KEYS:
        if k == "value" and _model_answer_value(b):
            continue
        if _txt(b.get(k)):
            parts.append({"kind": "text", "text": _txt(b[k]), "depth": depth})
    paras = [_txt(x) for x in b.get("paragraphs") or [] if _txt(x)] if isinstance(b.get("paragraphs"), list) else []
    if paras:
        parts.append({"kind": "text", "text": "\n".join(paras), "depth": depth})
    for k in ("options", "option_bank"):
        opts = b.get(k)
        if isinstance(opts, dict) and opts:
            parts.append({"kind": "options", "items": [f"{ok}. {_txt(ov)}" for ok, ov in opts.items()], "depth": depth})
        elif isinstance(opts, list) and opts:
            parts.append({"kind": "options", "items": [_txt(o) for o in opts], "depth": depth})
    for side, head in (("left", "left_header"), ("middle", "middle_header"), ("right", "right_header")):
        col = b.get(side)
        if isinstance(col, dict) and col:
            if _txt(b.get(head)):
                parts.append({"kind": "heading", "text": _txt(b[head]), "depth": depth})
            parts.append({"kind": "options", "items": [f"{ck}. {_txt(cv)}" for ck, cv in col.items()], "depth": depth})
    if isinstance(b.get("rows"), list) and b["rows"]:
        try:
            headers, rows = _table_rows(b)
            parts.append({"kind": "table", "headers": headers, "rows": rows, "depth": depth})
        except _Drop:
            parts.extend(_generic_parts([r for r in b["rows"] if isinstance(r, str)], depth))
    elif isinstance(b.get("columns"), list) and b["columns"]:
        parts.append({"kind": "table", "headers": [_txt(c) for c in b["columns"]], "rows": [], "depth": depth})
    if isinstance(b.get("table"), dict):
        parts.extend(_generic_parts(b["table"], depth + 1))
    if isinstance(b.get("items"), list):
        parts.extend(_generic_parts(b["items"], depth + 1))
    for k in _GENERIC_TAIL_KEYS:
        if _txt(b.get(k)):
            parts.append({"kind": "text", "text": _txt(b[k]), "depth": depth})
    used = "".join(p.get("text") or "" for p in parts) + "".join(i for p in parts for i in p.get("items", []))
    parts.extend({"kind": "text", "text": t, "depth": depth} for t in _extra_visible(b, used))
    # 其餘巢狀結構（各課自訂的 callout_boxes / annotations / option_examples…）照樣往下畫
    for k, v in b.items():
        if isinstance(v, (dict, list)) and str(k) not in _GENERIC_HANDLED and not _answer_or_meta(k):
            parts.extend(_generic_parts(v, depth + 1))
    return parts


_GENERIC_HANDLED = {"paragraphs", "options", "option_bank", "left", "middle", "right", "rows",
                    "columns", "table", "items"}


def _answer_or_meta(k: Any) -> bool:
    k = str(k)
    return k in _ANSWER_KEYS or bool(_META_KEY_RE.search(k))


# 走訪器自己會處理的巢狀欄位；其他 list / dict 欄位 = 這一課自訂的結構 → 在 block 後面用 generic 補畫
_WALKER_HANDLED = _GENERIC_HANDLED | {"headers", "row_count"}


def _leftover_fields(b: dict[str, Any], handled: frozenset = frozenset()) -> dict[str, Any]:
    return {
        k: v for k, v in b.items()
        if isinstance(v, (dict, list)) and v and str(k) not in (_WALKER_HANDLED | handled)
        and not _answer_or_meta(k)
        and not str(k).endswith(("_options", "_blanks"))
        and not (isinstance(v, dict) and (f"{k}_answer" in b or f"{k}_answers" in b))
    }


# ═══════════════════════════════════════════════════════════════════════════
#  5b. 表格作答 — fill_table → table_exercise（格子就地作答）
# ═══════════════════════════════════════════════════════════════════════════
#
# 學習單的「在正確的格子裡打勾」「完成表格」是一整張表，學生在格子裡勾、在【　】裡寫。
# 以前這裡把表畫成不能點的 TableBlock、再把每一列另外列成題目 —— 學生看到一張空格點不了的
# 表，接著是同樣的句子再問一次。現在每個作答位（TableSlot）就放在它原本的格子裡。

# 學生要寫的空格：空的【　】、空的全形／半形括號
_EMPTY_MARK_RE = re.compile(r"【[\s　]*】|（[\s　]+）|\([\s　]+\)")
# 列舉選項時前面的記號（□①、☑②、1.、(A)…）
_ENUM_MARK_RE = re.compile(r"^[\s□☐☑■✓✔]*(?:[①-⑳]|\(?[0-9A-Za-zㄅ-ㄩ]{1,2}[\.．、\)）])?[\s□☐☑■✓✔]*")
# 表頭看起來是作答欄（放沒有指定欄位的作答位）
_ANSWER_COL_RE = re.compile(r"勾選|選出|填|作答|答案|判斷")


def _strip_enumerated_options(text: str, options: list[str]) -> str:
    """格子裡把選項又列了一次（□①…☑②…）→ 拿掉那幾行；選項改由作答位畫。
    ☑ 是教師版的勾 —— 留著就是把答案印在題目上。"""
    opts = {_norm(o) for o in options}
    keep = [ln for ln in text.splitlines() if _norm(_ENUM_MARK_RE.sub("", ln)) not in opts]
    return "\n".join(keep).strip()


def _slot_answer(kind: str, raw: Any, opts: list[str], keys: Optional[list[str]]) -> Any:
    if kind == "multi_choice":
        return _answer_indices(raw, opts, keys)
    return _answer_index(raw, opts, keys)


def build_table_exercise(
    b: dict[str, Any], path: str, cov: Coverage, lead: str
) -> Optional[dict[str, Any]]:
    """fill_table → table_exercise question dict（含 `_answer`），沒有任何作答位時回 None。
    解不出答案的作答位不會讓整張表失效：那一格改成只讀（把選項印出來），記一筆 generic。"""
    headers, col_keys, text_rows = _table_layout(b)
    headers = list(headers)
    nca_table = _says_no_answer(b)
    table_opts = b.get("options") if b.get("options") is not None else b.get("option_bank")
    raw_rows = [r for r in (b.get("rows") or [])]
    slots: list[dict[str, Any]] = []
    rows: list[list[dict[str, Any]]] = []
    need_answer_col = False
    multi_hint = _is_multi_marker(_join(b.get("instruction"), b.get("prompt"), *headers))

    def nk(x: Any) -> str:
        return re.sub(r"\s+", "", str(x))

    def col_of(key: str) -> Optional[int]:
        for ci, k in enumerate(col_keys):
            if k is not None and nk(k) == nk(key):
                return ci
        for ci, h in enumerate(headers):
            if nk(h) == nk(key):
                return ci
        return None

    for ri, r in enumerate(raw_rows):
        cells = [{"text": t, "slots": []} for t in (text_rows[ri] if ri < len(text_rows) else [])]
        rows.append(cells)
        if not isinstance(r, dict):
            continue
        rp = f"{path}.rows.{ri}"
        nca = nca_table or _says_no_answer(r)
        pending_answer_cell: list[dict[str, Any]] = []  # slots with no column of their own

        def new_slot(kind: str, options: Any, raw: Any, header_hint: str = "") -> Optional[dict[str, Any]]:
            sid = f"r{ri + 1}.s{len([s for s in slots if s['id'].startswith(f'r{ri + 1}.')]) + 1}"
            if kind == "text":
                ans = None if nca else (_txt(raw) or None)
                slot = {"id": sid, "type": "text", "options": [], "answer": ans, "no_correct_answer": bool(nca)}
                slots.append(slot)
                return slot
            opts, keys = _opts_as_list(options)
            if len(opts) < 2:
                cov.generic(rp, "row", "choice_lt2_options")
                return None
            if isinstance(raw, list) and len(raw) > 1:
                kind = "multi_choice"
            elif kind == "choice" and (_is_multi_marker(header_hint) or (nca and multi_hint)):
                kind = "multi_choice"
            if nca:
                ans = None
            else:
                if raw is None:
                    cov.generic(rp, "row", "choice_answer_missing")
                    return None
                ans = _slot_answer(kind, raw if kind != "multi_choice" or isinstance(raw, list) else [raw], opts, keys)
                if ans is None:
                    cov.generic(rp, "row", "answer_not_in_options")
                    return None
            slot = {"id": sid, "type": kind, "options": opts, "answer": ans, "no_correct_answer": bool(nca)}
            slots.append(slot)
            return slot

        def read_only(ci: Optional[int], options: Any) -> None:
            opts, keys = _opts_as_list(options)
            line = "　".join(f"{k}. {o}" for k, o in zip(keys or [str(i + 1) for i in range(len(opts))], opts))
            if ci is not None and ci < len(cells):
                cells[ci]["text"] = _join(cells[ci]["text"], line)
            else:
                pending_answer_cell.append({"text": line})

        def place_choice(slot: dict[str, Any]) -> None:
            """整列一組選項：選項剛好是欄名 → 每欄一格（打勾矩陣）；否則放進作答欄。"""
            hidx = {nk(h): i for i, h in enumerate(headers)}
            if all(nk(o) in hidx for o in slot["options"]):
                for oi, o in enumerate(slot["options"]):
                    c = cells[hidx[nk(o)]]
                    c["slots"] = [slot["id"]]
                    c["matrix_option"] = oi
                return
            place_free(slot)

        def place_free(slot: dict[str, Any]) -> None:
            for ci, h in enumerate(headers):
                if ci and _ANSWER_COL_RE.search(h) and not cells[ci]["text"].strip("（）() 　") and not cells[ci]["slots"]:
                    cells[ci]["slots"].append(slot["id"])
                    return
            for ci in range(1, len(cells)):
                if not cells[ci]["text"].strip("（）() 　") and not cells[ci]["slots"] and "matrix_option" not in cells[ci]:
                    cells[ci]["slots"].append(slot["id"])
                    return
            pending_answer_cell.append({"slot": slot["id"]})

        # (a) 整列一組選項：`options` + answer(s)，或整張表共用的選項 + 每列 answer
        if isinstance(r.get("options"), (dict, list)):
            raw = r.get("answers") if r.get("answers") is not None else r.get("answer")
            slot = new_slot("choice", r["options"], raw)
            if slot:
                place_choice(slot)
            else:
                read_only(None, r["options"])
        elif table_opts is not None and r.get("answer") is not None or (table_opts is not None and nca):
            slot = new_slot("choice", table_opts, r.get("answer"))
            if slot:
                place_choice(slot)

        # (b) 某一欄帶選項：`<欄>_options`，或格子本身是選項字典 + `<欄>_answer(s)`
        for k in list(r.keys()):
            k = str(k)
            if k.endswith("_options") and isinstance(r[k], (dict, list)):
                col = k[: -len("_options")]
            elif isinstance(r.get(k), dict) and not _row_meta_key(k) and (f"{k}_answer" in r or f"{k}_answers" in r):
                col = k
            else:
                continue
            ci = col_of(col)
            raw = r.get(f"{col}_answers") if r.get(f"{col}_answers") is not None else r.get(f"{col}_answer")
            slot = new_slot("choice", r[k], raw, header_hint=col)
            opts, _ = _opts_as_list(r[k])
            if ci is not None and ci < len(cells):
                cells[ci]["text"] = "" if col == k else _strip_enumerated_options(cells[ci]["text"], opts)
            if slot:
                if ci is not None and ci < len(cells):
                    cells[ci]["slots"].append(slot["id"])
                else:
                    place_free(slot)
            else:
                read_only(ci, r[k])

        # (c) 空格：`<欄>_blanks` 放進該欄；整列的 `blanks` 依序填進有空格的格子
        def fill_blanks(blanks: list[Any], targets: list[int]) -> None:
            answers = [_txt(x.get("answer")) if isinstance(x, dict) else _txt(x) for x in blanks]
            order = [ci for ci in targets for _ in range(len(_EMPTY_MARK_RE.findall(cells[ci]["text"])))]
            for i, a in enumerate(answers):
                slot = new_slot("text", None, a)
                if i < len(order):
                    cells[order[i]]["slots"].append(slot["id"])
                elif order:
                    cells[order[-1]]["slots"].append(slot["id"])
                else:
                    place_free(slot)

        col_blank_cells: set[int] = set()
        for k in list(r.keys()):
            if str(k).endswith("_blanks") and isinstance(r[k], list):
                ci = col_of(str(k)[: -len("_blanks")])
                if ci is not None and ci < len(cells):
                    col_blank_cells.add(ci)
                    fill_blanks(r[k], [ci])
        if isinstance(r.get("blanks"), list) and r["blanks"]:
            marked = [ci for ci, c in enumerate(cells) if ci not in col_blank_cells and _EMPTY_MARK_RE.search(c["text"])]
            fill_blanks(r["blanks"], marked)
        elif r.get("answer_free_text") is not None or (
            isinstance(r.get("answer"), str) and not isinstance(r.get("options"), (dict, list)) and table_opts is None
        ):
            aft = r.get("answer_free_text")
            ref = "；".join(_txt(x) for x in aft) if isinstance(aft, list) else _txt(aft) or _txt(r.get("answer"))
            marked = [ci for ci, c in enumerate(cells) if _EMPTY_MARK_RE.search(c["text"])]
            slot = new_slot("text", None, ref)
            if marked:
                cells[marked[0]]["slots"].append(slot["id"])
            else:
                place_free(slot)

        if pending_answer_cell:
            need_answer_col = True
            extra = {"text": _join(*(p.get("text") for p in pending_answer_cell)),
                     "slots": [p["slot"] for p in pending_answer_cell if p.get("slot")]}
            cells.append(extra)

    if not raw_rows:
        # 空白表格讓學生自己填（原稿每格都空）→ 每一格一個作答位
        n = b.get("row_count") if isinstance(b.get("row_count"), int) else 1
        for ri in range(max(n, 1)):
            cells = []
            for ci in range(len(headers)):
                sid = f"r{ri + 1}.s{ci + 1}"
                slots.append({"id": sid, "type": "text", "options": [], "answer": None,
                              "no_correct_answer": nca_table})
                cells.append({"text": "", "slots": [sid]})
            rows.append(cells)

    if not slots:
        return None
    width = max(len(headers) + (1 if need_answer_col else 0), max((len(r) for r in rows), default=0))
    if need_answer_col and len(headers) < width:
        headers = headers + ["作答"] * (width - len(headers))
    for cells in rows:
        cells.extend({"text": "", "slots": []} for _ in range(width - len(cells)))

    bank = b.get("options") if isinstance(b.get("options"), dict) else b.get("option_bank")
    bank_line = "　".join(f"{k}. {_txt(v)}" for k, v in bank.items()) if isinstance(bank, dict) else ""
    instr = _join(lead, b.get("label"), b.get("title"), b.get("instruction"), b.get("prompt"),
                  b.get("sub_instruction"), bank_line, sep="\n\n")
    instr = _join(instr, *_extra_visible(
        {k: v for k, v in b.items() if k not in ("label", "tail", "reflection", "closing")}, instr))
    return {
        "kind": "table_exercise",
        "instruction": instr or "請完成表格",
        "headers": headers,
        "rows": [[{k: v for k, v in c.items() if k != "matrix_option" or v is not None} for c in r] for r in rows],
        "slots": slots,
        "_answer": {s["id"]: s["answer"] for s in slots},
    }


class _Walker:
    """照原稿順序走一遍 spotlight blocks，產出 Lesson blocks + Coverage。

    版面規則（配合 `LessonRenderer` 左欄閱讀／右欄作答）：
      * passage / figure → 左欄（paragraph / figure），不打斷題組
      * guide / concept_box → 暫存為下一個題組的 `instruction`
      * single / multi / free_text → 加進目前題組（一個 guided_steps exercise）
      * sub_block / exercise → 自成一個題組；`label` 當 step.section、說明文字當 context
      * table / fill_table → 右欄表格（placement=exercise）；fill_table 帶選項或空格的列另成題組
      * matching → 每個左項一題 select；ordering → OrderingQuestion
      * 最後沒有題組可掛的說明文字（常見是結尾的 self_check）→ 左欄 paragraph
    """

    def __init__(self, lesson_code: str, gaps: GapLog, cov: Coverage, kind: str, strategy_name: str):
        self.lesson_code = lesson_code
        self.gaps = gaps
        self.cov = cov
        self.kind = kind
        self.strategy_name = strategy_name
        self.blocks: list[dict[str, Any]] = []
        self.lead: list[str] = []
        self.group: Optional[dict[str, Any]] = None
        self.n = {"p": 0, "fig": 0, "tbl": 0, "ex": 0, "ord": 0}

    # ── emit helpers ─────────────────────────────────────────────────────────
    def _paragraph(self, text: str) -> None:
        if not text.strip():
            return
        self.n["p"] += 1
        self.blocks.append({"id": f"p{self.n['p']}", "type": "paragraph", "text": text})

    def _open(self, instruction: Optional[str] = None) -> dict[str, Any]:
        if self.group is None:
            instr = _join(*self.lead, instruction, sep="\n\n") or self.strategy_name
            self.lead = []
            self.group = {"instruction": instr, "steps": []}
        elif instruction:
            self.group["instruction"] = _join(self.group["instruction"], instruction, sep="\n\n")
        return self.group

    def fallback(self, b: Any, path: str, t: str, reason: str) -> None:
        """轉不成正式 block 的原稿內容 → 只讀 `generic`（插在題組中間就先收掉、畫完再接著開）。
        連 generic 都生不出內容，才記成真正的 drop（loader 會因此不供應這一課）。"""
        parts = _generic_parts(b)
        if not parts:
            self.cov.drop(path, t, reason)
            return
        g = self.group
        self.close()
        for text in self.lead:  # 還沒掛上題組的說明，先照順序畫在它前面
            self._paragraph(text)
        self.lead = []
        self.n["gen"] = self.n.get("gen", 0) + 1
        self.blocks.append({"id": f"gen-{self.n['gen']}", "type": "generic", "reason": reason, "parts": parts})
        self.cov.generic(path, t, reason)
        if g is not None and g["steps"]:
            self._open()

    def leftovers(self, b: dict[str, Any], path: str, t: str, handled: frozenset = frozenset()) -> None:
        """這個 block 帶著走訪器不認得的巢狀欄位 → 緊接著畫成只讀 generic，內容不丟。
        欄位裡沒有任何學生看得到的字（例：教師版的 `checked` 勾選記號）就只記一筆、不畫。"""
        extra = _leftover_fields(b, handled)
        if not extra:
            return
        if not _generic_parts(extra):
            self.cov.ok(path, "leftover_without_visible_text")
            return
        self.fallback(extra, path, t, "unmapped_fields:" + ",".join(sorted(map(str, extra))))

    def close(self) -> None:
        g, self.group = self.group, None
        if not g or not g["steps"]:
            if g and g["instruction"] != self.strategy_name:
                self.lead.insert(0, g["instruction"])
            return
        self.n["ex"] += 1
        self.blocks.append({
            "id": f"ex-spotlight-{self.n['ex']}",
            "type": "exercise",
            "question": {
                "kind": self.kind,
                "strategy_name": self.strategy_name,
                "instruction": g["instruction"],
                "steps": g["steps"],
            },
            "answer_space": "free_text",
            "answer": [s.get("answer") for s in g["steps"]],
            "grader": "rubric_ai",
            "anchors": [],  # filled in by assemble_lesson once every block exists
            "needs_review": False,
        })

    def _add_step(self, b: dict[str, Any], t: str, path: str, *, section: Optional[str] = None,
                  context: Optional[str] = None, prefix: Optional[list[str]] = None,
                  option_bank: Any = None) -> bool:
        if not _prompt_of(b) and not (prefix or context) and section:
            # 只有答案的小題（例：「至少找兩個支持理由」的第 2 條空白橫線）→ 用所在小節標題＋題號
            b = {**b, "prompt": f"{section}（{_txt(b.get('index'))}）" if _txt(b.get("index")) else section}
        if not _prompt_of(b) and (prefix or context):
            # 題幹寫在前面的說明／容器上（例：「學生勾自己常做的三項」的題目只有選項）
            b = {**b, "prompt": _join(*(prefix or []), context, sep="\n\n")}
            if prefix:
                prefix.clear()
            context = None
        try:
            step = _build_step(b, t, option_bank)
        except _Drop as d:
            self.fallback(b, path, t, d.reason)
            return False
        if prefix:
            step["prompt"] = _join(*prefix, step["prompt"], sep="\n\n")
            prefix.clear()
        if section:
            step["section"] = section
        if context:
            step["context"] = context
        self._open()["steps"].append(step)
        self.cov.ok(path, t)
        return True

    # ── top level ────────────────────────────────────────────────────────────
    def walk(self, blocks: list[Any]) -> None:
        for i, b in enumerate(blocks):
            self.visit(b, str(i))
        self.close()
        for t in self.lead:
            self._paragraph(t)
        self.lead = []

    def visit(self, b: Any, path: str) -> None:
        if not isinstance(b, dict):
            self.cov.drop(path, type(b).__name__, "not_a_mapping")
            return
        t = _infer_type(b) or "?"
        if t in _QUESTION_TYPES and b.get("items"):
            t = "sub_block"  # 題目底下還有小題（例：free_text 帶一串 items）= 容器
        handler = getattr(self, f"_v_{t}", None)
        if handler is None:
            self.fallback(b, path, t, "unsupported_type")
            return
        try:
            handler(b, path)
        except _Drop as d:
            self.fallback(b, path, t, d.reason)
            return
        if t not in ("sub_block", "exercise"):  # 容器自己逐項處理
            self.leftovers(b, path, t, frozenset({"steps"}) if t == "figure" else frozenset())

    def _v_passage(self, b: dict[str, Any], path: str) -> None:
        label = _txt(b.get("label"))
        for i, para in enumerate(b.get("paragraphs") or []):
            # 段標（「（段2）」「106年會考國文科第35~36題」）接在第一段前面，不另佔一個段號
            self._paragraph(_join(label, para) if i == 0 else str(para))
        self._paragraph(_txt(b.get("source_line")))
        used = _join(label, *(b.get("paragraphs") or []), b.get("source_line"))
        for t in _extra_visible({k: v for k, v in b.items() if k != "label"}, used):
            self._paragraph(t)
        self.cov.ok(path, "passage")

    def _v_figure(self, b: dict[str, Any], path: str) -> None:
        referent = b.get("referent")
        label_m = _FIGURE_LABEL_RE.search(str(b.get("bind_paragraph") or ""))
        if referent == "table":
            self.n["tbl"] += 1
            bid = f"tbl{self.n['tbl']}"
        else:
            self.n["fig"] += 1
            bid = f"fig{self.n['fig']}"
        caption = _join(b.get("caption"), b.get("label") if not label_m else None) or None
        fig: dict[str, Any] = {"id": bid, "type": "figure", "asset": b.get("asset"), "caption": caption}
        if label_m:
            fig["label"] = label_m.group(1)
        self.blocks.append(fig)
        # 圖裡轉錄出來的教學步驟（legacy `renderFigure` 的 steps 分支）不能跟著圖消失
        steps = [s for s in (b.get("steps") or []) if isinstance(s, dict)]
        if steps:
            self._paragraph("\n".join(_join(s.get("label"), s.get("hint"), sep="：") for s in steps))
        # 圖裡轉錄出來的字（content / transcript / caption）：圖檔不一定存在，字不能跟著消失
        for t in _extra_visible({k: v for k, v in b.items() if k not in ("label",)}, _txt(fig.get("label"))):
            self._paragraph(t)
        self.cov.ok(path, "figure")

    def _v_guide(self, b: dict[str, Any], path: str) -> None:
        if self.group and self.group["steps"]:
            self.close()
        text = _join(b.get("label"), b.get("text"), b.get("hint"))
        text = _join(text, *_extra_visible(b, text))
        if text:
            self.lead.append(text)
        self.cov.ok(path, "guide")

    def _v_note(self, b: dict[str, Any], path: str) -> None:
        self.lead.append(_note_text(b))
        self.cov.ok(path, "note")

    def _v_concept_box(self, b: dict[str, Any], path: str) -> None:
        self.close()
        text = _join(b.get("label"), b.get("text"))
        text = _join(text, *_extra_visible(b, text))
        if text:
            self.lead.append(text)
        self.cov.ok(path, "concept_box")

    def _v_self_check(self, b: dict[str, Any], path: str) -> None:
        """自我檢核 → 一題可複選、沒有標準答案的勾選清單（legacy 畫的也是勾選框）。"""
        self.close()
        items = [(_txt(it) or _prompt_of(it) if isinstance(it, dict) else _txt(it))
                 for it in (b.get("items") or [])]
        items = [it for it in items if it]
        cols = b.get("columns")
        head = _join(b.get("label") or b.get("title") or "自我檢核", b.get("instruction"), b.get("prompt"),
                     "｜".join(_txt(c) for c in cols) if isinstance(cols, list) else None)
        tail = _join(b.get("closing"), b.get("reflection"))
        head = _join(head, *_extra_visible({k: v for k, v in b.items() if k not in ("closing", "reflection")},
                                           _join(head, tail)))
        if len(items) >= 2:
            self._open()["steps"].append({"prompt": head, "type": "multi_select", "options": items,
                                          "answer": None, "no_correct_answer": True})
            self.close()
            if tail:
                self.lead.append(tail)
        else:
            self.lead.append(_join(head, *("☐ " + it for it in items), tail))
        self.cov.ok(path, "self_check")

    def _question(self, b: dict[str, Any], path: str, t: str) -> None:
        if t == "free_text" and _SECTION_HEADER_RE.match(_prompt_of(b)):
            self._v_guide({"text": _prompt_of(b)}, path)
            return
        self._add_step(b, t, path)

    def _v_single(self, b, path):
        self._question(b, path, "single")

    def _v_multi(self, b, path):
        self._question(b, path, "multi")

    def _v_free_text(self, b, path):
        self._question(b, path, "free_text")

    def _v_table(self, b: dict[str, Any], path: str) -> None:
        self.close()
        self._emit_table(b)
        tail = _join(b.get("tail") if isinstance(b.get("tail"), str) else None, b.get("reflection"), b.get("closing"))
        if tail:
            self.lead.append(tail)
        self.cov.ok(path, b.get("type") or "table")

    def _emit_table(self, b: dict[str, Any]) -> None:
        headers, rows = _table_rows(b)
        if not headers and not rows:
            raise _Drop("empty_table")
        self.n["tbl"] += 1
        tbl: dict[str, Any] = {"id": f"tbl{self.n['tbl']}", "type": "table", "placement": "exercise",
                               "headers": headers, "rows": rows}
        if _txt(b.get("label")):
            tbl["label"] = _txt(b.get("label"))
        bank = b.get("options") if isinstance(b.get("options"), dict) else b.get("option_bank")
        bank_line = "　".join(f"{k}. {_txt(v)}" for k, v in bank.items()) if isinstance(bank, dict) else ""
        title = _join(b.get("title"), b.get("instruction"), b.get("prompt"), b.get("sub_instruction"), bank_line)
        title = _join(title, *_extra_visible(
            {k: v for k, v in b.items() if k not in ("label", "tail", "reflection", "closing")}, title))
        if title:
            tbl["title"] = title
        self.blocks.append(tbl)

    def _v_fill_table(self, b: dict[str, Any], path: str) -> None:
        """整張表就地作答（table_exercise）；表裡沒有任何作答位就照畫成一般表格。"""
        self.close()
        if not (b.get("rows") or []) and not (b.get("columns") or []):
            raise _Drop("fill_table_signpost")  # legacy 的「指路牌」形狀（內容在文章重點表那一步）
        lead = _join(*self.lead, sep="\n\n")
        q = build_table_exercise(b, path, self.cov, lead)
        if q is None:
            self._emit_table(b)
        else:
            self.lead = []
            answer = q.pop("_answer")
            self.n["tab"] = self.n.get("tab", 0) + 1
            self.blocks.append({
                "id": f"ex-table-{self.n['tab']}",
                "type": "exercise",
                "question": q,
                "answer_space": "free_text",
                "answer": answer,
                "grader": "rubric_ai",
                "anchors": [],
                "needs_review": False,
            })
        tail = _join(b.get("reflection"), b.get("closing"), b.get("tail") if isinstance(b.get("tail"), str) else None)
        if tail:
            self.lead.append(tail)
        columns = [_txt(c) for c in (b.get("columns") or [])]
        for ri, r in enumerate(b.get("rows") or []):
            if isinstance(r, dict):
                row_extra = {k: v for k, v in r.items() if k not in columns}
                if isinstance(r.get("items"), list):
                    row_extra["row_items"] = r["items"]  # 列裡還包著小題：items 在列上不是走訪器處理的欄位
                self.leftovers(row_extra, f"{path}.rows.{ri}", "row")
        self.cov.ok(path, "fill_table")

    def _v_matching(self, b: dict[str, Any], path: str) -> None:
        self.close()
        if b.get("middle"):
            raise _Drop("matching_three_columns")
        left, right, ans = b.get("left") or {}, b.get("right") or {}, b.get("answer")
        if not isinstance(left, dict) or not isinstance(right, dict) or len(right) < 2:
            raise _Drop("matching_shape")
        if not isinstance(ans, dict):
            raise _Drop("matching_answer_missing")
        options = {rk: f"{rk}. {rv}" for rk, rv in right.items()}
        header = _join(b.get("left_header"), b.get("right_header"), sep=" → ")
        lead = _join(b.get("label"), b.get("instruction"), b.get("sub_instruction"), b.get("prompt"), header)
        self._open(_join(lead, *_extra_visible(b, lead)))
        for lk, lv in left.items():
            self._add_step({"type": "single", "prompt": f"{lk}. {_txt(lv)}", "options": options,
                            "answer": ans.get(lk, ans.get(str(lk)))}, "single", f"{path}.left.{lk}")
        self.close()
        self.cov.ok(path, "matching")

    def _v_ordering(self, b: dict[str, Any], path: str) -> None:
        self.close()
        items = b.get("items") or []
        if not items and isinstance(b.get("options"), dict) and isinstance(b.get("answer"), list):
            # 另一種寫法：選項字典 + 答案是代號的正確順序（例：[1, 3, 2, 4]）
            keys = [str(k) for k in b["options"]]
            order = [str(a) for a in b["answer"]]
            if sorted(order) != sorted(keys):
                raise _Drop("ordering_answer_not_a_permutation")
            items = [{"text": v, "answer": order.index(str(k)) + 1} for k, v in b["options"].items()]
        if not items or not all(isinstance(it, dict) and _txt(it.get("text")) for it in items):
            raise _Drop("ordering_shape")
        pos = [it.get("answer") for it in items]
        if sorted(p for p in pos if isinstance(p, int)) != list(range(1, len(items) + 1)):
            raise _Drop("ordering_answer_not_a_permutation")
        instruction = _join(*self.lead, b.get("label"), b.get("instruction"), b.get("prompt"), sep="\n\n")
        instruction = _join(instruction, *_extra_visible(b, instruction))
        self.lead = []
        self.n["ord"] += 1
        self.blocks.append({
            "id": f"ex-order-{self.n['ord']}",
            "type": "exercise",
            "question": {"kind": "ordering", "instruction": instruction or self.strategy_name,
                         "items": [_txt(it["text"]) for it in items]},
            "answer_space": "order",
            # OrderingInput 的值是「第 k 個位置放原本第幾句」，答案同形
            "answer": sorted(range(len(items)), key=lambda i: pos[i]),
            "grader": "ordered",
            "anchors": [],
            "needs_review": False,
        })
        self.cov.ok(path, "ordering")

    # ── containers ───────────────────────────────────────────────────────────
    def _v_sub_block(self, b: dict[str, Any], path: str) -> None:
        self.close()
        self._container(b, path, section=None)
        self.close()

    def _v_exercise(self, b: dict[str, Any], path: str) -> None:
        if b.get("rows"):
            self._checked_rows(b, path)
            return
        self._v_sub_block(b, path)

    def _checked_rows(self, b: dict[str, Any], path: str) -> None:
        """打勾表格：每列一句，`checked` 是正解（例：哪些句子用了譬喻？在句子前打勾）。
        印好的示範列（`example: true`）當說明，不當選項。"""
        self.close()
        rows = [r for r in b["rows"] if isinstance(r, dict) and _txt(r.get("text"))]
        examples = [r for r in rows if r.get("example")]
        opts = [r for r in rows if not r.get("example")]
        if len(opts) < 2 or any(not isinstance(r.get("checked"), bool) for r in opts):
            raise _Drop("exercise_rows_table")
        lead = _join(b.get("label"), b.get("instruction"), b.get("prompt"),
                     *("例：" + _txt(r["text"]) for r in examples))
        self._open(lead)
        self._add_step({"type": "multi", "prompt": _txt(b.get("prompt")) or _txt(b.get("instruction")) or "請勾選",
                        "options": [_txt(r["text"]) for r in opts],
                        "answers": [i + 1 for i, r in enumerate(opts) if r["checked"]]}, "multi", path)
        self.close()

    def _container(self, b: dict[str, Any], path: str, section: Optional[str]) -> None:
        t = b.get("type") or "sub_block"
        label = _txt(b.get("label"))
        sec = " › ".join(s for s in (section, label) if s) or None
        cols = b.get("columns")
        head = _join(b.get("intro"), b.get("instruction"), b.get("prompt"), b.get("stem"),
                     b.get("quote"), b.get("sub_instruction"),
                     None if _model_answer_value(b) else b.get("value"), b.get("hint"),
                     _join(b.get("left_header"), b.get("right_header"), sep=" → "),
                     "｜".join(_txt(c) for c in cols) if isinstance(cols, list) else None)
        head = _join(head, *_extra_visible(
            {k: v for k, v in b.items() if k not in ("label", "closing", "reflection", "stem", "prompt")
             or (k in ("stem", "prompt") and b.get("options") is None)}, _join(label, head)))
        option_bank = b.get("option_bank")
        if option_bank is not None:
            bank_opts, bank_keys = _opts_as_list(option_bank)
            bank_line = "　".join(f"{k}. {v}" for k, v in zip(bank_keys or [], bank_opts)) or "、".join(bank_opts)
            head = _join(head, bank_line)
        items = b.get("items")
        if isinstance(b.get("table"), dict):
            # 小題底下包著一張表：先把說明當題組說明，再當 fill_table 畫
            self.close()
            self.visit({**b["table"], "type": "fill_table", "label": label,
                        "instruction": _join(head)}, f"{path}.table")
            if not items:
                self.leftovers(b, path, t)
                self.cov.ok(path, t)
                return
            head = ""
        elif b.get("table") is not None:
            raise _Drop("nested_table")
        if not items:
            # 沒有 items 的 sub_block 本身就是一題（帶 options／blanks）或一段說明
            it = _infer_type({k: v for k, v in b.items() if k != "type"})
            if it in _QUESTION_TYPES:
                self._add_step({k: v for k, v in b.items() if k not in ("label", "reflection", "closing")},
                               it, path, section=sec, context=None, prefix=[label] if label else None)
                tail = _join(b.get("reflection"), b.get("closing"))
                if tail:
                    self.lead.append(tail)
                self.leftovers(b, path, t)
                return
            if head or label:
                self.lead.append(_join(label, head))
            self.leftovers(b, path, t)
            self.cov.ok(path, t)
            return

        context_pending = head or None
        prefix: list[str] = []
        emitted = 0
        # 容器寫明「沒有標準答案」（或自己帶旗標）→ 底下每一題都是
        container_nca = _says_no_answer(b)
        for i, it in enumerate(items):
            p = f"{path}.items.{i}"
            if container_nca and isinstance(it, dict) and not it.get("no_correct_answer"):
                it = {**it, "no_correct_answer": True}
            if not isinstance(it, dict):
                txt = _txt(it)
                if txt:
                    prefix.append(txt)
                    self.cov.ok(p, "text")
                else:
                    self.cov.drop(p, type(it).__name__, "not_a_mapping")
                continue
            it_t = _infer_type(it, option_bank) or "?"
            if it_t in _QUESTION_TYPES and it.get("items"):
                it_t = "sub_block"
            simple = it_t in _QUESTION_TYPES or it_t in ("guide", "concept_box", "note", "passage", "self_check")
            if it_t in _QUESTION_TYPES:
                had_context = context_pending
                if self._add_step(it, it_t, p, section=sec, context=context_pending,
                                  prefix=prefix, option_bank=option_bank):
                    context_pending = None
                    emitted += 1
                elif had_context and not _prompt_of(it):
                    context_pending = None  # consumed as the prompt
            elif it_t in ("guide", "concept_box", "note"):
                txt = _note_text(it) if it_t == "note" else _join(it.get("label"), it.get("text"), it.get("hint"))
                txt = _join(txt, *_extra_visible(it, txt))
                if txt:
                    prefix.append(txt)
                self.cov.ok(p, it_t)
            elif it_t in ("sub_block", "exercise"):
                if it.get("rows"):
                    g = self.group
                    self.close()
                    try:
                        self._checked_rows(it, p)
                        self.cov.ok(p, it_t)
                    except _Drop as d:
                        self.fallback(it, p, it_t, d.reason)
                    if g is not None:
                        self._open(g["instruction"] if not g["steps"] else None)
                    continue
                if context_pending:
                    prefix.insert(0, context_pending)
                    context_pending = None
                before = len(self.group["steps"]) if self.group else 0
                nested_prefix = list(prefix)
                prefix.clear()
                self._container_nested(it, p, sec, nested_prefix, option_bank)
                emitted += (len(self.group["steps"]) if self.group else 0) - before
            elif it_t == "passage":
                self._v_passage(it, p)
            elif it_t in ("self_check",):
                items_txt = [_txt(x) for x in (it.get("items") or [])]
                prefix.append(_join("自我檢核", *("☐ " + x for x in items_txt if x)))
                self.cov.ok(p, it_t)
            elif it_t in ("fill_table", "table", "matching", "ordering", "item_table"):
                # 這幾種各自是完整的一塊；插在題組中間就先收掉目前題組，畫完再接著開
                if it_t == "item_table":
                    # 小題底下包著一張表（題幹在小題、表在 `table`）→ 當成 fill_table
                    it = {**it["table"], "type": "fill_table",
                          "label": _join(it.get("label"), it.get("sub_label")),
                          "instruction": _join(it.get("stem"), it.get("prompt"), it.get("instruction"))}
                if context_pending:
                    self.lead.append(context_pending)
                    context_pending = None
                g = self.group
                self.close()
                self.visit(it, p)
                if g is not None:
                    self._open(g["instruction"] if not g["steps"] else None)
            else:
                self.fallback(it, p, it_t, "unsupported_nested_type")
            if simple:
                self.leftovers(it, p, it_t)
        if b.get("options") is not None:
            # 容器自己的那一題（跟著步驟做完再作答），題幹只取 stem/prompt —— 引文、說明已在 context
            own = {k: b.get(k) for k in ("options", "answer", "answers", "no_correct_answer", "answers_printed")}
            own["prompt"] = _txt(b.get("stem")) or _txt(b.get("prompt")) or _txt(b.get("instruction")) or label
            own_t = "multi" if isinstance(own.get("answers", own.get("answer")), list) else "single"
            if self._add_step(own, own_t, f"{path}.self", section=sec, context=context_pending, prefix=prefix):
                context_pending = None
        prefix.extend(t for t in (_txt(b.get("closing")), _txt(b.get("reflection"))) if t)
        self.leftovers(b, path, t)
        leftover = [x for x in ([context_pending] if context_pending else []) + prefix if x]
        if leftover:
            if self.group and self.group["steps"]:
                last = self.group["steps"][-1]
                last["prompt"] = _join(last["prompt"], *leftover, sep="\n\n")
            else:
                self.lead.append(_join(label, *leftover))
        elif emitted == 0 and label:
            self.lead.append(label)
        self.cov.ok(path, t)

    def _container_nested(self, it: dict[str, Any], path: str, section: Optional[str],
                          prefix: list[str], option_bank: Any) -> None:
        merged = dict(it)
        if option_bank is not None and merged.get("option_bank") is None:
            merged["option_bank"] = option_bank
        if prefix:
            merged["intro"] = _join(*prefix, merged.get("intro"), sep="\n\n")
        self._open()
        try:
            self._container(merged, path, section)
        except _Drop as d:
            self.fallback(it, path, it.get("type") or "sub_block", d.reason)


def walk_spotlight(
    spot: dict[str, Any], lesson_code: str, gaps: GapLog, cov: Optional[Coverage] = None
) -> tuple[list[dict[str, Any]], Coverage]:
    """spotlight payload → ordered Lesson block dicts + Coverage (see section header)."""
    cov = cov if cov is not None else Coverage()
    blocks = spot.get("blocks") or []
    if not isinstance(blocks, list):
        raise ValueError("spotlight.blocks is not a list")
    strategy_type = _txt(spot.get("strategy_type"))
    kind = STRATEGY_TYPE_TO_KIND.get(strategy_type)
    if kind is None:
        if strategy_type:
            gaps.add(lesson_code, "strategy_type_unmapped", detail=strategy_type)
        kind = DEFAULT_KIND
    strategy_name = _txt(spot.get("strategy_name")) or "閱讀聚光燈"
    w = _Walker(lesson_code, gaps, cov, kind, strategy_name)
    w.walk(blocks)
    return w.blocks, cov


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


def assemble_lesson(
    spot: dict[str, Any], parsed: dict[str, Any], gaps: GapLog, with_keypoints: bool,
    parsed_source_kind: str = "exact",
    identity: Optional[str] = None,
    lesson_code: Optional[str] = None,
    coverage: Optional[Coverage] = None,
) -> dict[str, Any]:
    """spotlight payload → Lesson dict. Pass ``coverage`` to learn what (if anything)
    could not be carried — the loader refuses to serve a lesson with any drop."""
    lesson_id, lesson_code = resolve_identity(spot, identity, lesson_code)
    all_blocks, _ = walk_spotlight(spot, lesson_code, gaps, coverage)

    presentation = [b for b in all_blocks if b["type"] in ("paragraph", "figure", "table")]
    anchor_ids = [b["id"] for b in presentation]
    for b in all_blocks:
        if b["type"] == "exercise":
            b["anchors"] = [{"block_id": bid} for bid in anchor_ids]
    if not anchor_ids and any(b["type"] == "exercise" for b in all_blocks):
        # 聚光燈裡沒有任何可錨定的呈現 block（課文在別的步驟）是來源形狀，不是缺陷。
        # 只記一筆 gap，**不**設 needs_review —— 那會在前端掛上「此題內容可能與本課不符」。
        gaps.add(lesson_code, "no_anchorable_passage_in_source", "ex-spotlight")

    if with_keypoints:
        # Gap 2: keypoints_table is 『整篇文章重點』, so it anchors to the text spans it
        # summarizes — the PASSAGE (p*) + TABLE (tbl*) presentation blocks. ONLY when the
        # lesson has NO passage/table block at all (a pure 圖文 lesson whose content IS its
        # figures) do we fall back to anchoring the figures.
        passage_table_ids = [
            b["id"] for b in presentation if b["type"] == "paragraph" or b["id"].startswith("tbl")
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
    lesson_code: str, gaps: Optional[GapLog] = None, with_keypoints: bool = False,
    coverage: Optional[Coverage] = None,
) -> tuple[dict[str, Any], GapLog]:
    """Load a lesson from the uid tree and return (lesson_dict, gaps).

    `lesson_code` is a lesson_uid (`L0042`). It used to be a catalogue code read out
    of `spotlight/dev7/` — but a code says where a lesson sits this edition, not which
    lesson it is, and 11 of them were being rewritten by a first-edition offset table.
    """
    gaps = gaps or GapLog()
    vdir = _uid_version_dir(lesson_code)
    # Same rename as _uid_spotlight_path — glob for the slugged file.
    _cands = [vdir / "spotlight.yml", *sorted(vdir.glob("spotlight.*.yml"))]
    spot = load_spotlight(next((p for p in _cands if p.is_file()), vdir / "spotlight.yml"))
    # The keypoints source used to be the `_parsed` twin's raw `story_structure_table`.
    # The uid tree emits keypoints already structured, so convert back to that raw
    # shape and keep ONE keypoints parser rather than teaching the adapter a second.
    parsed: dict[str, Any] = {}
    if with_keypoints:
        from app.services.keypoints_to_structure import keypoints_to_structure_table

        # 同 #2916：模組檔是 `keypoints.{slug}.yml`，只找 `keypoints.yml` 會永遠找不到。
        kp_path = next((p for p in [vdir / "keypoints.yml", *sorted(vdir.glob("keypoints.*.yml"))]
                        if p.is_file()), vdir / "keypoints.yml")
        if kp_path.exists():
            table = keypoints_to_structure_table(
                yaml.safe_load(kp_path.read_text(encoding="utf-8"))
            )
            if table:
                parsed = {"story_structure_table": table}
    lesson_dict = assemble_lesson(
        spot, parsed, gaps, with_keypoints, identity=lesson_code, coverage=coverage
    )
    return lesson_dict, gaps


def _uid_version_dir(uid: str) -> Path:
    """Latest version dir for a uid (the dir itself when it has no versions yet)."""
    d = LESSONS_ROOT / uid
    vdirs = sorted((c for c in d.iterdir() if c.is_dir() and c.name.startswith("v")),
                   key=lambda c: c.name) if d.is_dir() else []
    return vdirs[-1] if vdirs else d


def _uid_spotlight_path(uid: str) -> Path:
    """Latest version's spotlight file for a uid.

    #2916 renamed the module files to ``spotlight.{slug}.yml``. sample_uids()
    below was taught both spellings and carries the warning; this one was not,
    so the enumerator found 172 lessons and the reader then raised
    FileNotFoundError on every one of them. Callers that swallow exceptions saw
    "no lesson has a spotlight" rather than "I looked for the wrong filename" —
    the same disguise #2964 describes, one function further along.

    Returns the un-slugged path when nothing matches, so the caller still gets
    a FileNotFoundError naming a real path rather than a silent None.
    """
    vdir = _uid_version_dir(uid)
    cands = [vdir / "spotlight.yml", *sorted(vdir.glob("spotlight.*.yml"))]
    return next((p for p in cands if p.is_file()), vdir / "spotlight.yml")


def sample_uids(limit: int = 0) -> list[str]:
    """lesson_uids from the tree that actually have spotlight blocks to convert.

    Replaces `dev7_codes()`, which globbed a hand-curated `spotlight/dev7/` fixture
    dir keyed by lesson CODE. Codes move between editions; uids do not, and the tree
    is the real corpus rather than seven files someone copied in. Lessons whose
    extraction produced zero blocks are skipped — they are a registered content gap
    (`data/curriculum_qa/content_known_gaps.yaml`), not adapter behaviour to assert on.
    """
    uids = []
    for d in sorted(LESSONS_ROOT.glob("L[0-9][0-9][0-9][0-9]")):
        vdirs = sorted((c for c in d.iterdir() if c.is_dir() and c.name.startswith("v")),
                       key=lambda c: c.name)
        if not vdirs:
            continue
        # 「沒有聚光燈」有兩種：抽出來 0 個 block，以及**連檔案都沒有**。
        # docstring 上面說的跳過原本只做到第一種 —— 第二種會直接
        # FileNotFoundError，而這支函式在測試模組的 module 層被呼叫，
        # 於是 3529 個測試在 collection 階段一起死（#2751）。
        # L0011 就是這樣：它是 #2781 盤出「真的沒有聚光燈」的 7 課之一。
        # ⚠️ #2916 之後模組檔名是 `spotlight.{slug}.yml` —— 只找 `spotlight.yml`
        #    的話**真實語料一課都取不到**（回空陣列，而空陣列不會拋，
        #    所以看起來像「沒有課有聚光燈」而不是「我找錯檔名」，#2964 抓到）。
        #    兩種都認：舊的無 slug、新的帶 slug。
        cands = [vdirs[-1] / "spotlight.yml", *sorted(vdirs[-1].glob("spotlight.*.yml"))]
        spot_path = next((p for p in cands if p.is_file()), None)
        if spot_path is None:
            continue
        spot = load_spotlight(spot_path)
        if spot.get("blocks"):
            uids.append(d.name)
        if limit and len(uids) >= limit:
            break
    return uids


# ═══════════════════════════════════════════════════════════════════════════
#  CLI (10)
# ═══════════════════════════════════════════════════════════════════════════


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--lesson", action="append", default=[], help="lesson_uid, e.g. L0031 (repeatable)")
    ap.add_argument("--all", action="store_true", help="every lesson_uid with spotlight blocks")
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="output dir for *.lesson.yml")
    ap.add_argument("--with-keypoints", action="store_true", help="emit ex-keypoints (default OFF)")
    ap.add_argument("--gaps-out", default=str(DEFAULT_GAPS_OUT), help="known-gaps YAML (sibling)")
    args = ap.parse_args(argv)

    codes = list(args.lesson)
    if args.all:
        codes = sample_uids()
    if not codes:
        ap.error("no lessons (pass --lesson <lesson_uid> or --all)")

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
