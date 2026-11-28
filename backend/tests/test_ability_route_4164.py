"""能力估計端點（#4164）：只認每題第一次作答、資料不足誠實回估計中、用的是呼叫者自己的資料。"""
from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import JSON, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.mcq_attempt import McqAttempt
from app.models.user import User

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
CURRENT = {"id": 1}


def _db():
    db = Session()
    try:
        yield db
    finally:
        db.close()


def _user():
    return User(id=CURRENT["id"], username="x", name="x", email="x"+"@"+"t.test", password_hash="fake")


@pytest.fixture(scope="module", autouse=True)
def setup():
    for t in Base.metadata.sorted_tables:
        for c in t.columns:
            if isinstance(c.type, JSONB):
                c.type = JSON()
    Base.metadata.create_all(bind=engine)
    db = Session()
    rnd = random.Random(5)
    n_students, items = 60, [(f"L{k//3}", f"q{k}", -1.0 + k * 0.3) for k in range(8)]
    for uid in range(1, n_students + 1):
        db.add(User(id=uid, username=f"u{uid}", name="u", email=f"u{uid}"+"@"+"t.test", password_hash="fake"))
    db.flush()
    for uid in range(1, n_students + 1):
        theta = rnd.gauss(0, 1)
        for lesson, qid, b in items:
            ok = rnd.random() < 1 / (1 + math.exp(-(theta - b)))
            db.add(McqAttempt(user_id=uid, lesson_id=lesson, question_id=qid, choice="A", is_correct=ok))
    # 學生 61 沒作答；學生 62 第一次全錯、之後狂按全對（只能算第一次）
    db.add(User(id=61, username="u61", name="u", email="u61"+"@"+"t.test", password_hash="fake"))
    db.add(User(id=62, username="u62", name="u", email="u62"+"@"+"t.test", password_hash="fake"))
    db.flush()
    for lesson, qid, _ in items:
        db.add(McqAttempt(user_id=62, lesson_id=lesson, question_id=qid, choice="A", is_correct=False))
    for _ in range(3):
        for lesson, qid, _ in items:
            db.add(McqAttempt(user_id=62, lesson_id=lesson, question_id=qid, choice="B", is_correct=True))
    db.commit()
    db.close()
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def _get(uid):
    from app.services.ability.service import reset_calibration_cache

    reset_calibration_cache()
    CURRENT["id"] = uid
    return TestClient(app).get("/api/learning/ability/me")


def test_沒作答的學生回估計中不給等級():
    r = _get(61)
    assert r.status_code == 200
    body = r.json()
    assert body["ready"] is False and body["level"] is None
    assert "再做" in body["hint"]


def test_有作答的學生給等級與提示且附自家等級聲明():
    body = _get(1).json()
    assert body["ready"] is True and 1 <= body["level"] <= 8
    assert body["scored_answers"] == 8 and body["calibrated_items"] == 8
    assert "參考 PISA 分級的自家等級" in body["disclaimer"]


def test_只算第一次作答_後面狂按全對不會拉高():
    body = _get(62).json()
    assert body["scored_answers"] == 8
    assert body["theta"] < -0.5, body  # 第一次全錯；若誤算重試會接近 0 以上


def test_同題號出現在兩課_兩筆第一次作答都要留下():
    from app.services.ability.service import first_attempts

    db = Session()
    db.add(User(id=70, username="u70", name="u", email="u70"+"@"+"t.test", password_hash="fake"))
    db.flush()
    db.add(McqAttempt(user_id=70, lesson_id="LA", question_id="E1", choice="A", is_correct=True))
    db.add(McqAttempt(user_id=70, lesson_id="LB", question_id="E1", choice="A", is_correct=False))
    db.add(McqAttempt(user_id=70, lesson_id="LA", question_id="E1", choice="B", is_correct=False))
    db.commit()
    rows = sorted(first_attempts(db, 70))
    db.close()
    assert rows == [("70", "LA:E1", True), ("70", "LB:E1", False)]


def test_只答一題不給等級():
    db = Session()
    db.add(User(id=71, username="u71", name="u", email="u71"+"@"+"t.test", password_hash="fake"))
    db.flush()
    db.add(McqAttempt(user_id=71, lesson_id="L0", question_id="q0", choice="A", is_correct=True))
    db.commit()
    db.close()
    body = _get(71).json()
    assert body["scored_answers"] == 1
    assert body["ready"] is False and body["level"] is None


def test_有離線校準檔就用檔_不讀資料庫的作答(tmp_path, monkeypatch):
    import json

    from app.services.ability import service

    items = {f"{lesson}:q{k}": {"difficulty": 2.0, "se": 0.1, "n": 99} for k, (lesson, _) in enumerate([("L0", 0), ("L0", 0), ("L0", 0), ("L1", 0), ("L1", 0), ("L1", 0), ("L2", 0), ("L2", 0)])}
    f = tmp_path / "cal.json"
    f.write_text(json.dumps({"generated_at": "x", "items": items}), encoding="utf-8")
    live = _get(1).json()["theta"]
    monkeypatch.setattr(service, "OFFLINE_CALIBRATION_PATH", f)
    body = _get(1).json()
    # 同一位學生、同樣的作答；檔案把每題都標成很難，答對的題數不變，估計出的能力就該明顯更高
    assert body["calibrated_items"] == 8
    assert body["theta"] > live + 0.3, (live, body["theta"])


def test_離線校準檔壞掉就退回即時校準(tmp_path, monkeypatch):
    from app.services.ability import service

    f = tmp_path / "bad.json"
    f.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(service, "OFFLINE_CALIBRATION_PATH", f)
    assert service.load_offline_calibration() is None
    body = _get(1).json()
    assert body["ready"] is True and body["calibrated_items"] == 8


def test_批次校準產物格式可被讀回(tmp_path):
    import json

    from app.services.ability import service

    db = Session()
    payload = service.build_calibration_payload(db)
    db.close()
    f = tmp_path / "cal.json"
    f.write_text(json.dumps(payload), encoding="utf-8")
    back = service.load_offline_calibration(f)
    assert back is not None and len(back) == 8 and all(v.n >= 30 for v in back.values())


@pytest.mark.parametrize("content", ['{"items": []}', '{"items": {}}', '{"items": {"a": 1}}', "[]", ""])
def test_離線校準檔內容不合格式一律當沒有檔(tmp_path, content):
    from app.services.ability import service

    f = tmp_path / "x.json"
    f.write_text(content, encoding="utf-8")
    assert service.load_offline_calibration(f) is None
