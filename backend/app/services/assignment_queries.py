"""
Assignment query helpers — title / slug resolution utilities.

Extracted from routes/assignments.py (Issue #1771) as a pure-refactor step.
Zero behavior change; all public names are re-exported from the routes file.
"""
from sqlalchemy.orm import Session

from ..models.text import Text
from ..models.assignment import Assignment
from ..services.lesson_loader import get_lesson_by_id
from ..utils.slug import normalize_story_slug


def resolve_story_title_from_yaml(story_id: str) -> str | None:
    """Resolve a YAML story_id (lesson_number) to its title.

    Accepts both numeric strings ("6") and L-prefixed format ("L06").
    """
    try:
        story = get_lesson_by_id(int(normalize_story_slug(story_id)))
        if story:
            return story["title"]
    except (ValueError, TypeError):
        pass
    return None


def resolve_title_for_assignment(assignment: Assignment, db: Session) -> str:
    """Return the display title for an assignment's text source.

    Uses the already-loaded ``assignment.text`` relationship when available
    (e.g. after a ``joinedload(Assignment.text)`` / ``selectinload(Assignment.text)``
    in the calling query) to avoid an extra SELECT per assignment.  Falls back
    to an explicit DB query only when the relationship attribute is absent or
    unloaded — for example when the assignment was fetched without eager-loading.
    """
    if assignment.story_id is not None:
        return resolve_story_title_from_yaml(assignment.story_id) or assignment.story_id
    if assignment.text_id is not None:
        # Prefer the already-loaded relationship (no extra query).
        text_obj = assignment.text  # type: ignore[attr-defined]
        if text_obj is not None:
            return text_obj.title
        # Fallback: relationship not loaded — hit DB once.
        text_row = db.query(Text).filter(Text.id == assignment.text_id).first()
        if text_row:
            return text_row.title
    return "(Unknown)"


def resolve_story_slug_for_assignment(assignment: Assignment) -> str | None:
    """Return the LearningSession story_slug key used for this assignment."""
    if assignment.story_id is not None:
        return assignment.story_id
    if assignment.text_id is not None:
        return str(assignment.text_id)
    return None


def resolve_step_sequence_for_assignment(assignment: Assignment) -> list[str] | None:
    """Return this assignment's lesson's per-lesson step order, if any (Issue #3682).

    `MyAssignments.tsx` used to compute the assignment-card progress count
    ("學習關卡進度 N/M") against the GLOBAL default step sequence
    (`ACTIVE_STEPS` / `resolveActiveSteps()` called with no argument) instead of
    this specific lesson's own `step_sequence`. Round-keyed step ids for
    multi-part lessons (`key-passage-reading#4uee3`, #2916/#2930) never appear
    in the global default list, so `steps_completed` entries using those ids
    never matched — the UI showed "0/11" or "1/11" for a student who had
    actually finished most or all of the real steps.

    Only platform YAML lessons (`assignment.story_id` set) carry this
    per-lesson `step_sequence` metadata (`lesson_indexes._step_sequence_for`).
    DB-authored/forked texts (`assignment.text_id` set) have none, so this
    returns None for those — same as before this field existed, since the
    frontend already falls back to `DEFAULT_STEP_SEQUENCE` when it gets `None`.
    """
    if assignment.story_id is None:
        return None
    try:
        lesson_number = int(normalize_story_slug(assignment.story_id))
    except (ValueError, TypeError):
        return None
    lesson = get_lesson_by_id(lesson_number)
    if not lesson:
        return None
    seq = lesson.get("step_sequence")
    return list(seq) if isinstance(seq, list) else None


# ── Server-side required-step verification (Issue #3695 integrity follow-up) ──
#
# Team-lead review: the auto-submit route (learning_step_progress.save_step_progress)
# originally trusted StepProgressSaveRequest.assignment_ready_for_submit outright —
# any student could send that flag after completing one step and get submitted
# early. The flag is now only a HINT (cheap pre-filter so this isn't recomputed on
# every save); maybe_auto_submit_assignment_session independently verifies
# readiness against the session's own server-stored (already-merged,
# never-shrinks) steps_completed using this module's own notion of the
# assignment's required steps — never the client's.

# Mirrors frontend/src/config/stepConfig.ts filterRequiredAssignmentSteps:
# excludes the two cover/summary steps that are never marked complete by a
# student (lesson-intro has no pass/fail concept; report is the results page
# itself).
_NON_REQUIRED_STEP_IDS = frozenset({"lesson-intro", "report"})

# Server-side mirror of frontend/src/config/stepConfig.ts DEFAULT_STEP_SEQUENCE
# filtered to STEP_REGISTRY's currently-`enabled` steps, with 'lesson-intro'/
# 'report' already excluded — i.e. resolveActiveSteps(undefined) run through
# filterRequiredAssignmentSteps(). Used ONLY when resolve_step_sequence_for_assignment
# returns None (a DB-authored/forked text, or a platform lesson with no
# manifest_sections — #3697) and there is no per-lesson sequence to load.
#
# ⚠️ Keep in sync with the frontend by hand — there is no shared data source for
# this list. Five of DEFAULT_STEP_SEQUENCE's sixteen steps are currently
# disabled in STEP_REGISTRY (paragraph-reading [2026-07-20], three 2026-05-01
# hidden steps, one 2026-03-27 hidden step) and are deliberately NOT in this
# list. Drift here fails SAFE, not unsafe: it would make a legitimate default-sequence
# assignment stop auto-submitting (stays in_progress, teacher sees nothing
# wrong except the status never flips) — it can never let an incomplete
# submission through, since adding a bogus required id only makes this check
# MORE strict, never less.
DEFAULT_REQUIRED_STEP_IDS: list[str] = [
    "full-text-annotate",
    "key-passage-reading",
    "vocab-definition",
    "vocab-application",
    "spotlight",
    "keypoints-table",
    "comprehension",
    "vocab-review",
    "knowledge-station",
]


def compute_required_step_ids_for_assignment(assignment: Assignment) -> list[str]:
    """This assignment's required step ids, computed server-side (never trusting the client).

    Loads the lesson's own `step_sequence` (resolve_step_sequence_for_assignment)
    when available and strips the two non-required cover steps; falls back to
    DEFAULT_REQUIRED_STEP_IDS when the lesson has no custom sequence.
    """
    step_sequence = resolve_step_sequence_for_assignment(assignment)
    if step_sequence:
        return [s for s in step_sequence if s not in _NON_REQUIRED_STEP_IDS]
    return list(DEFAULT_REQUIRED_STEP_IDS)


def is_required_step_satisfied(
    required_id: str,
    completed: set[str],
    all_required_ids: list[str],
) -> bool:
    """Does `completed` satisfy `required_id`? Server-side mirror of
    frontend/src/config/stepConfig.ts stepIdMatchesCompleted (#3682 fix C part 3).

    Exact match always satisfies. Beyond that, a BARE entry in `completed`
    (no `#slug`) satisfies a composite `required_id` (`base#slug`) ONLY WHEN
    this lesson has exactly ONE required step sharing that base id — i.e.
    there is no ambiguity about which round the bare (legacy, or directly-
    API-driven) entry refers to. A genuinely multi-round lesson must not let
    one bare entry silently satisfy every round sharing that base.
    """
    if required_id in completed:
        return True

    hash_idx = required_id.find("#")
    if hash_idx < 0:
        return False  # required_id itself is bare — exact match already checked above
    base = required_id[:hash_idx]
    if base not in completed:
        return False

    same_base_count = sum(
        1
        for rid in all_required_ids
        if (rid[: rid.find("#")] if "#" in rid else rid) == base
    )
    return same_base_count <= 1


def is_assignment_ready_for_submit(
    assignment: Assignment,
    completed_step_ids: list[str] | set[str],
) -> bool:
    """True when every one of this assignment's required steps is satisfied
    by `completed_step_ids` (the session's own server-stored steps_completed —
    callers must pass the merged, post-union value, never a client payload
    directly)."""
    completed = set(completed_step_ids)
    required_ids = compute_required_step_ids_for_assignment(assignment)
    if not required_ids:
        return False
    return all(
        is_required_step_satisfied(rid, completed, required_ids) for rid in required_ids
    )
