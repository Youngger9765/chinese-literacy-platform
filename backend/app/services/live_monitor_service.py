"""Teacher live classroom monitor — Issue #3025.

Computes, per student in a classroom, "which 大題 are they currently on"
and a 「卡在這題」(stuck-on-this-question) flag, from `mcq_attempt` rows.

Data honesty (read this before touching the thresholds)
---------------------------------------------------------
`mcq_attempt` has no `session_id` and, as of this writing, only 3 of 40+
exercise components write to it (MultipleChoiceExercise, GuidedStepsExercise,
TraitInferenceExercise, plus the newer ExerciseBlockView choice path — see
TRACKED_EXERCISE_TYPES). That means most students doing most exercises will
have NO rows here at all. This module must never let "no rows" collapse into
the same shape as "doing fine" — every result explicitly carries
`has_data=False` for that case, and callers (the API response, the frontend)
must render it as an honest "no data" state, not a green checkmark.

Stuck signal
------------
"Same question answered wrong >= STUCK_WRONG_THRESHOLD times" (issue #3025,
proposal A). Scoped to the student's CURRENT question — i.e. the
(lesson_id, question_id) pair of their most recent attempt. If that most
recent attempt was answered correctly, the student is not stuck even if the
historical wrong-count on that exact question is >= threshold: they solved
it (MCQ components allow re-answering the same question_id after a wrong
choice — see MultipleChoiceExercise's 「再選一次」 flow).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import joinedload

from ..models.mcq_attempt import McqAttempt
from ..models.school import ClassroomStudent

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as DbSession

#: Issue #3025 decision: same question wrong 3+ times => 「卡在這題」.
#: Do not relabel this "亂猜" anywhere it might reach a student's screen —
#: that word assigns a motive; "卡在這題" states the observation only.
STUCK_WRONG_THRESHOLD = 3

#: Disclosed in the API response so the teacher UI can render an honest
#: "here is what this view can actually see" notice, instead of implying
#: full exercise coverage. Keep in sync with the actual call sites of
#: recordMcqAttempt() (frontend/src/services/learning/mcq.ts).
TRACKED_EXERCISE_TYPES = [
    "閱讀理解選擇題",
    "重點導讀．引導題",
    "重點導讀．情意題",
    "分項練習選擇題",
]

_COMPREHENSION_MCQ_RE = re.compile(r"-q(\d+)$")
_SPOTLIGHT_GUIDED_RE = re.compile(r"-spotlight-guided-(\d+)$")


def describe_question_id(question_id: str) -> str:
    """Turn a raw mcq_attempt.question_id into a teacher-readable label.

    Only covers the shapes the tracked components literally build (see
    module docstring). Anything else — e.g. ExerciseBlockView's `exercise.id`,
    an opaque content-schema id — is not guessable, so it falls back to a
    generic label instead of pretending to know what it means. Never
    surfaces the raw internal id to the teacher.
    """
    guided_match = _SPOTLIGHT_GUIDED_RE.search(question_id)
    if guided_match:
        return f"重點導讀．引導題 {int(guided_match.group(1)) + 1}"

    if question_id.endswith("-spotlight-trait"):
        return "重點導讀．情意題"

    mcq_match = _COMPREHENSION_MCQ_RE.search(question_id)
    if mcq_match:
        return f"閱讀理解選擇題 第 {int(mcq_match.group(1)) + 1} 題"

    return "練習題（選擇題）"


@dataclass
class LiveMonitorStudent:
    student_id: int
    student_name: str
    has_data: bool
    lesson_id: str | None
    question_label: str | None
    last_activity_at: datetime | None
    wrong_count: int
    is_stuck: bool


def get_classroom_live_monitor(
    classroom_id: int,
    db: "DbSession",
) -> list[LiveMonitorStudent]:
    """Per-student live monitor snapshot for one classroom.

    Only 2-3 queries regardless of class size:
      1. classroom roster
      2. each student's single most recent mcq_attempt row
      3. wrong-attempt count scoped to each student's own current question
    """
    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    if not enrollments:
        return []

    student_ids = [e.student_id for e in enrollments]

    latest_subq = (
        db.query(
            McqAttempt.user_id.label("user_id"),
            func.max(McqAttempt.created_at).label("max_created_at"),
        )
        .filter(McqAttempt.user_id.in_(student_ids))
        .group_by(McqAttempt.user_id)
        .subquery()
    )
    latest_rows = (
        db.query(McqAttempt)
        .join(
            latest_subq,
            and_(
                McqAttempt.user_id == latest_subq.c.user_id,
                McqAttempt.created_at == latest_subq.c.max_created_at,
            ),
        )
        .all()
    )

    # Tie-break (identical created_at, e.g. clock resolution or fast test
    # fixtures): keep the highest-id row deterministically rather than
    # whatever order the DB happened to return.
    latest_by_student: dict[int, McqAttempt] = {}
    for row in latest_rows:
        existing = latest_by_student.get(row.user_id)
        if existing is None or row.id > existing.id:
            latest_by_student[row.user_id] = row

    wrong_counts: dict[int, int] = {}
    if latest_by_student:
        conditions = [
            and_(
                McqAttempt.user_id == uid,
                McqAttempt.lesson_id == row.lesson_id,
                McqAttempt.question_id == row.question_id,
                McqAttempt.is_correct.is_(False),
            )
            for uid, row in latest_by_student.items()
        ]
        wrong_rows = (
            db.query(McqAttempt.user_id, func.count(McqAttempt.id))
            .filter(or_(*conditions))
            .group_by(McqAttempt.user_id)
            .all()
        )
        wrong_counts = dict(wrong_rows)

    results: list[LiveMonitorStudent] = []
    for enrollment in enrollments:
        student = enrollment.student
        latest = latest_by_student.get(student.id)

        if latest is None:
            results.append(
                LiveMonitorStudent(
                    student_id=student.id,
                    student_name=student.name,
                    has_data=False,
                    lesson_id=None,
                    question_label=None,
                    last_activity_at=None,
                    wrong_count=0,
                    is_stuck=False,
                )
            )
            continue

        wrong_count = wrong_counts.get(student.id, 0)
        is_stuck = (not latest.is_correct) and wrong_count >= STUCK_WRONG_THRESHOLD

        results.append(
            LiveMonitorStudent(
                student_id=student.id,
                student_name=student.name,
                has_data=True,
                lesson_id=latest.lesson_id,
                question_label=describe_question_id(latest.question_id),
                last_activity_at=latest.created_at,
                wrong_count=wrong_count,
                is_stuck=is_stuck,
            )
        )

    return results
