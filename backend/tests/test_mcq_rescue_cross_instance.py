"""
Characterization test — reproduces GitHub #4058 (MCQ rescue dialogue lost
when a student's requests land on a different Cloud Run instance).

Context (see issue #4058 for the full investigation):
  - `RescueSessionStore` (backend/app/services/rescue_session_store.py) is a
    pure in-memory `dict`, held by the module-level singleton `_store` in
    `mcq_rescue_agent.py`. Nothing persists it outside process memory.
  - lingoleap-backend-staging / lingoleap-backend run with
    `autoscaling.knative.dev/maxScale` > 1 and no `run.googleapis.com/
    sessionAffinity` annotation — Cloud Run can and does route a given
    student's sequential requests to *any* currently-warm instance.
  - Production logs (`run.googleapis.com/requests`, 30-day window, service
    `lingoleap-backend`, 2026-10-19 / 2026-10-24 / 2026-10-26 / 2026-11-01
    (x2) / 2026-11-04 / 2026-11-10 / 2026-11-11) repeatedly show the pattern:
    `/mcq-rescue/start` 200 -> one or more `/mcq-rescue/respond` 200 -> a
    burst of consecutive `/mcq-rescue/respond` 422 responses, each served in
    ~10-40ms (too fast to have reached Gemini — it is the
    `state is None: raise ValueError("... not found or expired")` fast-fail
    path), occurring seconds to tens of seconds after the prior success
    (far too soon for the 30-minute TTL to be the explanation). The
    frontend (`McqRescueDialog.tsx`) disables empty submission and caps
    input at 500 chars client-side, so "empty" / "too long" ValueError
    branches are not a plausible explanation for real traffic either.

This test simulates "two different Cloud Run instances" the same way
`test_socratic_session_persistence.py` validates the DB-backed fix that
already shipped for the equivalent Socratic-dialogue bug (#961): by holding
two independent store instances and asking whether state written through
one is visible through the other.

`RescueSessionStore` has no DB-backed persistence today (unlike
`socratic/session_store.py`), so this is expected to fail — marked
`xfail(strict=True)` so it documents the bug without breaking CI, and so
that an accidental, unreviewed "pass" (e.g. someone flips the import to the
wrong store) itself fails the build.

Remove the `xfail` marker once #4058's DB-backed fix lands. Per
git-issue-pr-flow policy, that fix needs a new `dialogue_state` JSONB column
(or equivalent) on `mcq_rescue_session` — a schema change requires Young's
sign-off before the Alembic migration is written, so this PR intentionally
stops here with the red test + schema proposal rather than merging a
migration.

Run with:
    cd backend && python -m pytest tests/test_mcq_rescue_cross_instance.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.services.mcq_rescue_agent import RescueSessionState, RescueSessionStore

FAKE_USER_ID = 4
FAKE_QUESTION_ID = "G6-L23-Q1"


def _make_state(session_id: str) -> RescueSessionState:
    return RescueSessionState(
        session_id=session_id,
        user_id=FAKE_USER_ID,
        question_id=FAKE_QUESTION_ID,
        lesson_id="G6-L23",
        wrong_choice="A",
        question_text="這篇文章主要在說什麼？",
        correct_answer="B",
        strategy_type=None,
    )


class TestCrossInstanceSessionLoss:
    def test_same_instance_sees_its_own_session(self):
        """Sanity/positive-control: within a SINGLE store (one Cloud Run
        instance), a session saved by /start is visible to a later /respond.
        Isolates the bug to cross-instance specifically, not basic save/get.
        """
        store = RescueSessionStore()
        session_id = RescueSessionStore.make_key(FAKE_USER_ID, FAKE_QUESTION_ID)
        state = _make_state(session_id)
        state.conversation.append({"role": "ai", "text": "我看到你選了 A，..."})

        store.save(state)
        restored = store.get(session_id)

        assert restored is not None
        assert restored.session_id == session_id
        assert restored.conversation == state.conversation

    @pytest.mark.xfail(
        strict=True,
        reason=(
            "#4058 — RescueSessionStore is in-memory only (module-level dict). "
            "A session created via /start on one Cloud Run instance is invisible "
            "to /respond if the request lands on another instance, which is "
            "possible today (maxScale > 1, no sessionAffinity annotation). "
            "Remove this xfail once the DB-backed fix (mirroring "
            "socratic/session_store.py) lands."
        ),
    )
    def test_session_created_on_one_instance_is_readable_on_another(self):
        """A session saved by store A (simulates instance A handling /start)
        must be readable from store B (simulates instance B handling the next
        /respond) once the dialogue state is persisted somewhere shared (DB)
        instead of living only in one process's memory.
        """
        store_a = RescueSessionStore()  # instance A's process-local store
        store_b = RescueSessionStore()  # instance B's process-local store

        session_id = RescueSessionStore.make_key(FAKE_USER_ID, FAKE_QUESTION_ID)
        state = _make_state(session_id)
        state.conversation.append({"role": "ai", "text": "我看到你選了 A，..."})

        store_a.save(state)

        # The actual bug: store_b has never seen this session_id, so this
        # currently returns None. In the real route, that None causes
        # `mcq_rescue_agent.process_response` to raise
        # ValueError(f"Rescue session {session_id} not found or expired"),
        # which `mcq_rescue_respond` turns into HTTP 422 — exactly the
        # production log pattern this test documents.
        restored = store_b.get(session_id)

        assert restored is not None, (
            "Session created on one Cloud Run instance must be visible on "
            "another instance once state is persisted to a shared store (DB), "
            "not held only in this process's memory."
        )
        assert restored.session_id == session_id
        assert restored.conversation == state.conversation
