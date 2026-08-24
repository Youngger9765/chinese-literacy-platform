"""念順順起訖：golden set 回歸鎖（#2912，規則於 #2720 v3 移植後改寫）

⚠️ 為什麼存在：2026-08-24 為了擋計數欄雜訊加了一道比率門檻，造成 20 課 regression。
   當時**也有**回測組，但那組只挑「本來就會過」的課 —— 全在門檻之上，什麼都沒抓到。
   所以這份 golden set 的收錄原則是**兩邊都要有邊緣值**，理由逐課寫在 fixture 裡。

⚠️ 期望值 2026-08-24 整組改寫過，因為規則換了：從「☞ 起點段 → 計數欄末筆落點」的
   範圍，改回 2026-07-20 專家審查定的**只取指定的那一段**。改寫的理由、每一課的舊值、
   以及為什麼有 6 課從 must_not_resolve 移除，全部寫在 fixture 檔裡。

這支只驗**出貨的資料**（快，CI 跑得動）。改抽取器邏輯時要另外跑
`python scripts/extract_key_reading_v3.py`（不加 --apply 就只報告不寫檔）。
"""

import pathlib

import yaml

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"
GOLDEN = pathlib.Path(__file__).resolve().parent / "fixtures" / "key_reading_golden.yml"


def _golden() -> dict:
    return yaml.safe_load(GOLDEN.read_text(encoding="utf-8"))


def _key_reading(uid: str) -> dict:
    f = LESSONS / uid / "v3" / "key_reading.yml"
    if not f.is_file():
        return {}
    d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    return d.get("key_reading") or d


def _norm(text: str) -> str:
    import re
    return re.sub(r"[\s　]", "", text or "")


def test_golden_lessons_carry_the_range_the_worksheet_marks():
    """每一課的 start_paragraph / end_paragraph / 字數要跟 golden set 一致。

    逐課判定 —— 一課一個 verdict，失敗訊息列出是哪幾課、差在哪。
    ⛔ 不看中位數、不看通過比例。
    """
    wrong = []
    for uid, (start, end, chars, why) in _golden()["must_resolve"].items():
        kr = _key_reading(uid)
        got = (kr.get("start_paragraph"), kr.get("end_paragraph"), len(_norm(kr.get("passage"))))
        if got != (start, end, chars):
            wrong.append(f"  {uid} 應 ({start}, {end}, {chars}) 實際 {got} — {why}")
    assert wrong == [], "golden set 對不上：\n" + "\n".join(wrong)


def test_the_marked_paragraph_is_the_whole_passage():
    """全庫 end_paragraph 恆等於 start_paragraph。

    **為什麼要有這條**：上面那條只盯 12 課。範圍規則是**整庫一起**回來的（一支抽取器
    改一次、147 課同時變），只鎖 12 課會讓其餘 135 課靜默跨段。這條是那個廣度。
    """
    spans = []
    for f in sorted(LESSONS.glob("L*/v3/key_reading.yml")):
        kr = _key_reading(f.parts[-3])
        if not kr.get("passage"):
            continue
        s, e = kr.get("start_paragraph"), kr.get("end_paragraph")
        if s != e:
            spans.append(f"  {f.parts[-3]} start={s} end={e}")
    assert spans == [], (
        "念順順只取學習單指定的那一段，end_paragraph 必須等於 start_paragraph。"
        "跨段的課：\n" + "\n".join(spans)
    )


def test_no_lesson_reintroduces_the_count_column_fields():
    """`spans_paragraphs` / `approx_chars_from_start` 不可以回來。

    **為什麼**：`approx_chars_from_start` 是右緣累計字數欄的最大值 —— 那是「一分鐘能讀
    到哪」，不是段落長度。把它留在單段 passage 旁邊，下一個人就會拿它重建範圍規則
    （#2712 已經這樣復發過四次）。欄位不存在，就沒得重建。
    """
    dirty = []
    for f in sorted(LESSONS.glob("L*/v3/key_reading.yml")):
        kr = _key_reading(f.parts[-3])
        bad = [k for k in ("spans_paragraphs", "approx_chars_from_start") if k in kr]
        if bad:
            dirty.append(f"  {f.parts[-3]}: {bad}")
    assert dirty == [], "計數欄衍生欄位又出現了：\n" + "\n".join(dirty)


def test_lessons_without_a_marked_paragraph_ship_nothing():
    """must_not_resolve 的課出貨時不可以有 passage。

    **為什麼要真的斷言**：這一組原本只被 `test_every_golden_lesson_still_exists` 檢查
    「課還在不在」，沒有任何一條驗它們真的沒解出來 —— 等於一組註解。抽取器對這些課
    硬生一段出來，舊版測試會全綠。
    """
    wrong = []
    for uid, (verdict, why) in _golden()["must_not_resolve"].items():
        kr = _key_reading(uid)
        if kr.get("passage"):
            wrong.append(f"  {uid} 不該有 passage（預期 {verdict}）卻有 "
                         f"{len(_norm(kr.get('passage')))} 字 — {why}")
    assert wrong == [], "應該擋下來卻給了段落：\n" + "\n".join(wrong)


def test_every_golden_lesson_still_exists():
    """golden set 引用的課必須存在。

    **沒有這條會怎樣**：上面那條是走訪 golden set 逐課比對。課一旦被刪掉或改 uid，
    它就少驗幾課而**照樣全綠** —— 覆蓋範圍縮小是靜默的，這是 gate 最常見的死法。
    """
    g = _golden()
    missing = [uid for uid in list(g["must_resolve"]) + list(g["must_not_resolve"])
               if not (LESSONS / uid / "v3").is_dir()]
    assert missing == [], f"golden set 指到不存在的課：{missing}"


def test_the_golden_set_keeps_its_edge_cases():
    """收錄原則本身也要鎖住。

    這條擋的是「有人為了讓測試變綠，把難的課從 golden set 拿掉」——
    那正是 2026-08-24 那次 regression 沒被抓到的原因（回測組只有好走的課）。

    ⚠️ 邊緣的**定義**隨規則換過（見 fixture 開頭）：舊的是「計數欄吻合率高低」，
    現在計數欄不參與判斷了，邊緣改成「長度極短 / 極長」與「段號重編」。
    """
    g = _golden()
    edge_resolve = {u for u, v in g["must_resolve"].items() if "🔴 邊緣" in v[3]}
    edge_block = {u for u, v in g["must_not_resolve"].items() if "🔴 邊緣" in v[1]}
    assert edge_resolve >= {"L0140", "L0122", "L0010", "L0039"}, (
        f"must_resolve 的邊緣樣本被拿掉了：現在只有 {sorted(edge_resolve)}。"
        "L0140(11 字) L0122(32 字) 擋的是「加長度門檻順手擋掉真的短段落」，"
        "L0039(339 字) 擋的是「用長度回推一定跨段了」，"
        "L0010 擋的是段號重編時挑錯那一個「二」"
    )
    assert edge_block >= {"L0153", "L0154"}, (
        f"must_not_resolve 的邊緣樣本被拿掉了：現在只有 {sorted(edge_block)}。"
        "L0153 是文言文（指示句沒有「指定段落」），L0154 是解不出段號 —— "
        "少了它們就看不出抽取器會不會在沒錨點時硬猜一段"
    )
