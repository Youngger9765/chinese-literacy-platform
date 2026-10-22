"""三篇的進度分開存，互不覆蓋（#2916）。

一份學習單印三篇課文時，念順順出現三次。進度是以 **step id** 為 key 寫進
`step_progress.step_data` 的 JSONB 裡 —— 三篇共用一個 key 的話，
學生念完第 3 篇，前兩篇的成績就被蓋掉了，而且**存得進去、讀得回來、
不報錯**，只是三筆變一筆。

前端那一半（網址 `?p=` → `key-passage-reading#9a7x4`）鎖在
`frontend/src/hooks/useCurrentStepId.test.tsx`。這裡鎖後端這一半：
帶後綴的 key 真的能各自存取、而且不需要任何 migration
（`step_progress` 是 JSONB，key 是自由的 —— 這條就是那句話的證據）。
"""
from __future__ import annotations

import sys, os, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.text import Text
from app.models.user import Role

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _pragma(conn, _rec):
    c = conn.cursor(); c.execute("PRAGMA foreign_keys=ON"); c.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
SLUG = "1"
# A SECOND lesson so `fresh_session_id` doesn't collide with `session_id`'s
# get-or-create (#984): POST /learning/sessions returns the student's
# existing in_progress session for the SAME story_slug, so reusing SLUG="1"
# here would silently hand back the very session this fixture exists to
# avoid sharing.
FRESH_SLUG = "2"

ROLES = [("system_admin", "platform"), ("org_admin", "organization"), ("principal", "school"),
         ("director", "school"), ("teacher", "school"), ("homeroom_teacher", "school"),
         ("student", "school"), ("parent", "school")]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    s = TestingSessionLocal()
    for name, scope in ROLES:
        s.add(Role(name=name, display_name=name, scope_level=scope))
    s.add(Text(title="多篇課", paragraphs=["第一段"], char_count=3, grade=6,
               grade_code="G6-L22", genre="說明文", text_type="單",
               category="Science", lesson_number=1))
    s.add(Text(title="另一課（給 fresh_session_id 用）", paragraphs=["第一段"], char_count=3, grade=6,
               grade_code="G6-L23", genre="說明文", text_type="單",
               category="Science", lesson_number=2))
    s.commit(); s.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def token(client):
    u = uuid.uuid4().hex[:8]
    email, pw = f"round_user_{u}@example.com", "SecurePass123!"
    # ⛔ 不指定 role：帶 `role: student` 會被擋（學生帳號由老師建立）。
    r = client.post("/api/auth/register", json={
        "email": email, "password": pw, "name": f"Round User {u}"})
    assert r.status_code in (200, 201), r.text
    vt = r.json().get("verification_token")
    if vt:
        client.get(f"/api/auth/verify-email?token={vt}")
    r = client.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def session_id(client, token):
    r = client.post("/api/learning/sessions", json={"story_slug": SLUG},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.fixture()
def fresh_session_id(client, token):
    """Issue #3682 follow-up: step_data is now a per-key MERGE (never fully
    replaced — see learning_step_progress.py), so a test that makes an
    exhaustive claim about the full key set (`len(data) == 1`) can no longer
    share the module-scoped `session_id` with other tests in this file —
    their composite-keyed entries now genuinely persist across PUTs instead
    of being wiped by the old full-overwrite behavior, and would otherwise
    leak into an unrelated test's assertion. A dedicated session per test
    keeps each test's claim about "everything that's in step_data" honest.

    Uses FRESH_SLUG (a different story) rather than SLUG: POST
    /learning/sessions is get-or-create per (student, story_slug) (#984) —
    reusing SLUG here would silently hand back the SAME session as the
    module-scoped `session_id` fixture (same token = same student), making
    this fixture not actually fresh.
    """
    r = client.post("/api/learning/sessions", json={"story_slug": FRESH_SLUG},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# 三篇的念順順：key 是 `步驟#那一節自己的代號`
KEYS = ["key-passage-reading#yprak", "key-passage-reading#9a7x4", "key-passage-reading#ajy9w"]


def test_three_rounds_are_stored_under_three_keys(client, token, session_id):
    """依序念完三篇，三筆進度都要在，數值各自正確。

    ## 誰負責累積

    ⚠️ 這段原本寫「後端整批取代，合併語意下刪不掉東西」——#3682
    production root cause 之後已不成立：後端現在是逐 key MERGE
    （見 learning_step_progress.py），不再整批取代。merge 不等於「永遠
    刪不掉」：要替換某個 key 的值，照樣在 payload 裡帶上那個 key 就會
    蓋過去（merge 是「key 層級的 last-write-wins」，不是 deep-merge）；
    真正要「移除一個整個 key」的場景目前只有 resetTutorStep 的
    steps_completed（有專屬 `reset_steps` 欄位處理），step_data 目前沒有
    任何真實呼叫端需要整個刪掉一個 key。

    前端仍然照原樣把新的一筆併進 `{...prev.step_data}` 再整份送出
    （`prev` 是進頁時從 GET 載回來的）——這個累積方式本身沒變，
    只是現在後端多一層保護：就算前端漏送了某個 key，也不會被洗掉。
    """
    h = {"Authorization": f"Bearer {token}"}
    acc: dict = {}
    for i, k in enumerate(KEYS):
        acc[k] = {"wpm": 100 + i}          # 前端就是這樣累積的
        r = client.put(f"/api/learning/sessions/{session_id}/progress",
                       json={"current_step": k, "steps_completed": KEYS[: i + 1],
                             "step_data": dict(acc)},
                       headers=h)
        assert r.status_code in (200, 201), r.text

    # ⛔ 讀回要走 progress 端點。`GET /sessions/{id}` 的回應**不含**
    #    `step_progress` —— 我第一版讀它，拿到 None 就以為沒存進去，
    #    而 PUT 的回應裡明明都在。空值先問「我是不是查錯地方」。
    r = client.get(f"/api/learning/sessions/{session_id}/progress", headers=h)
    assert r.status_code == 200, r.text
    data = ((r.json() or {}).get("step_progress") or {}).get("step_data") or {}
    assert set(KEYS) <= set(data), f"少了: {sorted(set(KEYS) - set(data))}  實得 {sorted(data)}"
    assert [data[k]["wpm"] for k in KEYS] == [100, 101, 102], data


def test_without_the_suffix_the_three_rounds_collapse(client, token, fresh_session_id):
    """反向對照：共用裸 key 的話三篇塌成一筆。

    這條不是測產品，是證明上一條真的在測東西 —— 後綴就是分隔的原因。

    用 `fresh_session_id`（不是模組共用的 `session_id`）：#3682 之後
    step_data 是逐 key 合併（不再整批取代），上一條測試留下的
    `key-passage-reading#...` 三筆現在會真的留在共用 session 裡，
    拿來跟這裡「應該只剩一筆」的斷言放在一起會互相污染。
    """
    h = {"Authorization": f"Bearer {token}"}
    bare = "key-passage-reading"
    acc: dict = {}
    for i in range(3):
        acc[bare] = {"wpm": 200 + i}       # 同一個 key，後寫的蓋前面的
        client.put(f"/api/learning/sessions/{fresh_session_id}/progress",
                   json={"current_step": bare, "steps_completed": [bare],
                         "step_data": dict(acc)}, headers=h)
    data = ((client.get(f"/api/learning/sessions/{fresh_session_id}/progress", headers=h)
             .json() or {}).get("step_progress") or {}).get("step_data") or {}
    assert len([k for k in data if k.startswith(bare)]) == 1, sorted(data)
    assert data[bare]["wpm"] == 202, "裸 key 沒被覆蓋？那後綴就不是分隔的原因"


def test_no_migration_was_needed(client, token, session_id):
    """`step_progress` 是 JSONB，key 是自由的 —— 換 slug 不需要動 schema。

    這條是「零 migration」那句話的證據：一個從沒出現過的 key 直接寫得進去。
    """
    h = {"Authorization": f"Bearer {token}"}
    novel = "key-passage-reading#" + uuid.uuid4().hex[:5]
    r = client.put(f"/api/learning/sessions/{session_id}/progress",
                   json={"current_step": novel, "steps_completed": [novel],
                         "step_data": {novel: {"wpm": 999}}}, headers=h)
    assert r.status_code in (200, 201), r.text
    data = ((client.get(f"/api/learning/sessions/{session_id}/progress", headers=h)
             .json() or {}).get("step_progress") or {}).get("step_data") or {}
    assert data.get(novel, {}).get("wpm") == 999
