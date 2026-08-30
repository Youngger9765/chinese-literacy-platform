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
    """對照表 `key_reading_passages.yml` 能載入且筆數合理。

    **這條為什麼是 xfail(strict)**：那個檔是**一修**的資料，用課號（catalog 位置）當 key。
    二修把每一課重新編號，於是查表**每次都查得到、但回的是別課的文字** —— staging 上
    G4-L10《十秒的背後》曾經在服務一修 G4-L10（讓座的故事），學生朗讀了完全無關的課文，
    而系統沒有任何地方報錯。`stories.py` 因此決定**不讀這個檔**。

    保留 xfail 而不是刪掉，是因為它是那段歷史的紀錄：
    **strict=True 代表「如果哪天它突然通過了，反而要來看一眼」** —— 那意味著有人把
    這個死檔重新接回服務路徑。
    """
    m = get_key_reading_passages()
    assert isinstance(m, dict)
    assert len(m) >= 100, f"對照表筆數異常: {len(m)}"
    # 每筆都有非空 passage
    assert all(v.get("passage") for v in m.values())
    # 抽樣：G4-L1 = 第 3–4 段（到「…尊敬及喝采。」）。
    #
    # ⚠️ 這裡原本斷言「向心力！」（只到第 3 段）。那是「只取 ☞ 那一段」的舊期望，
    #    2026-08-24 owner 逐行看原稿推翻：☞ 印在第三段段首，右緣累計字數欄最後一格
    #    376 落在第四段的「人心，贏得全國人民」那一行 → 範圍是第 3–4 段。
    #    規則＝「☞ 那一段 → 最後一個數字落在的那一段，兩端之間全包」。
    g4l01 = m.get("G4-L1")
    assert g4l01 and g4l01["passage"].startswith("2021年8月1日")
    assert g4l01["passage"].rstrip().endswith("尊敬及喝采。")


def _find_story_id_by_grade_code(grade_code: str):
    resp = client.get("/api/stories")
    assert resp.status_code == 200
    for s in resp.json().get("stories", []):
        if s.get("grade_code") == grade_code:
            return s["id"]
    return None


# xfail 拿掉了（2026-08-24，#2912）。它的理由是「重點朗讀未接上：來源是一修的課號
# 綁定資料」—— 對這一條已經不成立：v3 的 passage 收成學習單指定的那一段之後，服務端
# 對 G4-L1 真的回得出 key_reading。strict=True 會把 xpass 判成 failed，留著它 CI 就是
# 紅的；而這是一條真的在驗服務層的鎖，該讓它跑。
# 上面那條仍 xfail：它讀的是 key_reading_passages.yml（死檔，不復活）。
def test_detail_endpoint_serves_mapped_key_reading():
    """真 API 回應要帶 key_reading.passage，而且是正確的範圍。

    **為什麼打真端點而不是驗 loader**：#2559 就是驗錯層 —— 驗 loader 的 dict 全綠，
    但合併那一步是 no-op，API 回出去的根本沒有 key_reading。**驗中間層等於沒驗。**

    **為什麼斷言結尾字串**：passage 長度對不代表範圍對（取到隔壁段也可能一樣長）。
    盯住結尾那幾個字，取錯段就會立刻紅。

    ⚠️ 期望值翻過兩次，寫清楚免得再翻第三次：
      · 原本斷言「向心力！」= 只取 ☞ 那一段（第 3 段）
      · 2026-08-24 改成「尊敬及喝采。」= 第 3–4 段，理由是右緣累計字數欄最後一格
        376 落在第四段
        · 2026-08-24 改回「向心力！」—— 靖杭比對紙本學習單後推翻上一次：計數欄是
          「一分鐘能讀到哪」的量尺，不是教授畫的範圍，念順順只練指定的那一段
          （2026-07-20 專家審查定案）。
        · **2026-08-30 改成「尊敬及喝采。」（第 3–4 段）** —— 這是第三次翻，
          所以理由要比前兩次硬。三個**互相獨立**的來源同時指向範圍：

            ① 現場：明珠老師 2026-08-29 透過 Hans 回報，測段落閱讀流暢度需要
               **至少 300 字**，學習單上「☞ 是開始，但學生要讀的是講義右方
               有標字數的**全部段落**」。當時服務端中位數 144 字、4/160 達 300 字。
            ② 實體學習單照片（Owner 拍的《大自然的氣象小幫手》L0003）：☞ 在第七段，
               而第七段**第一行**的數字就是 28 —— 若計數欄從文章開頭算不可能是 28。
               所以那欄**從 ☞ 開始累計**，末筆直接就是該唸的字數。
            ③ 2026-07-20 專家審查（曾世傑教授）自己定的是「重點段落，**約 300–400 字**」
               （docs/PRD.md:1602）。「只取一段」中位數 144 字
               **跟它自己引用的那份決策互相矛盾** —— 保留了句子，丟掉了數字。

          ⚠️ 8/24 那次否決針對的是**另一種抽法**（「一路抽到文末」）。實測還原後的
          資料：**115 課提早停、只有 23 課抽到文末**（L0005 是 1→7 而課文有 14 段）。
          「抽到文末」該被否決，「抽到累計欄末筆落在的那一段」不該 —— 兩件事被混在一起。

          要再改（第四次）請先看那張照片，並解釋 ①②③ 三條各自為什麼不算數。
    """
    sid = _find_story_id_by_grade_code("G4-L1")
    assert sid is not None, "找不到 G4-L1"
    resp = client.get(f"/api/stories/{sid}")
    assert resp.status_code == 200
    kr = resp.json().get("key_reading")
    assert kr is not None, "G4-L1 詳情未回傳 key_reading（合併 no-op？）"
    assert kr["passage"].startswith("2021年8月1日")
    assert kr["passage"].rstrip().endswith("尊敬及喝采。")
    # start_paragraph / end_paragraph 不在 API 回應裡（只有 passage / start_text /
    # extent_chars / source），跨段與否在服務層看不到。看得到的是 extent_chars ——
    # 它必須是 passage 自己的長度，不是右緣累計字數欄那個「一分鐘能讀到哪」的數字。
    # 兩者一旦脫鉤，就是計數欄又被當成範圍在用（#2712）。整庫的 start==end 由
    # test_key_reading_golden_2912.py 在資料層鎖。
    import re
    assert kr["extent_chars"] == len(re.sub(r"[\s　]", "", kr["passage"])), (
        f'extent_chars={kr["extent_chars"]} 與 passage 實際長度不符 —— '
        "字數欄的數字漏進來了？"
    )


def test_no_text_lesson_has_no_key_reading():
    """沒有念順順那一節的課，API 要回 None，不可以硬給一段。

    **為什麼要有這條**：前端在 `key_reading` 為 None 時會 fallback 唸全文，那是正確行為。
    真正的風險是反過來 —— 抽取器對「本來就沒有這一節」的課硬生出一段
    （閱讀策略類、定向課、文言文都屬此類，普查歸為 `no_counter` 16 課）。

    **服務錯的段落比不服務更糟** —— 學生會照著念一段老師沒指定的文字，
    而且沒有任何人會發現。這條就是擋那個。
    """
    # G7-L23（雨林裡的奇蹟藥物）為閱讀策略類、無念順順 → 不在對照表
    assert "G7-L23" not in get_key_reading_passages()
    sid = _find_story_id_by_grade_code("G7-L23")
    if sid is not None:
        resp = client.get(f"/api/stories/{sid}")
        assert resp.status_code == 200
        # 無對照且課文檔亦無 → None（前端唸全文）
        assert resp.json().get("key_reading") is None
