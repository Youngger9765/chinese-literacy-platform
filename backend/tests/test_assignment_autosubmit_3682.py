"""
Regression tests for Issue #3682 — assignment auto-submit must not depend on
sessionStorage.

Production symptom (audited on prod, see the issue): a student who completes
every required step of an assigned lesson is never marked "submitted" unless
the browser's sessionStorage still holds `activeAssignmentId`. Opening the
lesson in a new tab, restarting the browser, or resuming days later wipes
that sessionStorage — the frontend then no longer "knows" this is an
assignment session, so its old auto-submit trigger (reading
`activeAssignmentId` + a matching `activeAssignmentContext` blob from
sessionStorage) silently no-ops. `steps_completed` is still saved correctly
to the DB the whole time (the teacher dashboard can see "9/9"), but
AssignmentSubmission.status stays "in_progress" forever and the teacher sees
"進行中" with every column "—".

Fix: PUT /api/learning/sessions/{id}/progress now accepts an
`assignment_ready_for_submit` flag (computed by the frontend from the
story's own required-step list — see stepConfig.ts
filterRequiredAssignmentSteps / useStepProgressPersistence.ts — NOT from
sessionStorage). When true, the backend looks up whether `session_id` is
linked to an in_progress AssignmentSubmission (a DB fact, independent of
whatever the frontend's sessionStorage currently believes) and submits it
(assignment_session_service.maybe_auto_submit_assignment_session).

These tests drive the bug exactly as it happens in production: never call
the manual POST /assignments/{id}/submit endpoint at all (that endpoint is
exactly what sessionStorage loss prevents the frontend from calling) —
completion must come from the progress-save path alone.
"""

import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.session import LearningSession
from app.models.school import School
from app.models.user import Role, UserRole

# ---------------------------------------------------------------------------
# In-memory SQLite test database (isolated per test module, same pattern as
# test_assignments.py / test_step_progress_api.py)
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]

_test_school_id: int = 0


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    for role_data in SEED_ROLES:
        db.add(Role(**role_data))
    db.commit()
    school = School(name="Autosubmit 3682 Test School")
    db.add(school)
    db.commit()
    db.refresh(school)
    _test_school_id = school.id
    db.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"{suffix.title()} {unique}",
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_resp.status_code == 200
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "token": token, "user_id": user_id}


def _grant_school_teacher_role(user_id: int) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "teacher").first()
        if not db.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == role.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            db.add(UserRole(user_id=user_id, role_id=role.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            db.commit()
    finally:
        db.close()


def _make_student_role(user_id: int) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "student").first()
        db.add(UserRole(user_id=user_id, role_id=role.id,
                         scope_type="school", scope_id=str(_test_school_id)))
        db.commit()
    finally:
        db.close()


@pytest.fixture(scope="module")
def teacher(client):
    user = _register_user(client, "asub_teacher")
    _grant_school_teacher_role(user["user_id"])
    return user


def _create_classroom_with_student(client, teacher, name_suffix: str):
    """Fresh classroom + fresh enrolled student, to avoid any in_progress-session
    dedup collision between tests (each test's story_id is also unique)."""
    student = _register_user(client, f"asub_stu_{name_suffix}")
    _make_student_role(student["user_id"])

    cls_resp = client.post(
        "/api/classrooms",
        json={"name": f"Autosubmit 3682 {name_suffix}", "school_id": _test_school_id},
        headers=auth_header(teacher["token"]),
    )
    assert cls_resp.status_code == 201, cls_resp.text
    classroom_id = cls_resp.json()["id"]

    enroll_resp = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=auth_header(teacher["token"]),
    )
    assert enroll_resp.status_code in (200, 201), enroll_resp.text

    return student, classroom_id


def _create_assignment(client, teacher, classroom_id: int, story_id: str) -> int:
    resp = client.post(
        f"/api/classrooms/{classroom_id}/assignments",
        json={"classroom_id": classroom_id, "story_id": story_id, "title": "Autosubmit 3682"},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _start_assignment(client, student, assignment_id: int) -> int:
    resp = client.post(
        f"/api/assignments/{assignment_id}/start",
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["session_id"]


def _submission_for_session(session_id: int) -> AssignmentSubmission:
    db = TestingSessionLocal()
    try:
        sub = (
            db.query(AssignmentSubmission)
            .filter(AssignmentSubmission.session_id == session_id)
            .first()
        )
        assert sub is not None, f"no AssignmentSubmission for session {session_id}"
        db.expunge(sub)
        return sub
    finally:
        db.close()


def _learning_session(session_id: int) -> LearningSession:
    db = TestingSessionLocal()
    try:
        sess = db.query(LearningSession).filter(LearningSession.id == session_id).first()
        assert sess is not None
        db.expunge(sess)
        return sess
    finally:
        db.close()


# Issue #3695 integrity follow-up (team-lead review): the backend no longer
# trusts assignment_ready_for_submit outright — it independently re-verifies
# against this assignment's OWN required steps (compute_required_step_ids_for_assignment),
# loaded from the real lesson data for story_id (these "2010x" numbers ARE
# real seeded lessons, each with its own round-keyed step_sequence — NOT the
# DEFAULT_REQUIRED_STEP_IDS fallback, which only applies when a lesson has no
# custom sequence at all). A test that claims "every required step done" for
# a given story must send that lesson's actual round-keyed ids, so this helper
# reuses the real production function (a transient, unpersisted Assignment is
# enough — the function only reads .story_id/.text_id) instead of
# reimplementing the lookup.
from app.services.assignment_queries import compute_required_step_ids_for_assignment


def _required_steps_for_story(story_id: str) -> list[str]:
    return compute_required_step_ids_for_assignment(Assignment(story_id=story_id))


# ---------------------------------------------------------------------------
# The core regression: completion via progress-save alone, no /submit call
# ---------------------------------------------------------------------------


class TestAutoSubmitWithoutManualSubmitCall:
    """Exactly the production bug: the frontend never calls POST .../submit
    (sessionStorage lost its activeAssignmentId) — only PUT .../progress ever
    fires. Before the fix, these left the submission stuck in_progress forever."""

    def test_assignment_submits_when_progress_save_reports_ready(self, client, teacher):
        student, classroom_id = _create_classroom_with_student(client, teacher, "ready")
        assignment_id = _create_assignment(client, teacher, classroom_id, "20101")
        session_id = _start_assignment(client, student, assignment_id)

        # Pre-condition: still in_progress, exactly the stuck-forever state.
        assert _submission_for_session(session_id).status == "in_progress"

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "report",
                "steps_completed": _required_steps_for_story("20101") + ["report"],
                "step_data": {},
                "assignment_ready_for_submit": True,
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text

        submission = _submission_for_session(session_id)
        assert submission.status == "submitted"
        assert submission.submitted_at is not None

        session = _learning_session(session_id)
        assert session.status == "completed"
        assert session.completed_at is not None

    def test_flag_true_with_missing_required_steps_does_not_submit(self, client, teacher):
        """Issue #3695 integrity follow-up (team-lead review): the client's
        assignment_ready_for_submit flag must be a HINT only, never trusted
        outright. A student who completes one real step and then forges the
        flag must get a silent no-op, not a submission — the backend has to
        independently verify the session's own stored steps_completed covers
        this assignment's REAL required steps (loaded server-side from the
        lesson data), not whatever the client claims."""
        student, classroom_id = _create_classroom_with_student(client, teacher, "missingsteps")
        assignment_id = _create_assignment(client, teacher, classroom_id, "20102")
        session_id = _start_assignment(client, student, assignment_id)

        required = _required_steps_for_story("20102")
        assert len(required) > 1, "fixture assumption: story 20102 needs more than one step"

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": required[0],
                # Only the FIRST required step is actually done; the flag lies.
                "steps_completed": [required[0]],
                "step_data": {},
                "assignment_ready_for_submit": True,
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert _submission_for_session(session_id).status == "in_progress", (
            "a forged ready=True flag with genuinely missing steps must not submit"
        )

        # Completing the rest for real (still carrying the flag) must then submit —
        # proves this isn't "never submits", only "doesn't trust the flag alone".
        resp2 = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": required[-1],
                "steps_completed": required,
                "step_data": {},
                "assignment_ready_for_submit": True,
                "version": 1,
            },
            headers=auth_header(student["token"]),
        )
        assert resp2.status_code == 200, resp2.text
        assert _submission_for_session(session_id).status == "submitted"

    def test_bare_step_id_satisfies_a_single_passage_lessons_requirement(self, client, teacher):
        """A student (or a direct API caller, same as the staging recheck)
        whose steps_completed uses bare ids still submits for a lesson whose
        own step_sequence is round-keyed, AS LONG AS each base id is
        unambiguous (exactly one round per base) — mirrors
        stepConfig.ts stepIdMatchesCompleted's backward-compat shim, verified
        server-side too now."""
        student, classroom_id = _create_classroom_with_student(client, teacher, "barematch")
        assignment_id = _create_assignment(client, teacher, classroom_id, "20102")
        session_id = _start_assignment(client, student, assignment_id)

        required = _required_steps_for_story("20102")
        bare_ids = sorted({(r.split("#")[0] if "#" in r else r) for r in required})
        assert len(bare_ids) == len(required), "fixture assumption: story 20102 has no repeated base id"

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": bare_ids[-1],
                "steps_completed": bare_ids,  # bare, no round slugs at all
                "step_data": {},
                "assignment_ready_for_submit": True,
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert _submission_for_session(session_id).status == "submitted"

    def test_bare_step_id_does_not_satisfy_an_ambiguous_multi_round_requirement(self, client, teacher):
        """The flip side: a multi-passage lesson where TWO rounds share the
        same base id (e.g. full-text-annotate#33uhx AND full-text-annotate#r4d9j)
        must NOT let one bare 'full-text-annotate' entry silently satisfy both —
        that would under-count real work and submit early."""
        student, classroom_id = _create_classroom_with_student(client, teacher, "ambiguous")
        assignment_id = _create_assignment(client, teacher, classroom_id, "20111")
        session_id = _start_assignment(client, student, assignment_id)

        required = _required_steps_for_story("20111")
        bases = [r.split("#")[0] if "#" in r else r for r in required]
        dup_bases = {b for b in bases if bases.count(b) > 1}
        assert dup_bases, "fixture assumption: story 20111 has at least one repeated base id"

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "comprehension",
                # Every base id present exactly once (bare) — satisfies the
                # non-ambiguous ones, but NOT the duplicated bases.
                "steps_completed": sorted(set(bases)),
                "step_data": {},
                "assignment_ready_for_submit": True,
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert _submission_for_session(session_id).status == "in_progress", (
            "a bare id must not resolve an ambiguous (2+ round) base requirement"
        )

    def test_progress_save_without_the_flag_does_not_submit(self, client, teacher):
        """Sanity / backward-compat: a save that does NOT claim readiness
        (e.g. an older frontend build, or genuinely mid-lesson) must not
        auto-submit — this is not "submit on every save"."""
        student, classroom_id = _create_classroom_with_student(client, teacher, "notready")
        assignment_id = _create_assignment(client, teacher, classroom_id, "20102")
        session_id = _start_assignment(client, student, assignment_id)

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "comprehension",
                "steps_completed": ["full-text-annotate"],
                "step_data": {},
                # assignment_ready_for_submit omitted -> defaults False
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert _submission_for_session(session_id).status == "in_progress"

    def test_auto_submit_is_idempotent_on_repeated_ready_saves(self, client, teacher):
        """Issue #3682 explicit requirement: must not double-submit."""
        student, classroom_id = _create_classroom_with_student(client, teacher, "idempotent")
        assignment_id = _create_assignment(client, teacher, classroom_id, "20103")
        session_id = _start_assignment(client, student, assignment_id)

        body = {
            "current_step": "report",
            "steps_completed": _required_steps_for_story("20103") + ["report"],
            "step_data": {},
            "assignment_ready_for_submit": True,
        }
        first = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json=body,
            headers=auth_header(student["token"]),
        )
        assert first.status_code == 200, first.text
        submitted_at_1 = _submission_for_session(session_id).submitted_at
        assert submitted_at_1 is not None

        # ReportPage's "mark report viewed" save fires again on remount, re-saving
        # the exact same progress — this must be a no-op, not a second submit.
        second = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={**body, "version": 1},
            headers=auth_header(student["token"]),
        )
        assert second.status_code == 200, second.text

        final = _submission_for_session(session_id)
        assert final.status == "submitted"
        assert final.submitted_at == submitted_at_1, (
            "second ready=True save must not re-submit / change submitted_at"
        )

    def test_self_practice_session_with_flag_true_is_a_harmless_noop(self, client, teacher):
        """A plain (non-assignment) learning session has no AssignmentSubmission
        row at all — sending assignment_ready_for_submit=True for it (e.g. the
        frontend sends the flag unconditionally once all required steps are
        done, regardless of whether this is an assignment) must not error and
        must not create one."""
        student, _classroom_id = _create_classroom_with_student(client, teacher, "selfpractice")

        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "20104"},
            headers=auth_header(student["token"]),
        )
        assert create_resp.status_code == 201, create_resp.text
        session_id = create_resp.json()["id"]

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "report",
                "steps_completed": ["full-text-annotate", "comprehension", "report"],
                "step_data": {},
                "assignment_ready_for_submit": True,
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text

        db = TestingSessionLocal()
        try:
            assert (
                db.query(AssignmentSubmission)
                .filter(AssignmentSubmission.session_id == session_id)
                .first()
                is None
            )
        finally:
            db.close()

    def test_flag_true_on_my_own_session_never_touches_another_students_submission(self, client, teacher):
        """Defense in depth for the trust boundary documented in
        StepProgressSaveRequest.assignment_ready_for_submit's docstring: a
        forged/stale flag can at most submit the CALLER's own in-progress
        assignment, never someone else's. get_owned_session (called before
        this flag is ever read) already 403s cross-student access to a
        session_id; this test locks that the auto-submit side effect itself
        is also scoped correctly — not just the HTTP-level read access."""
        student_a, classroom_id = _create_classroom_with_student(client, teacher, "crossstudent_a")
        student_b, _ = _create_classroom_with_student(client, teacher, "crossstudent_b")

        assignment_a_id = _create_assignment(client, teacher, classroom_id, "20106")
        session_a_id = _start_assignment(client, student_a, assignment_a_id)

        # Student B enrolls in a DIFFERENT assignment, in the same classroom.
        enroll_b = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student_b["user_id"]},
            headers=auth_header(teacher["token"]),
        )
        assert enroll_b.status_code in (200, 201), enroll_b.text
        assignment_b_id = _create_assignment(client, teacher, classroom_id, "20107")
        session_b_id = _start_assignment(client, student_b, assignment_b_id)

        # Student B tries to drive student A's session to completion by guessing
        # its session_id — must 403 before assignment_ready_for_submit is ever
        # read, and must not touch student A's submission.
        cross_resp = client.put(
            f"/api/learning/sessions/{session_a_id}/progress",
            json={
                "current_step": "report",
                "steps_completed": ["full-text-annotate", "comprehension", "report"],
                "step_data": {},
                "assignment_ready_for_submit": True,
            },
            headers=auth_header(student_b["token"]),
        )
        assert cross_resp.status_code == 403, cross_resp.text
        assert _submission_for_session(session_a_id).status == "in_progress"

        # Student B's own session, meanwhile, is untouched by the attempt above
        # and still submits normally through the same code path.
        own_resp = client.put(
            f"/api/learning/sessions/{session_b_id}/progress",
            json={
                "current_step": "report",
                "steps_completed": ["full-text-annotate", "comprehension", "report"],
                "step_data": {},
                "assignment_ready_for_submit": True,
            },
            headers=auth_header(student_b["token"]),
        )
        assert own_resp.status_code == 200, own_resp.text
        assert _submission_for_session(session_b_id).status == "submitted"
        # Student A's submission remains completely unaffected.
        assert _submission_for_session(session_a_id).status == "in_progress"

    def test_already_graded_submission_is_not_reopened(self, client, teacher):
        """A teacher-graded submission must never be flipped back by a late/replayed
        progress save that happens to carry the ready flag."""
        student, classroom_id = _create_classroom_with_student(client, teacher, "graded")
        assignment_id = _create_assignment(client, teacher, classroom_id, "20105")
        session_id = _start_assignment(client, student, assignment_id)

        db = TestingSessionLocal()
        try:
            sub = (
                db.query(AssignmentSubmission)
                .filter(AssignmentSubmission.session_id == session_id)
                .first()
            )
            sub.status = "graded"
            sub.score = 88.0
            db.commit()
        finally:
            db.close()

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "report",
                "steps_completed": ["full-text-annotate", "comprehension", "report"],
                "step_data": {},
                "assignment_ready_for_submit": True,
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text

        final = _submission_for_session(session_id)
        assert final.status == "graded"
        assert final.score == 88.0
