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
from _module_files import module_file, module_files

import yaml

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"
GOLDEN = pathlib.Path(__file__).resolve().parent / "fixtures" / "key_reading_golden.yml"


def _golden() -> dict:
    return yaml.safe_load(GOLDEN.read_text(encoding="utf-8"))


def _key_reading(uid: str) -> dict:
    f = module_file(LESSONS / uid / "v3", "key_reading")
    if not f:
        return {}
    d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    return d.get("key_reading") or d


def _norm(text: str) -> str:
    import re
    return re.sub(r"[\s　]", "", text or "")


def _all_key_reading_files() -> list[pathlib.Path]:
    """全庫每一篇的念順順檔。

    ⚠️ #2916 之後檔名帶 slug（`key_reading.mpjwh.yml`），而且**一課可能有好幾篇**。
    寫死 `key_reading.yml` 的 glob 會一個都比對不到，於是整條測試掃 0 課**照樣全綠**
    —— `backend/tests/_module_files.py` 的 docstring 就是在講這個死法。
    """
    out = []
    for vdir in sorted(LESSONS.glob("L*/v3")):
        out.extend(module_files(vdir, "key_reading"))
    return out


def _key_reading_of(f: pathlib.Path) -> dict:
    d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    return d.get("key_reading") or d


def test_the_sweep_actually_finds_files():
    """上面那個走訪不可以掃到 0 檔。

    **為什麼要單獨一條**：底下三條都是「找出違規的，斷言清單為空」。掃 0 檔時
    清單天然為空 → 全部綠燈，而且沒有任何訊號說覆蓋範圍歸零了。
    """
    n = len(_all_key_reading_files())
    assert n >= 150, f"只掃到 {n} 個念順順檔 —— 檔名規則又變了？（#2916 加了 slug）"


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
    for f in _all_key_reading_files():
        kr = _key_reading_of(f)
        if not kr.get("passage"):
            continue
        s, e = kr.get("start_paragraph"), kr.get("end_paragraph")
        if s != e:
            spans.append(f"  {f.parts[-3]}/{f.name} start={s} end={e}")
    assert spans == [], (
        "念順順只取學習單指定的那一段，end_paragraph 必須等於 start_paragraph。"
        "跨段的課：\n" + "\n".join(spans)
    )


#: 宣稱「passage 到哪結束 / 跨幾段」的欄位。與 `scripts/extract_key_reading_v3.py`
#: 的 `RANGE_ERA_FIELDS` 是同一份清單，這裡重寫一次是為了讓測試不依賴被測的那支
#: —— 抽取器把某個欄位從清單拿掉時，這條才會紅。
_RANGE_ERA_FIELDS = (
    "spans_paragraphs", "approx_chars_from_start", "end", "passage_note",
    "char_marks_cover_note", "char_marks_cover_paragraphs", "span_confidence",
    "span_confidence_note", "span_evidence_note", "span_note", "parts",
)


def test_no_lesson_reintroduces_the_range_era_fields():
    """宣稱範圍的欄位不可以回來。

    **為什麼**：`approx_chars_from_start` 是右緣累計字數欄的最大值 —— 那是「一分鐘能讀
    到哪」，不是段落長度。把它留在單段 passage 旁邊，下一個人就會拿它重建範圍規則
    （#2712 已經這樣復發過四次）。欄位不存在，就沒得重建。

    ⚠️ 清單是 2026-08-24 三審擴充的：原本只擋兩個欄位，但實際上還有 `span_confidence`
    37 課、`char_marks_cover_paragraphs` 30 課、`end` 10 課在講範圍，而且**內容與
    passage 直接矛盾**（L0050 的 `span_evidence_note` 講第 4、5 段，passage 卻是第 3 段；
    L0084 的 `passage_note` 寫「兩段合計 304 字」，passage 卻是 179 字）。
    reviewer 自己就說「我上一輪是被 `passage_note` 引導做出『被截斷』的判斷」——
    矛盾的敘述會讓下一個讀資料的人得到錯的結論。

    ⛔ 這條**不擋**忠實轉錄紙上內容的欄位（`printed_char_marks` 等是字數欄印出來的
    數字本身，`instruction_note` 講的是指示句）。刪那些是湮滅證據，不是消除矛盾。
    """
    dirty = []
    for f in _all_key_reading_files():
        bad = [k for k in _RANGE_ERA_FIELDS if k in _key_reading_of(f)]
        if bad:
            dirty.append(f"  {f.parts[-3]}/{f.name}: {bad}")
    assert dirty == [], "宣稱範圍的欄位又出現了：\n" + "\n".join(dirty)


def test_the_transcribed_worksheet_numbers_are_not_swept_away():
    """反過來鎖：清理不可以順手刪掉原稿的事實轉錄。

    **沒有這條會怎樣**：上面那條會鼓勵「把所有跟字數欄沾邊的欄位都刪掉」，
    但 `printed_char_marks` 是**紙上真的印著的數字**。它不能決定朗讀範圍，
    卻是這一課的原稿證據 —— 刪掉之後就再也回答不了「那一欄到底印了什麼」。
    """
    kept = sum(1 for f in _all_key_reading_files()
               if "printed_char_marks" in _key_reading_of(f))
    assert kept >= 25, (
        f"只剩 {kept} 課有 printed_char_marks —— 清理範圍規則欄位時把原稿轉錄也刪了？"
    )


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


def _extractor():
    """`scripts/extract_key_reading_v3.py`，直接載入（它不是套件的一部分）。"""
    import importlib.util
    p = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "extract_key_reading_v3.py"
    spec = importlib.util.spec_from_file_location("ek_v3", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_an_unnumbered_block_is_absorbed_only_when_the_sentence_is_unfinished():
    """沒編號的收尾段：斷在句中才吃，句子講完了就不吃。

    **為什麼要有這條**：`unnumbered_blocks` 一度完全沒被讀（L0084 因此有 125 字的
    結語不在考慮範圍內）。補讀它的時候，很容易順手用「字數欄末筆含它」當理由把它
    接上去 —— 那是 #2712 換個地方再做一次。在教授親手標了段落的 38 課上實測，
    字數欄的 max **38/38 全部大於**教授標的長度（中位 +264），它界定不了範圍。

    所以判準只有一個：句子有沒有結束。兩個方向都鎖，只鎖一邊會退化成「總是吃」
    或「總是不吃」。
    """
    m = _extractor()
    block = {6: ["另一個沒編號的收尾段。"]}
    passage, n = m.absorb_split_tail(["指定段的內容，這句話講完了。"], [6], 6, {6: 0}, block)
    assert (passage, n) == ("指定段的內容，這句話講完了。", 0), (
        "指定段自己以句末標點收尾，沒編號的收尾段是**另一段**，不可以吃進來"
    )

    passage2, n2 = m.absorb_split_tail(
        ["指定段的內容，這句話還沒"], [6], 6, {6: 0}, {6: ["講完就換段了。"]})
    assert (passage2, n2) == ("指定段的內容，這句話還沒講完就換段了。", 1), (
        "指定段斷在句中、下一段正好沒編號 —— 不吃就會截斷"
    )


def test_the_lesson_with_an_unnumbered_block_still_ships_the_marked_paragraph():
    """L0084 的實資料：段號欄 6 個號、課文欄 7 段，第 7 段沒號。

    第六段以「。」收尾，所以出貨的是第六段本身（179 字），不含後面 125 字的結語。
    ⚠️ 這條鎖的是**結果**，上面那條鎖的是**判準** —— 少了判準那條，有人把規則改成
    「總是吃」時這條仍會綠（L0084 剛好不受影響），反之亦然。
    """
    kr = _key_reading("L0084")
    assert kr.get("start_paragraph") == kr.get("end_paragraph") == 6
    assert kr["passage"].rstrip().endswith("直到現在我才讀懂。")
    assert "阿德勒" not in kr["passage"], (
        "沒編號的結語被吃進來了 —— 檢查是不是又拿字數欄當終點依據"
    )


def test_a_repeated_paragraph_number_resolves_to_the_last_run():
    """段號重編時取**最後**一次出現，而且吸收尾巴要接對位置。

    一份學習單裝兩篇（書信體、兩則短文）時段號從頭再數，全庫 4 課如此。
    L0010（錨點二）與 L0029（錨點七）真的有兩個候選，取最後一次出現的那個，
    兩課都逐字命中教授的一版人工掃描。

    **為什麼要測**：這件事以前是靠 dict 後蓋前**隱性**成立的，而取位置的
    `order.index(idx)` 拿的是**第一次**出現 —— 兩者對不起來。今天沒爆只是因為全庫
    都沒觸發吸收；哪天某課的指定段斷在句中，就會接上第一份文本的下一段。
    這條把「選最後一個」與「接對位置」一起鎖住。
    """
    m = _extractor()
    # 兩份文本，段號各自從 1 數起；第二份的「2」才是要的，而且它斷在句中。
    texts = ["甲一。", "甲二。", "乙一。", "乙二還沒", "講完。"]
    order = [1, 2, 1, 2, 3]
    pos_of = {}
    for i, ix in enumerate(order):
        pos_of[ix] = i
    passage, n = m.absorb_split_tail(texts, order, 2, pos_of)
    assert passage == "乙二還沒講完。", (
        f"取到 {passage!r} —— 段號 2 出現兩次時要取最後一次（第二份文本），"
        "而且往後接也要從那個位置接"
    )
    assert n == 1


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
