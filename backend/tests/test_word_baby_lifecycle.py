"""全生命週期：每一個物種都要能從「抓到」一路長到最終型態 (#3780)。

流程照真實學生會遇到的順序走（service 層，時間用參數推進）：
抓到 → 餵食吃滿一階 → 進入蛋/繭 → 每隔幾天照顧一次 → 孵化進下一階
→ 再餵 → … → fully_grown。

每一階都斷言：休眠型態跟設定一致、孵化前讀取是休眠、孵化天數到了讀取就進下一階。
跑全部 100 個物種，而不是挑幾隻 —— 任何一隻設定壞掉（例如某階需要的口味
背包裡永遠不會有）都會卡在半路，這條測試會紅。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.services import word_baby_config as config
from app.services import word_baby_service as svc
from app.models.word_baby import StudentFragmentWallet

# 10 月初：之後最長的成長期也走不進寒假太深，但就算走進去，暫停期只是讓
# 迴圈多跑幾輪，不影響正確性
START = datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)
CARE_EVERY = timedelta(days=4)  # 比 weaken_after_days(5) 短 —— 一直有在照顧
MAX_STEPS = 400


@pytest.fixture()
def db():
    import app.models  # noqa: F401
    from app.models.base import Base

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.execute(text(
        "INSERT INTO users (id, email, password_hash, name, is_active, email_verified,"
        " onboarding_completed, created_at, updated_at)"
        " VALUES (1, 'lifecycle-student-1', 'x', 'S1', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    ))
    for flavor in tuple(config.load_fragments()["flavor_families"]):
        session.add(StudentFragmentWallet(student_id=1, flavor=flavor, quantity=10_000))
    session.commit()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _pet(db, baby_id, now):
    pets = svc.get_my_pets(db, student_id=1, viewer_is_student=True, now=now)
    return next(p for p in pets["babies"] if p["baby_id"] == baby_id)


@pytest.mark.parametrize("baby_id", sorted(config.load_babies()))
def test_every_species_grows_from_catch_to_fully_grown(db, baby_id):
    baby = config.get_baby(baby_id)
    now = START
    svc._catch_baby(db, student_id=1, baby_id=baby_id, now=now)

    pet = _pet(db, baby_id, now)
    assert pet["stage_index"] == 1 and not pet["fully_grown"]

    stages_seen = [1]
    dormancies_seen = []
    for _ in range(MAX_STEPS):
        svc.feed_baby(db, student_id=1, baby_id=baby_id, now=now)
        pet = _pet(db, baby_id, now)
        if pet["fully_grown"]:
            break

        stage = baby["stages"][pet["stage_index"] - 1]
        dorm = stage["dormancy_after_this_stage"]
        if pet["dormant_type"] is not None:
            # 吃滿進休眠：型態要跟設定一樣，還沒孵化前倒數是正數
            assert pet["dormant_type"] == dorm["type"]
            assert pet["hatch_days_remaining"] > 0
            if not dormancies_seen or dormancies_seen[-1][0] != pet["stage_index"]:
                dormancies_seen.append((pet["stage_index"], pet["dormant_type"]))

        now += CARE_EVERY
        pet = _pet(db, baby_id, now)
        if pet["stage_index"] != stages_seen[-1] and not pet["fully_grown"]:
            assert pet["stage_index"] == stages_seen[-1] + 1, "孵化一次只能前進一階"
            assert pet["dormant_type"] is None, "孵化後應該脫離休眠"
            stages_seen.append(pet["stage_index"])
    else:
        pytest.fail(f"{baby_id} 走了 {MAX_STEPS} 輪還沒長大，卡在 stage {stages_seen[-1]}")

    assert stages_seen == list(range(1, baby["stage_count"] + 1))
    expected_dormancies = [
        (s["stage_index"], s["dormancy_after_this_stage"]["type"])
        for s in baby["stages"] if s["dormancy_after_this_stage"]
    ]
    assert dormancies_seen == expected_dormancies
    assert pet["fully_grown"] and pet["stage_index"] == baby["stage_count"]
