"""「還沒有資料」不是「壞掉了」。

`GET /api/tts-audit/provenance` 在 `backend/data/tts-provenance.jsonl` 不存在時
回 404。那個檔沒有進 repo、也沒有被 git 追蹤，所以 staging 上它**永遠不存在** ——
後台「TTS 句子稽核」頁面因此顯示 `載入失敗：HTTP 404`（2026-08-19 實測）。

404 的語意是「這個端點不存在」。這裡端點存在、路由也註冊了（`main.py:431`），
只是還沒有人跑過那支批次工具產生紀錄。正確的答案是「有 0 筆」，不是「找不到」。

差別不只是語意：前端拿到 404 只能顯示紅字「載入失敗」，跟後端真的掛掉長得一樣。
拿到 `{total: 0}` 它才畫得出「尚無稽核紀錄」。

⚠️ 這跟圖書館那 175 個破圖是同一族：**缺資料的狀態被畫成錯誤狀態**。
"""

from __future__ import annotations

import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.auth.dependencies import require_role  # noqa: E402
from app.main import app  # noqa: E402
from app.routes import tts_audit  # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True)
def _as_admin():
    """這支端點掛 `require_role("system_admin")`。

    這裡測的是「沒有資料時該回什麼」，不是權限 —— 權限有它自己的測試。
    不繞過的話三條都會停在 401，看起來像端點壞掉。
    """
    dep = require_role("system_admin")
    app.dependency_overrides[dep] = lambda: None
    # `require_role` 每次呼叫回新物件，所以也要蓋掉路由上實際掛的那一個
    for route in app.routes:
        for d in getattr(route, "dependencies", []) or []:
            if getattr(d.dependency, "__qualname__", "").startswith("require_role"):
                app.dependency_overrides[d.dependency] = lambda: None
    yield
    app.dependency_overrides.clear()


def test_missing_file_reads_as_zero_entries_not_404(tmp_path, monkeypatch):
    """檔案不存在 ⇒ 200 + 空清單，不是 404。"""
    monkeypatch.setattr(tts_audit, "_PROVENANCE_PATH", tmp_path / "nope.jsonl")
    r = client.get("/api/tts-audit/provenance")
    assert r.status_code == 200, (
        f"檔案不存在時回了 {r.status_code} —— 後台會顯示「載入失敗」，"
        "但實際上只是還沒有資料"
    )
    assert r.json() == {"total": 0, "entries": []}


def test_existing_file_still_returns_its_entries(tmp_path, monkeypatch):
    """正向對照：有資料時照常回傳，不能為了修 404 把讀取弄壞。"""
    f = tmp_path / "prov.jsonl"
    f.write_text('{"sentence":"甲","provider":"azure"}\n{"sentence":"乙","provider":"azure"}\n',
                 encoding="utf-8")
    monkeypatch.setattr(tts_audit, "_PROVENANCE_PATH", f)
    r = client.get("/api/tts-audit/provenance")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2, body
    assert body["entries"][0]["sentence"] == "甲"


def test_malformed_line_is_skipped_not_fatal(tmp_path, monkeypatch):
    """負向對照：壞掉的一行只跳過那一行，不能讓整支端點掛掉。

    批次工具是邊跑邊 append 的，讀到寫到一半的最後一行是正常情況。
    """
    f = tmp_path / "prov.jsonl"
    f.write_text('{"sentence":"甲"}\n{"sentence":"乙"\n{"sentence":"丙"}\n', encoding="utf-8")
    monkeypatch.setattr(tts_audit, "_PROVENANCE_PATH", f)
    r = client.get("/api/tts-audit/provenance")
    assert r.status_code == 200
    assert r.json()["total"] == 2, "壞掉那行應該被跳過，好的兩行要留下"
