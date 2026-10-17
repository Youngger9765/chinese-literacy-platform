"""HTTP contract tests for the 迷城密室 routes."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.user import User
from app.services.escape_room import engine as escape_engine
from app.services.escape_room.story_adapter import resolve_story_for_run
from app.services.story_pack_defaults import BUILTIN_PACKS


def _round(index: int, source: str) -> dict:
    return {
        "round_index": index,
        "payload": {
            "stem": f"題目{index}",
            "source_module": source,
            "options": [
                {"key": "A", "text": "對"},
                {"key": "B", "text": "錯"},
                {"key": "C", "text": "錯"},
                {"key": "D", "text": "錯"},
            ],
            "correct_key": "A",
            "seconds": 30,
        },
    }


@pytest.fixture()
def route_env(monkeypatch):
    db_engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(db_engine)
    session_factory = sessionmaker(bind=db_engine, autoflush=False)
    db = session_factory()
    owner = User(email="escape-owner@example.com", password_hash="x", name="Owner")
    other = User(email="escape-other@example.com", password_hash="x", name="Other")
    db.add_all([owner, other])
    db.commit()
    db.refresh(owner)
    db.refresh(other)

    monkeypatch.setattr(escape_engine, "validate_scope", lambda *_: None)
    monkeypatch.setattr(
        escape_engine,
        "_load_lessons_for_scope",
        lambda *_: [{"lesson_uid": "L1", "lesson": {}}],
    )

    def generate_rounds(_lessons, settings, _rng):
        source = settings["source_modules"][0]
        count = 1 if source == "comprehension" else 8
        return ([_round(index, source) for index in range(count)], False)

    monkeypatch.setattr(escape_engine.choice, "generate_rounds", generate_rounds)
    current_user = {"value": owner}

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: current_user["value"]
    try:
        with TestClient(app) as client:
            yield client, owner, other, current_user
    finally:
        app.dependency_overrides.clear()
        db.close()
        Base.metadata.drop_all(db_engine)


def _headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def _create_run(client: TestClient) -> int:
    response = client.post(
        "/api/escape-room/runs",
        json={"scope_type": "grade_pool", "scope_ref": "1"},
        headers=_headers(),
    )
    assert response.status_code == 201, response.text
    return response.json()["run_id"]


def test_chambers_are_enforced_in_order_at_http_boundary(route_env):
    client, *_ = route_env
    run_id = _create_run(client)

    response = client.post(
        f"/api/escape-room/runs/{run_id}/answer",
        json={"chamber_index": 1, "choice_key": "A"},
        headers=_headers(),
    )

    assert response.status_code == 409


def test_gate_answer_requires_all_chambers_at_http_boundary(route_env):
    client, *_ = route_env
    run_id = _create_run(client)

    response = client.post(
        f"/api/escape-room/runs/{run_id}/gate-answer",
        json={"choice_key": "A"},
        headers=_headers(),
    )

    assert response.status_code == 409


def test_ability_card_is_single_use_at_http_boundary(route_env):
    client, *_ = route_env
    run_id = _create_run(client)
    payload = {"ability_key": "hint"}

    assert client.post(
        f"/api/escape-room/runs/{run_id}/use-ability", json=payload, headers=_headers()
    ).status_code == 200
    response = client.post(
        f"/api/escape-room/runs/{run_id}/use-ability", json=payload, headers=_headers()
    )

    assert response.status_code == 409


@pytest.mark.parametrize("endpoint", ["state", "answer", "result"])
def test_run_endpoints_bind_every_run_to_its_owner(route_env, endpoint):
    client, owner, other, current_user = route_env
    run_id = _create_run(client)
    current_user["value"] = other
    if endpoint == "answer":
        response = client.post(
            f"/api/escape-room/runs/{run_id}/answer",
            json={"chamber_index": 0, "choice_key": "A"},
            headers=_headers(),
        )
    else:
        response = client.get(f"/api/escape-room/runs/{run_id}/{endpoint}", headers=_headers())
    assert response.status_code == 403

    missing = client.get("/api/escape-room/runs/999999/state", headers=_headers())
    assert missing.status_code == 404
    current_user["value"] = owner
    positive = client.get(f"/api/escape-room/runs/{run_id}/state", headers=_headers())
    assert positive.status_code == 200


def test_state_and_actions_return_one_complete_contract(route_env):
    client, *_ = route_env
    run_id = _create_run(client)
    state = client.get(f"/api/escape-room/runs/{run_id}/state", headers=_headers())
    assert state.status_code == 200, state.text
    body = state.json()
    assert body["status"] == "in_progress"
    assert body["current_chamber"]["chamber_index"] == 0
    assert "correct_key" not in body["current_chamber"]
    response = client.post(
        f"/api/escape-room/runs/{run_id}/answer",
        json={"chamber_index": 0, "choice_key": "A"},
        headers=_headers(),
    )
    assert response.status_code == 200, response.text
    assert set(response.json()) == set(body)


def test_unlocks_uses_contract_name(route_env):
    client, *_ = route_env
    response = client.get("/api/escape-room/unlocks", headers=_headers())
    assert response.status_code == 200, response.text
    assert response.json() == {"unlocks": []}


def test_every_grade_and_builtin_story_pack_can_start_or_fail_safely(route_env):
    client, *_ = route_env
    tested_grades = 0
    for grade in range(1, 13):
        response = client.post(
            "/api/escape-room/runs",
            json={"scope_type": "grade_pool", "scope_ref": str(grade)},
            headers=_headers(),
        )
        assert response.status_code in {201, 400}, response.text
        if response.status_code == 400:
            assert any("\u4e00" <= char <= "\u9fff" for char in response.json()["detail"])
        tested_grades += 1
    assert tested_grades == 12

    tested_packs = 0
    for pack_key in BUILTIN_PACKS:
        story = resolve_story_for_run(pack_key)
        assert story["key"] == pack_key
        tested_packs += 1
    assert tested_packs > 0
