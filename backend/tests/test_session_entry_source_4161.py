"""
#4161 AI 派發：學習紀錄要能分出「從 AI 派發進來的練習」。

資料庫原本只有「自主練習／老師作業」兩種來源，AI 派發的課和自己挑的課在紀錄裡長一樣。
現在 learning_sessions 多一個可為空的 entry_source 欄位，建立 session 時由前端帶 "ai_dispatch"。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from tests.test_learning_sessions_api import (  # noqa: E402
    VALID_SLUG,
    _register_user,
    auth_header,
    client,  # noqa: F401  (fixture)
    setup_db,  # noqa: F401  (module autouse fixture：建表、灌角色與課文、覆寫 get_db)
)

URL = "/api/learning/sessions"


def _create(client, token, **extra):
    return client.post(URL, json={"story_slug": VALID_SLUG, **extra}, headers=auth_header(token))


def _list_items(client, token):
    resp = client.get(URL, headers=auth_header(token))
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


def test_create_with_ai_dispatch_is_recorded_and_listed(client):
    u = _register_user(client, "entry_ai")
    resp = _create(client, u["token"], entry_source="ai_dispatch")
    assert resp.status_code == 201, resp.text
    assert resp.json()["entry_source"] == "ai_dispatch"
    items = _list_items(client, u["token"])
    assert [i["entry_source"] for i in items] == ["ai_dispatch"]
    # 它仍是自主練習（不是老師作業），只是多了入口標記
    assert items[0]["learning_source"] == "self"


def test_create_without_entry_source_stays_null(client):
    u = _register_user(client, "entry_plain")
    resp = _create(client, u["token"])
    assert resp.status_code == 201
    assert resp.json()["entry_source"] is None
    assert [i["entry_source"] for i in _list_items(client, u["token"])] == [None]


def test_unknown_entry_source_is_rejected(client):
    u = _register_user(client, "entry_bad")
    assert _create(client, u["token"], entry_source="hacker").status_code == 422


def test_existing_in_progress_session_is_not_relabelled(client):
    """已經有進行中的同一課：回傳原來那筆，不因為這次從 AI 派發進來就改標記。"""
    u = _register_user(client, "entry_reuse")
    first = _create(client, u["token"])
    again = _create(client, u["token"], entry_source="ai_dispatch")
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["entry_source"] is None


def test_students_cannot_set_entry_source_on_someone_elses_session(client):
    """欄位只在建立時寫入；PATCH 不接受它（避免事後改標記）。"""
    u = _register_user(client, "entry_patch")
    sid = _create(client, u["token"]).json()["id"]
    resp = client.patch(f"{URL}/{sid}", json={"entry_source": "ai_dispatch"}, headers=auth_header(u["token"]))
    assert resp.status_code in (200, 422)
    detail = client.get(f"{URL}/{sid}", headers=auth_header(u["token"])).json()
    assert detail["entry_source"] is None
