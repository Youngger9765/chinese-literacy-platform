"""`/health` 也要能用 —— 監控工具的慣例路徑不該是 404。

2026-08-17 起，每小時的巡檢 tick 都對
`https://lingoleap-backend-.../health` 發 curl，拿到 404，然後開一張
「backend 掛了」的 issue（#2737）。後端其實是健康的：真正的路徑是 `/api/health`。

實測（2026-08-20，prod 與 staging 皆然）：

    /health       404
    /api/health   200

修 tick 的 prompt 只解決那一個呼叫端。`/health` 是**業界慣例**——
uptime 監控、Cloud Run、k8s probe、負載平衡器預設都打它。
下一個接手的人、下一個工具，還是會再撞一次。

所以這裡讓它可用，而不是讓每個呼叫端各自記得要加 `/api`。
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_the_conventional_health_path_works():
    with TestClient(app) as client:
        r = client.get("/health")
    assert r.status_code == 200, (
        f"/health 回 {r.status_code} —— 監控工具的慣例路徑，不該是 404"
    )


def test_it_says_the_same_thing_as_the_canonical_one():
    """別名不可以自己編一份健康狀態 —— 那會變成兩個會分岔的真相。"""
    with TestClient(app) as client:
        alias = client.get("/health")
        canonical = client.get("/api/health")
    assert canonical.status_code == 200, "正向對照：/api/health 本來就該是 200"
    assert alias.json() == canonical.json(), (
        f"兩條路徑講的話不一樣：\n  /health      {alias.json()}\n  /api/health  {canonical.json()}"
    )


def test_the_canonical_path_is_untouched():
    """負向對照：加別名不可以動到原本那條。"""
    with TestClient(app) as client:
        r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json().get("status") in ("ok", "healthy"), r.json()
