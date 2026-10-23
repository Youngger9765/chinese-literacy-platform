"""PK queue + invite matchmaking — PRD §9.

The ``FOR UPDATE SKIP LOCKED`` query here is the multi-Cloud-Run-instance
safety mechanism PRD §9.1 calls for (CTO review #2's regression lock: "兩個
學生以極短時間差同時呼叫輪詢，只能產生一場 pk_matches"). Invite rows
(``invite_code IS NOT NULL``) are deliberately EXCLUDED from this generic
scan — PRD §2 describes an invite as "約好的那一位", not open matchmaking;
it is only ever consumed by ``redeem_invite`` matching the exact code.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models.pk import (
    BAND_WIDTH_TIGHT,
    BAND_WIDTH_WIDEN_AFTER_SECONDS,
    INVITE_LIFETIME_MINUTES,
    PkMatch,
    PkQueue,
    PkRating,
    SUGGEST_AI_AFTER_SECONDS,
)
from ...models.school import ClassroomStudent
from ...models.user import User
from . import engine as pk_engine

_INVITE_CODE_LENGTH = 6
# Excludes 0/O and 1/I — PRD doesn't mandate a charset, this is a defensible
# small UX improvement (same "avoid confusable glyphs" motivation live_quiz's
# codes.py documents for its own code alphabet) that keeps a student-to-
# student invite code visually distinct from a classroom join code.
_INVITE_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_MAX_RETRIES = 10

# Resource-exhaustion guard (same spirit as team_arena's
# MAX_OPEN_HOSTED_ROOMS — the security review that flagged team_arena's
# missing per-host limit didn't name PK explicitly, but the shape is
# identical: nothing stops a student calling POST /queue or POST /invite
# forever). A plain queue entry and an invite are the same underlying row
# (`invite_code` just distinguishes them) and the same resource being
# piled up, so one shared cap covers both entry points. 3 lets a student
# have a couple of genuine concurrent attempts (an invite for a specific
# friend AND open matchmaking at the same time, say) without letting one
# account accumulate unbounded "waiting" rows.
MAX_OPEN_QUEUE_ENTRIES = 3


def _count_open_queue_entries(db: Session, student_id: int, *, now: datetime | None = None) -> int:
    """How many of `student_id`'s own "waiting" rows count against
    MAX_OPEN_QUEUE_ENTRIES. An invite stops counting once it's past its
    OWN `invite_expires_at` (this module is lazy/no-cron — see module
    docstring — so a stale invite just hasn't been touched by a redeem
    attempt yet, it isn't actually "open" anymore). A plain queue entry
    (no invite_code, no fixed expiry of its own) stops counting once it's
    sat this long with no opponent, reusing the same INVITE_LIFETIME_MINUTES
    window rather than inventing a second magic number.
    """
    now = now or _now()
    cutoff = now - timedelta(minutes=INVITE_LIFETIME_MINUTES)
    rows = (
        db.query(PkQueue)
        .filter(PkQueue.student_id == student_id, PkQueue.status == "waiting")
        .all()
    )
    count = 0
    for row in rows:
        if row.invite_code is not None:
            expires = _aware(row.invite_expires_at)
            if expires is not None and now > expires:
                continue  # abandoned invite, nobody redeemed it in time
        elif _aware(row.created_at) < cutoff:
            continue  # abandoned plain queue entry, no opponent showed up
        count += 1
    return count


def _enforce_open_queue_cap(db: Session, student_id: int) -> None:
    if _count_open_queue_entries(db, student_id) >= MAX_OPEN_QUEUE_ENTRIES:
        raise HTTPException(
            status_code=429,
            detail=f"你同時開著的配對／邀請已經達到上限（最多 {MAX_OPEN_QUEUE_ENTRIES} 個），"
            "請先取消其中一個，或等它自然過期後再開新的",
        )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _generate_invite_code(db: Session) -> str:
    for _ in range(_MAX_RETRIES):
        code = "".join(secrets.choice(_INVITE_CODE_CHARS) for _ in range(_INVITE_CODE_LENGTH))
        clash = (
            db.query(PkQueue.id)
            .filter(PkQueue.invite_code == code, PkQueue.status == "waiting")
            .first()
        )
        if clash is None:
            return code
    raise RuntimeError("Failed to generate a unique PK invite code after multiple retries")


def _require_membership(db: Session, classroom_id: int, student_id: int) -> None:
    pk_engine.require_classroom_membership(db, classroom_id, student_id)


# ---------------------------------------------------------------------------
# Creating queue entries
# ---------------------------------------------------------------------------

def create_queue_entry(
    db: Session, student: User, *, scope_type: str, scope_ref: str, classroom_id: int | None = None
) -> PkQueue:
    """PRD §2/§9: 找同學 PK (classmate matchmaking) only ever matches within
    the SAME classroom (see attempt_match's `PkQueue.classroom_id ==
    my_queue.classroom_id` filter), and PRD §7.4 (2026-10-16) gates it
    per-classroom, default OFF — so unlike挑戰文學家, a classroom_id is
    REQUIRED here, not merely validated when present."""
    if classroom_id is None:
        raise HTTPException(status_code=422, detail="classroom_id is required to find a classmate to PK")
    pk_engine.validate_scope(scope_type, scope_ref)
    _require_membership(db, classroom_id, student.id)
    pk_engine.require_pk_human_enabled(db, classroom_id)
    _enforce_open_queue_cap(db, student.id)
    q = PkQueue(
        student_id=student.id,
        classroom_id=classroom_id,
        scope_type=scope_type,
        scope_ref=scope_ref,
        status="waiting",
        version=1,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


def create_invite(
    db: Session, student: User, *, scope_type: str, scope_ref: str, classroom_id: int
) -> PkQueue:
    """PRD §2: invites are same-class only, so unlike the generic queue a
    classroom_id is REQUIRED here (not just optionally validated)."""
    if not classroom_id:
        raise HTTPException(status_code=422, detail="classroom_id is required to create an invite")
    pk_engine.validate_scope(scope_type, scope_ref)
    _require_membership(db, classroom_id, student.id)
    pk_engine.require_pk_human_enabled(db, classroom_id)
    _enforce_open_queue_cap(db, student.id)
    now = _now()
    code = _generate_invite_code(db)
    q = PkQueue(
        student_id=student.id,
        classroom_id=classroom_id,
        scope_type=scope_type,
        scope_ref=scope_ref,
        invite_code=code,
        invite_expires_at=now + timedelta(minutes=INVITE_LIFETIME_MINUTES),
        status="waiting",
        version=1,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def _band_width_for(created_at: datetime, *, now: datetime | None = None) -> int | None:
    """PRD §9.1: 0-5s tight (±150), 5s+ unlimited (None)."""
    now = now or _now()
    waited = (now - _aware(created_at)).total_seconds()
    return BAND_WIDTH_TIGHT if waited < BAND_WIDTH_WIDEN_AFTER_SECONDS else None


def attempt_match(db: Session, my_queue: PkQueue) -> PkMatch | None:
    """Called on every poll of a plain (non-invite) waiting row. Returns the
    newly created PkMatch, or None if nothing was found / the row is no
    longer eligible to try (already matched/cancelled/expired, or is itself
    an invite row).

    Code review finding (2026-10-16): the original version locked only the
    CANDIDATE row it searched for, never ``my_queue`` (the caller's own
    row). Two genuinely concurrent calls for the SAME queue_id (duplicate
    network retry, a double tab, a second device) could each read
    ``my_queue.status == "waiting"`` as true from their own in-memory copy,
    each independently find a DIFFERENT candidate via the SKIP LOCKED scan
    below (SKIP LOCKED only protects the row it's applied to, not this
    one), and each commit a real PkMatch — producing two live matches for
    the same student, with one opponent left waiting forever for a match
    that already moved on without them.

    Fix: lock ``my_queue`` itself with the exact same FOR UPDATE SKIP
    LOCKED + fresh re-read every candidate row already gets, before doing
    anything else. A second concurrent call then either can't acquire the
    lock (SKIP LOCKED -> no row -> abort) or acquires it but sees the
    now-committed status is no longer "waiting" (abort) — never both
    racing to the same candidate-search-and-commit path.
    """
    locked_mine = (
        db.query(PkQueue)
        .filter(PkQueue.id == my_queue.id)
        .with_for_update(skip_locked=True, of=PkQueue)
        .first()
    )
    if locked_mine is None or locked_mine.status != "waiting" or locked_mine.invite_code is not None:
        return None
    my_queue = locked_mine

    my_rating = pk_engine.get_or_create_rating(db, my_queue.student_id)
    band = _band_width_for(my_queue.created_at)

    q = (
        db.query(PkQueue)
        .outerjoin(PkRating, PkRating.student_id == PkQueue.student_id)
        .filter(
            PkQueue.status == "waiting",
            PkQueue.invite_code.is_(None),
            PkQueue.scope_type == my_queue.scope_type,
            PkQueue.scope_ref == my_queue.scope_ref,
            PkQueue.classroom_id == my_queue.classroom_id,
            PkQueue.id != my_queue.id,
        )
    )
    if band is not None:
        q = q.filter(func.abs(func.coalesce(PkRating.rating, 1000) - my_rating.rating) <= band)

    # PRD §9.1: Postgres's standard "pick one from a queue, let someone else
    # skip it if it's already locked" pattern — on SQLite (tests) this is a
    # harmless no-op (SQLite has no row-level FOR UPDATE), which is fine:
    # SQLite's single-writer model already serializes the two commits below,
    # so the "only one match gets created" property the regression lock
    # checks holds there too, just via a different mechanism.
    candidate = (
        q.order_by(PkQueue.created_at)
        .with_for_update(skip_locked=True, of=PkQueue)
        .first()
    )
    if candidate is None:
        return None

    side_a_student = db.query(User).filter(User.id == candidate.student_id).first()
    side_b_student = db.query(User).filter(User.id == my_queue.student_id).first()
    match = pk_engine.create_human_match(
        db,
        side_a_student,
        side_b_student,
        scope_type=my_queue.scope_type,
        scope_ref=my_queue.scope_ref,
        classroom_id=my_queue.classroom_id,
    )

    candidate.status = "matched"
    candidate.match_id = match.id
    candidate.version += 1
    my_queue.status = "matched"
    my_queue.match_id = match.id
    my_queue.version += 1
    db.commit()
    db.refresh(my_queue)
    return match


def redeem_invite(db: Session, student: User, invite_code: str) -> tuple[PkQueue, PkMatch]:
    """PRD §9.1 "邀請碼路徑". Returns the REDEEMER's own queue row (created
    here, already status="matched") plus the new match — see module
    docstring in models/pk.py for why the redeemer gets a queue row too
    (API uniformity: every /api/pk/queue call returns a queue_id)."""
    now = _now()
    invite = (
        db.query(PkQueue)
        .filter(PkQueue.invite_code == invite_code, PkQueue.status == "waiting")
        .with_for_update(skip_locked=True, of=PkQueue)
        .first()
    )
    if invite is None:
        raise HTTPException(status_code=404, detail="這組邀請碼已過期")
    if _aware(invite.invite_expires_at) is not None and now > _aware(invite.invite_expires_at):
        invite.status = "expired"
        invite.version += 1
        db.commit()
        raise HTTPException(status_code=404, detail="這組邀請碼已過期")
    if invite.student_id == student.id:
        raise HTTPException(status_code=400, detail="不能兌換自己的邀請碼")
    if invite.classroom_id is not None:
        _require_membership(db, invite.classroom_id, student.id)
        # PRD §7.4: re-checked at REDEMPTION time too, not just at invite
        # creation — a teacher flipping 真人 PK off between the invite
        # being created and redeemed must block the redemption.
        pk_engine.require_pk_human_enabled(db, invite.classroom_id)

    side_a_student = db.query(User).filter(User.id == invite.student_id).first()
    match = pk_engine.create_human_match(
        db,
        side_a_student,
        student,
        scope_type=invite.scope_type,
        scope_ref=invite.scope_ref,
        classroom_id=invite.classroom_id,
    )

    invite.status = "matched"
    invite.match_id = match.id
    invite.version += 1

    redeemer_queue = PkQueue(
        student_id=student.id,
        classroom_id=invite.classroom_id,
        scope_type=invite.scope_type,
        scope_ref=invite.scope_ref,
        status="matched",
        match_id=match.id,
        version=1,
    )
    db.add(redeemer_queue)
    db.commit()
    db.refresh(redeemer_queue)
    return redeemer_queue, match


def cancel_queue(db: Session, q: PkQueue) -> None:
    if q.status != "waiting":
        return  # idempotent no-op on an already-matched/expired/cancelled row
    q.status = "cancelled"
    q.version += 1
    db.commit()


def is_authenticated_queue_owner(db: Session, queue_id: int, user_id: int) -> bool:
    """Cheap, read-only check for the rate-limit exemption (same shape as
    live_quiz.engine.is_authenticated_member_by_code / pk.engine.
    is_authenticated_match_participant). No side effects on purpose."""
    return (
        db.query(PkQueue.id)
        .filter(PkQueue.id == queue_id, PkQueue.student_id == user_id)
        .first()
        is not None
    )


def get_queue_for_user(db: Session, queue_id: int, user: User) -> PkQueue:
    """authz: a queue row's id is caller-supplied (path param) — binding it
    to the caller is mandatory (anyone logged in could otherwise poll or
    cancel a stranger's matchmaking slot)."""
    q = db.query(PkQueue).filter(PkQueue.id == queue_id).first()
    if q is None:
        raise HTTPException(status_code=404, detail="Queue entry not found")
    if q.student_id != user.id:
        raise HTTPException(status_code=403, detail="This is not your matchmaking entry")
    return q


def poll_queue(db: Session, q: PkQueue) -> dict:
    if q.status == "waiting":
        attempt_match(db, q)  # may flip q to "matched" as a side effect
    waited_seconds = (_now() - _aware(q.created_at)).total_seconds()
    return {
        "queue_id": q.id,
        "status": q.status,
        "version": q.version,
        "match_id": q.match_id,
        "suggest_ai": q.status == "waiting" and waited_seconds >= SUGGEST_AI_AFTER_SECONDS,
    }
