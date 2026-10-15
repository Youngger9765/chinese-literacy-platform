"""Staging load test 2026-10-15, 10 games x 30 players: the instance served
only ~10 requests/s at a 2 s median while the DB was nowhere near busy.
get_current_user / get_optional_user / require_role were `async def` running
a synchronous SQLAlchemy query, so every authenticated request's user lookup
ran ON the event loop and the whole instance processed them one at a time.

As plain `def` dependencies FastAPI runs them in its thread pool.
"""
import asyncio
import inspect
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import event

from app.auth import dependencies as deps
from tests.test_live_quiz_engine import auth_header, client, engine_db, setup_db, student1  # noqa: F401


def test_auth_dependencies_are_not_coroutines():
    assert not inspect.iscoroutinefunction(deps.get_current_user)
    assert not inspect.iscoroutinefunction(deps.get_optional_user)
    checker = deps.require_role("teacher").dependency
    assert not inspect.iscoroutinefunction(checker)


def test_user_lookup_does_not_run_on_the_event_loop(client, student1):
    on_loop = []

    def spy(conn, cursor, statement, params, context, executemany):
        if "FROM users" in statement:
            try:
                asyncio.get_running_loop()
                on_loop.append(True)
            except RuntimeError:
                on_loop.append(False)

    event.listen(engine_db, "before_cursor_execute", spy)
    try:
        r = client.get("/api/live-quiz/invites", headers=auth_header(student1["token"]))
    finally:
        event.remove(engine_db, "before_cursor_execute", spy)
    assert r.status_code == 200, r.text
    assert on_loop and not any(on_loop), f"user lookup ran on the event loop: {on_loop}"
