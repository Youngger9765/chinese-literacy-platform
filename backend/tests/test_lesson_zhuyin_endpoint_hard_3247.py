"""難字集合要真的從 HTTP 出得來（#3247）

## 為什麼這支存在

#3230 的教訓：service 綠、1,083 條逐課測試綠、Gate 綠，**而端點自己重組回應的
那八行沒有任何東西在看** → staging 第一個請求就 500。

所以只要端點多回一個欄位，就要有一條打真 HTTP 的測試跟著。
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_endpoint_returns_hard_chars():
    r = client.get("/api/lessons/L0019/zhuyin")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "hard" in body, "回應要有 hard 欄位"
    assert isinstance(body["hard"], str)
    assert body["hard"], "L0019 應該有難字"
    # 家長點名的字不可以在裡面
    assert not (set("之加千同大失小手成") & set(body["hard"]))


def test_hard_chars_are_json_serialisable_for_every_lesson():
    """frozenset 不能直接進 JSON —— 這正是 #3230 那個 500 的形狀。"""
    for uid in ("L0003", "L0019", "L0135", "L0142"):
        r = client.get(f"/api/lessons/{uid}/zhuyin")
        assert r.status_code == 200, f"{uid}: {r.status_code} {r.text[:200]}"
        assert isinstance(r.json()["hard"], str)


def test_missing_lesson_still_404():
    assert client.get("/api/lessons/L9999/zhuyin").status_code == 404
