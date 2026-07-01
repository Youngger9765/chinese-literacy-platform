"""Block-based Lesson content contract — pydantic mirror.

Part of the 閱讀聚光燈 refactor (SPOTLIGHT_REFACTOR_PLAN.md).
This file implements **Phase 0 (EDD safety net) + Phase 1 (content contract spine)**.

WHY THIS EXISTS
---------------
The current pipeline lost the *answer semantics* at the source (regex DOCX parse +
"blind" Gemini spotlight rebuild). The plan's fix is NOT a smarter prompt — it is a
strict, machine-verifiable contract that AI can only *fill*, never bypass:

    "把『答案語意』鎖進結構化契約（嚴格、可機器驗證），把『呈現方式』交給通用渲染器。"

This module is the SPINE of that contract, shared verbatim (semantically) with the
frontend zod schema at ``frontend/src/schema/lessonContent.ts``. If you change a field
here, change it there too — a drift test (frontend vitest) fails otherwise.

NON-INVASIVE
------------
This is an *additive* schema. It does NOT replace ``backend/app/schemas/story.py`` or
touch ``ingest_curriculum.py`` / existing renderers. Existing lessons keep working; this
contract sits alongside as scaffolding + guardrails for the migration to come (Phase 2+).

THE ANSWER-VERIFIABILITY INVARIANT (plan §2.2 — the most important rule)
------------------------------------------------------------------------
Every ``exercise`` block MUST declare three things, no exceptions:

  * ``answer_space`` — HOW the student answers (choice / multi_choice / text / order / free_text …)
  * ``answer``       — the standard answer, stored MACHINE-COMPARABLE (never prose)
  * ``grader``       — HOW it is judged (exact / set / ordered / rubric_ai …)

The ``custom`` escape hatch is NOT exempt from the answer fields. It must still carry a
verifiable ``answer`` + ``grader``; it is only allowed to set ``needs_review=True`` so it
can be routed to a human review queue.  "漂亮 HTML" never counts as an answer.
"""
from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ═══════════════════════════════════════════════════════════════════════════
#  Shared value objects
# ═══════════════════════════════════════════════════════════════════════════


class AnswerSpace(str, Enum):
    """How a student is expected to answer (作答型態)."""

    CHOICE = "choice"            # single-select from options
    MULTI_CHOICE = "multi_choice"  # multi-select from options (可複選)
    TEXT = "text"                # short constrained text (fill-in-the-blank)
    ORDER = "order"              # arrange items into a sequence
    FREE_TEXT = "free_text"      # open-ended writing (rubric-graded)


class Grader(str, Enum):
    """How the stored answer is compared to the student's response (判分方式)."""

    EXACT = "exact"        # string / index equality
    SET = "set"            # unordered set equality (for multi_choice)
    ORDERED = "ordered"    # exact sequence equality (for order)
    RUBRIC_AI = "rubric_ai"  # AI/teacher rubric scoring (for free_text)
    MANUAL = "manual"      # deferred entirely to a human (escape hatch)


class Anchor(BaseModel):
    """Spotlight anchor: which passage block (and optional char range) an exercise
    points at. This is the錨點 that the current pipeline lost. ``char_start`` /
    ``char_end`` are optional — many exercises anchor a whole block."""

    model_config = ConfigDict(extra="forbid")

    block_id: str = Field(..., description="Stable id of the passage/figure/table block")
    char_start: Optional[int] = Field(default=None, ge=0)
    char_end: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _check_range(self) -> "Anchor":
        if (
            self.char_start is not None
            and self.char_end is not None
            and self.char_end < self.char_start
        ):
            raise ValueError("char_end must be >= char_start")
        return self


# ═══════════════════════════════════════════════════════════════════════════
#  Exercise question-type discriminated union (payloads)
#  Covers the 6 known types + a `custom` escape hatch (plan §4).
#  These are the TYPE-SPECIFIC fields only. The answer-verifiability invariant
#  (answer_space / answer / grader / anchors / needs_review) lives on the
#  wrapping `ExerciseBlock` so it can NEVER be omitted, not even by `custom`.
# ═══════════════════════════════════════════════════════════════════════════


class MultipleChoiceQuestion(BaseModel):
    """⑦ 閱讀理解選擇題 — mirrors MultipleChoiceItem in frontend/src/types.ts."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["multiple_choice"] = "multiple_choice"
    question: str = Field(..., min_length=1)
    options: list[str] = Field(..., min_length=2)
    explanation: Optional[str] = None


class BlankSlot(BaseModel):
    """Gap 3: one addressable blank inside a ``fill_in_blank`` sentence. Optional —
    only used when a sentence has *mixed* per-blank grading (some exact, some set).
    When ``slots`` is absent the block keeps the current implicit str/list answer.

    NOTE: does NOT change the sentence markup — the sentence still uses ``__`` runs;
    slots align to those runs by ORDER (a future renderer's responsibility). This is
    the conservative shape (no ``{{s1}}`` placeholder convention)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)              # e.g. 'b1', order-stable
    answer: Union[str, list[str]]                    # str=單一正解; list[str]=可接受同義集
    grader: Literal["exact", "set"] = "exact"        # per-slot override
    hint: Optional[str] = None

    @model_validator(mode="after")
    def _slot_coherence(self) -> "BlankSlot":
        if self.grader == "set" and not isinstance(self.answer, list):
            raise ValueError("set slot answer must be a list")
        return self


class FillInBlankQuestion(BaseModel):
    """④ 語詞應用 — mirrors FillInBlankItem in frontend/src/types.ts.
    ``vocab_bank`` is the optional letter→word map (e.g. {"A": "疑難雜症"}).

    Gap 3: ``slots`` is optional. Absent → the block-level ``answer`` keeps the current
    shape (``str`` = single exact blank, ``list[str]`` = multi-blank set). Present →
    each slot carries its own ``id`` + ``answer`` + ``grader`` and the block ``answer``
    becomes a ``dict{slot_id: value}`` (machine-comparable)."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["fill_in_blank"] = "fill_in_blank"
    sentence: str = Field(..., min_length=1)         # current: contains '__' runs (markup unchanged)
    vocab_bank: Optional[dict[str, str]] = None
    slots: Optional[list[BlankSlot]] = None          # None => block-level str/list answer

    @model_validator(mode="after")
    def _check_slots(self) -> "FillInBlankQuestion":
        if self.slots is not None:
            ids = [s.id for s in self.slots]
            if len(ids) != len(set(ids)):
                raise ValueError("fill_in_blank slot ids must be unique")
        return self


class OrderingQuestion(BaseModel):
    """排序題 — mirrors StrategyExercise(type='ordering') in frontend/src/types.ts.
    ``items`` are shown shuffled; the correct sequence lives in the wrapping
    block's ``answer`` (a list of item ids/indices)."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["ordering"] = "ordering"
    instruction: str = Field(..., min_length=1)
    items: list[str] = Field(..., min_length=2)


class TraitInferenceQuestion(BaseModel):
    """人物推論 — mirrors StrategyExercise(type='trait_inference').
    Student picks the trait(s) supported by textual clues."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["trait_inference"] = "trait_inference"
    instruction: str = Field(..., min_length=1)
    character: str = Field(..., min_length=1)
    clues: list[str] = Field(default_factory=list)
    trait_options: list[str] = Field(..., min_length=2)


class GuidedStep(BaseModel):
    """One step inside a guided_steps exercise. ``select`` steps carry options and
    are machine-gradable (single-index answer); ``multi_select`` steps carry options
    and a *set* of indices (可複選); ``free_text`` steps are rubric/teacher graded.

    This mirrors the DOMINANT real shape in backend/data/lessons/_parsed_*: the
    閱讀聚光燈 is almost always a `guided_steps` container whose steps alternate
    between `select` (□-marked answer) and `free_text` (open annotation). Gap 1
    adds `multi_select` for the 可複選 steps the current pipeline silently downgrades
    to `free_text`."""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(..., min_length=1)
    type: Literal["select", "multi_select", "free_text"]
    options: Optional[list[str]] = None
    # Machine-comparable answer, shape depends on `type`:
    #   select       → int (0-based option index)
    #   multi_select → list[int] (set semantics: deduped, in-range)
    #   free_text    → None (graded by rubric; reference_answer holds the model answer)
    # A select/multi_select step answer may be None if it could not be recovered —
    # but then `needs_review` on the block MUST be True (enforced in ExerciseBlock).
    answer: Union[int, list[int], None] = Field(default=None)
    # Optional teacher-facing reference answer for free_text steps.
    reference_answer: Optional[str] = None

    @field_validator("answer", mode="before")
    @classmethod
    def _reject_bool_answer(cls, v: object) -> object:
        # bool is an int subclass; pydantic would coerce YAML `answer: true` → 1 in the
        # Union[int, list[int], None] before _check_shape runs. Reject raw bools up-front
        # (scalar and inside a list) so `answer: true` can never masquerade as an index.
        if isinstance(v, bool):
            raise ValueError("step answer must be an index / list of indices, not a bool")
        if isinstance(v, list) and any(isinstance(i, bool) for i in v):
            raise ValueError("step answer must be indices, not bools")
        return v

    @model_validator(mode="after")
    def _check_shape(self) -> "GuidedStep":
        if self.type in ("select", "multi_select"):
            if not self.options or len(self.options) < 2:
                raise ValueError(f"{self.type} step must have >= 2 options")
        if self.type == "select":
            if isinstance(self.answer, list):
                raise ValueError("select step answer must be a single index, not a list")
            # bool is an int subclass — reject YAML `answer: true` / `false`.
            if isinstance(self.answer, bool):
                raise ValueError("select step answer must be a single index, not a bool")
            if isinstance(self.answer, int) and (
                self.answer < 0 or self.answer >= len(self.options)
            ):
                # 0-based option index; a negative index is out of range. The zod mirror
                # rejects it via a field-level `.min(0)`, so this lower bound keeps the two
                # contracts from drifting on the same lesson (e.g. an off-by-one / -1 sentinel).
                raise ValueError("select step answer index out of range")
        if self.type == "multi_select":
            if self.answer is not None:
                if not isinstance(self.answer, list):
                    raise ValueError("multi_select step answer must be a list of indices")
                if len(set(self.answer)) != len(self.answer):
                    raise ValueError("multi_select step answer has duplicate indices")
                if any(
                    (not isinstance(i, int)) or isinstance(i, bool) or i < 0 or i >= len(self.options)
                    for i in self.answer
                ):
                    raise ValueError("multi_select step answer index out of range")
        if self.type == "free_text" and self.answer is not None:
            raise ValueError(
                "free_text step answer must be None (reference_answer holds the model answer)"
            )
        return self


class GuidedStepsQuestion(BaseModel):
    """導引步驟 — mirrors StrategyExercise(type='guided_steps'). The answers live
    per-step (``GuidedStep.answer``), so the wrapping ``ExerciseBlock.answer`` is the
    ordered list of per-step answers (``select`` → int, ``multi_select`` → list[int],
    ``free_text`` → None). The eval harness re-grades each step and cross-checks that
    list against the per-step answers (see ``eval_lesson_content.answer_round_trip``)."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["guided_steps"] = "guided_steps"
    strategy_name: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    steps: list[GuidedStep] = Field(..., min_length=1)


class GraphicTextIntegrationQuestion(BaseModel):
    """圖文整合 — G7-L28/29/30 style. Structurally a guided_steps flow whose steps
    reference figures/tables (bound via the block ``anchors``). Kept as its own
    type so the renderer + eval can treat 圖文 pairing explicitly."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["graphic_text_integration"] = "graphic_text_integration"
    strategy_name: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    steps: list[GuidedStep] = Field(..., min_length=1)


class CustomQuestion(BaseModel):
    """逃生口 (escape hatch). For a genuinely new shape the 6 registered types
    cannot express. It is NOT allowed to skip the answer invariant — the wrapping
    ExerciseBlock still requires answer + grader — and it MUST be flagged
    ``needs_review=True`` so it lands in the human review queue.

    ``render_hint`` is a free-form note for humans / the renderer; it is explicitly
    NOT the source of truth for the answer (plan §2.3: 白板的自由留給呈現，不留給答案)."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["custom"] = "custom"
    prompt: str = Field(..., min_length=1)
    render_hint: Optional[str] = None


# ── Gap 2(b): answer-bearing 重點表 (第 8 型) ─────────────────────────────────
# 1:1 aligned with the parser's extract_keypoints() output:
#   keypoints{structure, columns, rows[{label, sub_rows:[{sub_label,value,blanks}]}], title?}
# + parse_blanks() {answer, hint}. Unlike a TableBlock (presentation), this CARRIES the
# answer invariant, so it is a question kind wrapped by ExerciseBlock, not a block.


class KeypointBlank(BaseModel):
    """A single 【...】 fill in a keypoints table. Mirrors parse_blanks {answer, hint}.

    Two modes:
      * FREE FILL (``options`` absent): the student writes the 【...】 fill; ``answer`` is
        that fill (the current, dominant shape).
      * □-CHOICE (``options`` present): the cell offered □-marked choices and the student
        ticks one, e.g. G7-L2 story_structure "學生有 充足 □少量 的課後時間" where 充足 is
        correct and 少量 is a distractor. Without this, keypoints_table silently drops the
        distractor and the fact it is a pick (not a free fill), so the exercise could not
        be faithfully reconstructed or re-graded as the original single-choice. ``options``
        holds ALL offered choices (correct + distractors) and ``answer`` MUST be one of them."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)      # stable slot id, e.g. 'r2.b1'
    answer: str = Field(..., min_length=1)  # the 【...】 fill, or (choice mode) the correct option
    hint: Optional[str] = None
    # □-choice mode: the choices offered in the cell (correct + distractors). When present
    # this blank is a single-choice pick, not a free fill; `answer` must be one of them.
    options: Optional[list[str]] = Field(default=None, min_length=2)

    @model_validator(mode="after")
    def _check_choice(self) -> "KeypointBlank":
        if self.options is not None and self.answer not in self.options:
            raise ValueError(
                f"keypoints_table blank '{self.id}' is a □-choice but its answer "
                f"'{self.answer}' is not among options {self.options}"
            )
        return self


class KeypointRow(BaseModel):
    """One row of a keypoints table. ``blank_ids`` point into the block ``blanks`` list
    (order-stable), so the answer stays a flat, machine-comparable dict."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(..., min_length=1)
    sub_label: Optional[str] = None         # nested 3-col: col1
    hint: Optional[str] = None              # hint_value mode
    paragraph: Optional[str] = None         # locate_paragraph mode N.M
    template: Optional[str] = None          # remove_blanks-ed template
    blank_ids: list[str] = Field(default_factory=list)  # → blanks[].id, order-stable


class KeypointsTableQuestion(BaseModel):
    """⑧ 重點表 (答案承載型) — the 文章重點表 that a flat TableBlock cannot express.
    The wrapping ExerciseBlock uses answer_space=text, answer={blank_id: fill} (dict,
    machine-comparable), grader=exact."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["keypoints_table"] = "keypoints_table"
    structure: Literal["flat", "nested", "hint_value", "locate_paragraph"]  # parser-aligned
    title: Optional[str] = None
    rows: list[KeypointRow] = Field(..., min_length=1)
    blanks: list[KeypointBlank] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _check_blank_refs(self) -> "KeypointsTableQuestion":
        ids = [b.id for b in self.blanks]
        if len(ids) != len(set(ids)):
            raise ValueError("keypoints_table blank ids must be unique")
        known = set(ids)
        for r in self.rows:
            for bid in r.blank_ids:
                if bid not in known:
                    raise ValueError(
                        f"keypoints_table row references unknown blank id '{bid}'"
                    )
        return self


Question = Annotated[
    Union[
        MultipleChoiceQuestion,
        FillInBlankQuestion,
        OrderingQuestion,
        TraitInferenceQuestion,
        GuidedStepsQuestion,
        GraphicTextIntegrationQuestion,
        KeypointsTableQuestion,
        CustomQuestion,
    ],
    Field(discriminator="kind"),
]


# ═══════════════════════════════════════════════════════════════════════════
#  Block discriminated union
# ═══════════════════════════════════════════════════════════════════════════


class ParagraphBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    type: Literal["paragraph"] = "paragraph"
    text: str = Field(..., min_length=1)


class FigureBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    type: Literal["figure"] = "figure"
    # Human label baked into / referenced by the worksheet, e.g. "圖一".
    label: Optional[str] = None
    caption: Optional[str] = None
    # Asset path/URL; may be None for a table-as-figure or a not-yet-bound asset.
    asset: Optional[str] = None


class TableCell(BaseModel):
    """Gap 2(a): one cell in a merged-cell ``grid`` overlay. Aligns with the parser's
    cell_grid() (span, vmerge) output."""

    model_config = ConfigDict(extra="forbid")

    text: str = ""
    colspan: int = Field(default=1, ge=1)        # parser gridSpan
    rowspan: int = Field(default=1, ge=1)        # parser vmerge (連續段)
    is_section_label: bool = False               # e.g. G7-L30 相同處/相異處 跨列區段標籤


class TableBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    type: Literal["table"] = "table"
    label: Optional[str] = None
    title: Optional[str] = None
    headers: list[str] = Field(default_factory=list)
    # Simple/default shape (fast path). `rows` cells align to `headers`; the vmerged
    # section-label COLUMN (below) is layered on top so `rows` stays pure cell data.
    rows: list[list[str]] = Field(default_factory=list)
    # Gap 2(a): vmerged section-label COLUMN (the dominant real shape — G7-L30 表一 has a
    # `異同` column that vmerges 相同處/相異處 across many rows; G7-L2 story_structure vmerges
    # 澳洲全民重視體育 / 運動選手生涯). This is a *column* of section labels, NOT a horizontal
    # band. `section_label_col` is that column's header (e.g. '異同'); `row_sections` gives
    # each `rows` entry its section membership (order-aligned to `rows`). Repeats mark the
    # vmerge span (consecutive equal labels = one merged cell). Kept off `rows` so the fast
    # path (cells aligned to `headers`) is undisturbed. See `grid` for the physical overlay.
    section_label_col: Optional[str] = None
    row_sections: Optional[list[str]] = None
    # Gap 2(a): optional merged-cell overlay — present ONLY when there are merged cells.
    grid: Optional[list[list["TableCell"]]] = None
    notes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_grid(self) -> "TableBlock":
        # (1) vmerged section-label column coherence.
        if self.row_sections is not None:
            if self.section_label_col is None:
                raise ValueError(
                    f"table '{self.id}' has row_sections but no section_label_col "
                    "(name the vmerged section column, e.g. '異同')"
                )
            if self.rows and len(self.row_sections) != len(self.rows):
                raise ValueError(
                    f"table '{self.id}' row_sections length {len(self.row_sections)} "
                    f"!= rows length {len(self.rows)} (one section label per row)"
                )

        # (2) merged-cell grid width — ROWSPAN-AWARE. A cell with rowspan=k occupies its
        # column(s) for k rows, so the rows it spans carry FEWER physical cells (this is
        # exactly how a vmerged section-label column emits: the origin row carries the
        # section cell, subsequent spanned rows omit it). We track, per column, how many
        # more rows it is still occupied by a vmerge from above; each row must then supply
        # exactly `headers_width - occupied` cells (measured in colspan). The old validator
        # ignored rowspan and rejected faithful vmerge grids — see plan §2.3.
        if self.grid is not None and self.headers:
            # The vmerged section-label column (when present) is an EXTRA leftmost column
            # in the physical grid, on top of the `headers` data columns — so the grid is
            # one column wider than `headers`. `rows` stay aligned to `headers`; only the
            # `grid` overlay carries the section column.
            ncols = len(self.headers) + (1 if self.section_label_col else 0)
            carried = [0] * ncols  # rows each column is still occupied by a vmerge above
            for ri, row in enumerate(self.grid):
                occupied = sum(1 for c in carried if c > 0)
                supplied = sum(c.colspan for c in row)
                if supplied != ncols - occupied:
                    raise ValueError(
                        f"table '{self.id}' grid row {ri} width {supplied} != expected "
                        f"{ncols - occupied} (headers {ncols}, {occupied} column(s) still "
                        "spanned by a rowspan from above)"
                    )
                # advance one row: expire one step of every carried span
                carried = [max(0, c - 1) for c in carried]
                # lay this row's cells into the columns not currently spanned
                col = 0
                for cell in row:
                    while col < ncols and carried[col] > 0:
                        col += 1  # skip columns still occupied from above
                    if cell.rowspan > 1:
                        for k in range(cell.colspan):
                            if col + k < ncols:
                                carried[col + k] = cell.rowspan - 1
                    col += cell.colspan
        return self


class ParallelRow(BaseModel):
    """Gap 5: one aligned pair in a 雙欄對照表 (白話↔文言 / 原文↔翻譯)."""

    model_config = ConfigDict(extra="forbid")

    left: str = Field(..., min_length=1)     # e.g. 文言
    right: str = Field(..., min_length=1)    # e.g. 白話
    note: Optional[str] = None


class ParallelPassageBlock(BaseModel):
    """Gap 5: 雙欄對照『呈現』block (NOT an exercise, no answer). 文言/白話、原文/翻譯
    share it. Judging is delegated to a companion fill_in_blank exercise anchored here —
    presentation/judging separation (plan §2.3: 白板的自由留給呈現，不留給答案)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    type: Literal["parallel_passage"] = "parallel_passage"
    left_label: str = Field(default="白話", min_length=1)
    right_label: str = Field(default="文言", min_length=1)
    title: Optional[str] = None
    rows: list[ParallelRow] = Field(..., min_length=1)
    notes: list[str] = Field(default_factory=list)


class ExerciseBlock(BaseModel):
    """A single exercise. THIS is where the answer-verifiability invariant lives so
    it can never be bypassed — not by any question type, not even by ``custom``."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    type: Literal["exercise"] = "exercise"
    question: Question

    # ── The invariant (plan §2.2) ──────────────────────────────────────────
    answer_space: AnswerSpace
    # Machine-comparable answer. Shape depends on answer_space:
    #   choice        → int (option index) | str
    #   multi_choice  → list[int] | list[str]
    #   text          → str | list[str] (per-blank)
    #   order         → list[int] | list[str]
    #   free_text     → str (reference answer / rubric anchor)
    #   guided_steps  → list (per-step answers; None entries allowed only w/ needs_review)
    answer: Union[int, str, float, bool, list, dict, None] = Field(
        ...,
        description="Machine-comparable standard answer. Never prose-only.",
    )
    grader: Grader

    # Spotlight anchors — which passage block(s)/char-range this exercise lights up.
    anchors: list[Anchor] = Field(default_factory=list)

    # Human-review flag. MUST be True for `custom`, or whenever `answer` is null.
    needs_review: bool = False

    @model_validator(mode="after")
    def _enforce_answer_invariant(self) -> "ExerciseBlock":
        kind = self.question.kind

        # `custom` escape hatch is never exempt — it must be routed to review.
        if kind == "custom" and not self.needs_review:
            raise ValueError(
                "custom exercise must set needs_review=True (escape hatch is not "
                "exempt from human review)"
            )

        # A null/empty answer is only tolerated if explicitly flagged for review.
        answer_missing = self.answer is None or (
            isinstance(self.answer, (list, dict, str)) and len(self.answer) == 0
        )
        if answer_missing and not self.needs_review:
            raise ValueError(
                f"exercise '{self.id}' has no machine-comparable answer; either "
                "provide `answer` or set needs_review=True (a pretty HTML answer "
                "does not count — see plan §2.2)"
            )

        # answer_space ↔ grader coherence (soft coupling, catches obvious mismatches).
        space_to_graders = {
            AnswerSpace.CHOICE: {Grader.EXACT, Grader.MANUAL},
            AnswerSpace.MULTI_CHOICE: {Grader.SET, Grader.MANUAL},
            AnswerSpace.TEXT: {Grader.EXACT, Grader.SET, Grader.RUBRIC_AI, Grader.MANUAL},
            AnswerSpace.ORDER: {Grader.ORDERED, Grader.MANUAL},
            AnswerSpace.FREE_TEXT: {Grader.RUBRIC_AI, Grader.MANUAL},
        }
        allowed = space_to_graders.get(self.answer_space, set())
        if allowed and self.grader not in allowed:
            raise ValueError(
                f"exercise '{self.id}': grader '{self.grader.value}' is not valid for "
                f"answer_space '{self.answer_space.value}' (allowed: "
                f"{sorted(g.value for g in allowed)})"
            )
        return self


Block = Annotated[
    Union[ParagraphBlock, FigureBlock, TableBlock, ParallelPassageBlock, ExerciseBlock],
    Field(discriminator="type"),
]


# ═══════════════════════════════════════════════════════════════════════════
#  Lesson root
# ═══════════════════════════════════════════════════════════════════════════


class Lesson(BaseModel):
    """A block-based Lesson (plan §4). ``blocks`` is an ordered, typed sequence;
    the "一般 vs 圖文" distinction degrades into block *ordering*, not two layouts."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    lesson_code: str = Field(..., min_length=1, description="e.g. 'G7-L30'")
    title: Optional[str] = None
    blocks: list[Block] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _check_ids_and_anchors(self) -> "Lesson":
        # Block ids must be unique and stable.
        ids = [b.id for b in self.blocks]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate block ids: {sorted(dupes)}")

        # Every exercise anchor must point at an existing NON-exercise block.
        anchorable = {
            b.id
            for b in self.blocks
            if b.type in ("paragraph", "figure", "table", "parallel_passage")
        }
        for b in self.blocks:
            if b.type != "exercise":
                continue
            for a in b.anchors:
                if a.block_id not in anchorable:
                    raise ValueError(
                        f"exercise '{b.id}' anchors unknown block '{a.block_id}'"
                    )
        return self


__all__ = [
    "AnswerSpace",
    "Grader",
    "Anchor",
    "MultipleChoiceQuestion",
    "BlankSlot",
    "FillInBlankQuestion",
    "OrderingQuestion",
    "TraitInferenceQuestion",
    "GuidedStep",
    "GuidedStepsQuestion",
    "GraphicTextIntegrationQuestion",
    "KeypointBlank",
    "KeypointRow",
    "KeypointsTableQuestion",
    "CustomQuestion",
    "Question",
    "ParagraphBlock",
    "FigureBlock",
    "TableCell",
    "TableBlock",
    "ParallelRow",
    "ParallelPassageBlock",
    "ExerciseBlock",
    "Block",
    "Lesson",
]
