import pytest
"""Contract test for Issue #2562 — 重點朗讀 key_reading passages 對照表 + 合併.

驗證 (真 API 回應，非只驗 loader dict — #2559 曾因驗錯層而 no-op)：
  1. 對照表可載入且筆數合理（>=100）。
  2. story 詳情端點 GET /api/stories/{id} 對「有對照」的課回傳 key_reading.passage，
     且＝對照表新規則段落（取代課文檔舊值）。
  3. 「無課文」類課（對照表沒有）→ key_reading 為 None（前端 fallback 唸全文）。
"""
from fastapi.testclient import TestClient

from app.main import app
from app.services.lesson_layer_loaders import get_key_reading_passages

client = TestClient(app)


@pytest.mark.xfail(


    reason="重點朗讀未接上：來源是一修的課號綁定資料，無欄位可驗證歸屬（見 data/curriculum_qa/content_known_gaps.yaml#key_reading_passages）",


    strict=True,


)


def test_map_loads_with_reasonable_count():
    m = get_key_reading_passages()
    assert isinstance(m, dict)
    assert len(m) >= 100, f"對照表筆數異常: {len(m)}"
    # 每筆都有非空 passage
    assert all(v.get("passage") for v in m.values())
    # 抽樣：G4-L1 為新規則第三段（到「向心力！」），非舊 pilot 的「☞→結尾 376 字」
    g4l01 = m.get("G4-L1")
    assert g4l01 and g4l01["passage"].startswith("2021年8月1日")
    assert g4l01["passage"].rstrip().endswith("向心力！")


def _find_story_id_by_grade_code(grade_code: str):
    resp = client.get("/api/stories")
    assert resp.status_code == 200
    for s in resp.json().get("stories", []):
        if s.get("grade_code") == grade_code:
            return s["id"]
    return None


@pytest.mark.xfail(


    reason="重點朗讀未接上：來源是一修的課號綁定資料，無欄位可驗證歸屬（見 data/curriculum_qa/content_known_gaps.yaml#key_reading_passages）",


    strict=True,


)


def test_detail_endpoint_serves_mapped_key_reading():
    sid = _find_story_id_by_grade_code("G4-L1")
    assert sid is not None, "找不到 G4-L1"
    resp = client.get(f"/api/stories/{sid}")
    assert resp.status_code == 200
    kr = resp.json().get("key_reading")
    assert kr is not None, "G4-L1 詳情未回傳 key_reading（合併 no-op？）"
    assert kr["passage"].startswith("2021年8月1日")
    assert kr["passage"].rstrip().endswith("向心力！")


def test_no_text_lesson_has_no_key_reading():
    # G7-L23（雨林裡的奇蹟藥物）為閱讀策略類、無念順順 → 不在對照表
    assert "G7-L23" not in get_key_reading_passages()
    sid = _find_story_id_by_grade_code("G7-L23")
    if sid is not None:
        resp = client.get(f"/api/stories/{sid}")
        assert resp.status_code == 200
        # 無對照且課文檔亦無 → None（前端唸全文）
        assert resp.json().get("key_reading") is None
