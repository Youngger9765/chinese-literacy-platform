"""Poll cost locks for /api/live-quiz/games/{code}/state.

2026-10-15 staging load test: 3 games x 30 students polling ~1/s pushed
state p50 to 3.1 s / p95 to 19.5 s and 190 of 450 answers arrived after the
window closed. Every poll was committing a last_seen_at write, which also
expired the game row so it was re-read (with its full rounds snapshot).
These tests pin the steady-state cost of a poll.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import event

from tests.test_live_quiz_engine import (  # noqa: F401  (fixtures)
    auth_header,
    client,
    engine_db,
    setup_db,
    student1,
    teacher,
    _create_game,
    TestingSessionLocal,
)
from app.models.live_quiz import LiveQuizPlayer


class _SqlCounter:
    def __init__(self):
        self.stmts = []

    def __enter__(self):
        event.listen(engine_db, "before_cursor_execute", self._on)
        return self

    def __exit__(self, *a):
        event.remove(engine_db, "before_cursor_execute", self._on)

    def _on(self, conn, cursor, statement, params, context, executemany):
        self.stmts.append(statement.strip().split()[0].upper())


def _joined_game(client, teacher, student1):
    game = _create_game(client, teacher)
    client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
    client.post(f"/api/live-quiz/games/{game['code']}/start", json={}, headers=auth_header(teacher["token"]))
    return game["code"]


def test_rapid_polls_do_not_write_presence_every_time(client, teacher, student1):
    code = _joined_game(client, teacher, student1)
    first = client.get(f"/api/live-quiz/games/{code}/state", headers=auth_header(student1["token"])).json()
    ver = first["version"]
    with _SqlCounter() as c:
        for _ in range(10):
            r = client.get(
                f"/api/live-quiz/games/{code}/state?after_version={ver}", headers=auth_header(student1["token"])
            )
            assert r.status_code == 200 and r.json().get("unchanged") is True
    assert c.stmts.count("UPDATE") == 0, f"presence written on rapid polls: {c.stmts}"


def test_unchanged_poll_is_cheap(client, teacher, student1):
    code = _joined_game(client, teacher, student1)
    ver = client.get(f"/api/live-quiz/games/{code}/state", headers=auth_header(student1["token"])).json()["version"]
    client.get(f"/api/live-quiz/games/{code}/state?after_version={ver}", headers=auth_header(student1["token"]))
    with _SqlCounter() as c:
        client.get(f"/api/live-quiz/games/{code}/state?after_version={ver}", headers=auth_header(student1["token"]))
    selects = [s for s in c.stmts if s == "SELECT"]
    # rate-limit membership is cached; route: user, game, player
    assert len(selects) <= 3, f"{len(selects)} SELECTs for one unchanged poll: {c.stmts}"


def test_presence_still_refreshed_after_window(client, teacher, student1, monkeypatch):
    """Throttling must not break the host's online indicator."""
    import app.services.live_quiz.engine as eng
    from datetime import timedelta

    code = _joined_game(client, teacher, student1)
    client.get(f"/api/live-quiz/games/{code}/state", headers=auth_header(student1["token"]))
    real_now = eng._now
    monkeypatch.setattr(eng, "_now", lambda: real_now() + timedelta(seconds=eng.ONLINE_WINDOW_SECONDS))
    client.get(f"/api/live-quiz/games/{code}/state", headers=auth_header(student1["token"]))
    host = client.get(f"/api/live-quiz/games/{code}/state", headers=auth_header(teacher["token"])).json()
    assert host["online_count"] == 1, host.get("players")


def test_another_students_answer_does_not_wake_every_student(client, teacher, student1):
    """O(n^2) under load: each answer bumped game.version, so all N students'
    next polls took the full path and each re-read every answer of the round.
    Students don't render answered_count, so their version must only move on
    host actions; the host still sees answers arrive."""
    from tests.test_live_quiz_engine import _register_user, _grant_student_role

    other = _register_user(client, "lq_cost_other")
    _grant_student_role(other["user_id"])
    game = _create_game(client, teacher)
    code = game["code"]
    for u in (student1, other):
        client.post(f"/api/live-quiz/games/{code}/join", headers=auth_header(u["token"]))
    client.post(f"/api/live-quiz/games/{code}/start", json={}, headers=auth_header(teacher["token"]))

    s_ver = client.get(f"/api/live-quiz/games/{code}/state", headers=auth_header(student1["token"])).json()["version"]
    host0 = client.get(f"/api/live-quiz/games/{code}/state", headers=auth_header(teacher["token"])).json()
    st = client.get(f"/api/live-quiz/games/{code}/state", headers=auth_header(other["token"])).json()
    key = st["round"]["options"][0]["key"]
    r = client.post(f"/api/live-quiz/games/{code}/answer", json={"submission": {"choice_key": key}},
                    headers=auth_header(other["token"]))
    assert r.status_code == 200, r.text

    s = client.get(f"/api/live-quiz/games/{code}/state?after_version={s_ver}", headers=auth_header(student1["token"])).json()
    assert s.get("unchanged") is True, f"student woken by someone else's answer: {s}"

    h = client.get(f"/api/live-quiz/games/{code}/state?after_version={host0['version']}",
                   headers=auth_header(teacher["token"])).json()
    assert not h.get("unchanged") and h["answered_count"] == host0["answered_count"] + 1, h

    # a host action still wakes the student
    client.post(f"/api/live-quiz/games/{code}/reveal", json={}, headers=auth_header(teacher["token"]))
    s2 = client.get(f"/api/live-quiz/games/{code}/state?after_version={s_ver}", headers=auth_header(student1["token"])).json()
    assert not s2.get("unchanged") and s2["status"] == "reveal", s2
