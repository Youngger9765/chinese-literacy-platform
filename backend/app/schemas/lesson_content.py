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

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class FillInBlankQuestion(BaseModel):
    """④ 語詞應用 — mirrors FillInBlankItem in frontend/src/types.ts.
    ``vocab_bank`` is the optional letter→word map (e.g. {"A": "疑難雜症"})."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["fill_in_blank"] = "fill_in_blank"
    sentence: str = Field(..., min_length=1)
    vocab_bank: Optional[dict[str, str]] = None


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
    are machine-gradable; ``free_text`` steps are rubric/teacher graded.

    This mirrors the DOMINANT real shape in backend/data/lessons/_parsed_*: the
    閱讀聚光燈 is almost always a `guided_steps` container whose steps alternate
    between `select` (□-marked answer) and `free_text` (open annotation)."""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(..., min_length=1)
    type: Literal["select", "free_text"]
    options: Optional[list[str]] = None
    # Machine-comparable answer for `select` steps: 0-based option index.
    # None for free_text steps (graded by rubric); may also be None for a select
    # step whose answer could not be recovered — but then `needs_review` on the
    # block MUST be True (enforced in ExerciseBlock validator).
    answer: Optional[int] = Field(default=None, ge=0)
    # Optional teacher-facing reference answer for free_text steps.
    reference_answer: Optional[str] = None

    @model_validator(mode="after")
    def _check_shape(self) -> "GuidedStep":
        if self.type == "select":
            if not self.options or len(self.options) < 2:
                raise ValueError("select step must have >= 2 options")
            if self.answer is not None and self.answer >= len(self.options):
                raise ValueError("select step answer index out of range")
        return self


class GuidedStepsQuestion(BaseModel):
    """導引步驟 — mirrors StrategyExercise(type='guided_steps'). The answers live
    per-step (``GuidedStep.answer``), so the block-level ``answer`` is the list of
    per-step answers assembled by :meth:`ExerciseBlock.assembled_answer`."""

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


Question = Annotated[
    Union[
        MultipleChoiceQuestion,
        FillInBlankQuestion,
        OrderingQuestion,
        TraitInferenceQuestion,
        GuidedStepsQuestion,
        GraphicTextIntegrationQuestion,
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


class TableBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    type: Literal["table"] = "table"
    label: Optional[str] = None
    title: Optional[str] = None
    headers: list[str] = Field(default_factory=list)
    # Each row is a list of cell strings; kept deliberately simple (no merge model
    # yet — see README "schema gaps").
    rows: list[list[str]] = Field(default_factory=list)
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
    Union[ParagraphBlock, FigureBlock, TableBlock, ExerciseBlock],
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
            b.id for b in self.blocks if b.type in ("paragraph", "figure", "table")
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
    "FillInBlankQuestion",
    "OrderingQuestion",
    "TraitInferenceQuestion",
    "GuidedStep",
    "GuidedStepsQuestion",
    "GraphicTextIntegrationQuestion",
    "CustomQuestion",
    "Question",
    "ParagraphBlock",
    "FigureBlock",
    "TableBlock",
    "ExerciseBlock",
    "Block",
    "Lesson",
]
