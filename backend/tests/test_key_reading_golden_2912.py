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


def test_the_passage_spans_to_where_the_counter_stops():
    """全庫大多數課 end_paragraph > start_paragraph。

    ⚠️ **2026-08-30 這條整個反過來了。** 原本斷言 `end == start`（只取 ☞ 那一段）。

    起因：明珠老師 2026-08-29 透過 Hans 回報，測段落閱讀流暢度需要**至少 300 字**，
    學習單上「☞ 是開始，但學生要讀的是講義右方有標字數的**全部段落**」。
    當時服務端 passage 中位數只有 **144 字**、只有 4/160 達 300 字 —— 老師測不了。

    ## 為什麼推翻 2026-08-24 那次改寫

    當時的依據有兩條，兩條現在都站不住：

    ① **「規則是 2026-07-20 專家審查定的只取指定的那一段」** ——
       那次審查（曾世傑教授）自己定的是「重點段落，**約 300–400 字**」
       （`docs/PRD.md:1602`、`docs/reading-key-passage-TODO.md:3`）。
       「只取一段」的中位數是 144 字，**跟它自己引用的專家決策互相矛盾** ——
       保留了句子，把數字丟了。

    ② **靖杭比對紙本後的觀察**：「v3 會直接提取到**結束**…將該段落**以下的內容全部**
       提取了」。那個觀察是對的，但它描述的是**另一種**抽法（☞ → 文末）。
       實測還原後的資料：**115 課提早停、只有 23 課抽到文末**
       （例：L0005 是 1→7 而課文有 14 段）。所以他否決的是「抽到文末」，
       而這裡要的是「抽到**累計字數欄末筆落在的那一段**」—— 兩件事被混在一起了。
       yml 裡的手寫筆記本來就記著這個形狀：
       「末筆 392 落在第 4 段結束，第 5~7 段沒有標 —— 屬『字數欄提早停』的形狀」。

    ## 決定性證據

    Owner 拍的《大自然的氣象小幫手》(L0003) 實體學習單：
    ☞ 在第七段，而第七段**第一行**的數字就是 28（若從文章開頭算不可能是 28），
    第七段結束在 259（＝當時服務的字數），第八段結束在 392。

    ## 這條為什麼用全庫的量

    範圍規則是**整庫一起**變的（一支抽取器改一次、147 課同時變）。
    2026-08-26 那次 regression 的樣態是**全庫 0 課跨段**，不是某幾課壞掉。
    所以廣度要鎖在「大多數課跨段」，只鎖 12 課會讓其餘 135 課靜默塌回一段。
    """
    blocks = []
    for f in _all_key_reading_files():
        kr = _key_reading_of(f)
        if not kr.get("passage"):
            continue
        s, e = kr.get("start_paragraph"), kr.get("end_paragraph")
        if s is not None and e is not None:
            blocks.append((f, s, e))
    assert len(blocks) >= 100, f"只掃到 {len(blocks)} 份有段號 —— 掃描壞了"
    multi = [b for b in blocks if b[2] > b[1]]
    assert len(multi) >= 100, (
        f"只有 {len(multi)}/{len(blocks)} 課跨段。念順順要的是「☞ → 累計字數欄末筆落在的"
        "那一段」，不是只有 ☞ 那一段。end_paragraph 是不是又被寫死等於 start 了？\n"
        "（2026-08-26 那次 regression 的樣態就是全庫 0 課跨段，老師因此測不了流暢度。）"
    )


#: 宣稱「範圍」但**內容會跟 passage 矛盾**的欄位。
#: ⚠️ 2026-08-30：`approx_chars_from_start` 從這裡移除 —— 它是累計字數欄的末筆，
#:    而那正是判斷範圍的依據（不是「一分鐘能讀到哪」的量尺）。刪它才是湮滅證據。
#:    現在它以 `printed_counter_last` 的名字被正式記錄，另有鎖在守。
_RANGE_ERA_FIELDS = (
    "spans_paragraphs", "passage_note",
    "char_marks_cover_note", "char_marks_cover_paragraphs", "span_confidence",
    "span_confidence_note", "span_evidence_note", "span_note", "parts",
)


def test_range_fields_never_contradict_the_passage():
    """宣稱範圍的欄位，內容必須跟 start/end 一致。

    ⚠️ **2026-08-30 從「欄位不准存在」改成「不准矛盾」。**

    原本的理由是對的 —— 那些欄位曾經與 passage **直接矛盾**
    （L0050 的 `span_evidence_note` 講第 4、5 段，passage 卻是第 3 段；
    L0084 的 `passage_note` 寫「兩段合計 304 字」，passage 卻是 179 字）。
    reviewer 自己說「我上一輪是被 `passage_note` 引導做出『被截斷』的判斷」。

    但當時的解法是**把欄位刪掉**，而那在 2026-08-30 變成問題：
    passage 改回範圍之後，那些欄位**不再矛盾了**（實測 33 課一致、
    12 課是 `end_paragraph` 缺值而範圍只記在 `spans_paragraphs` 裡 ——
    刪掉那欄等於毀掉唯一的紀錄，`end_paragraph` 已從它補出）。

    ⛔ 真正要防的是**矛盾**，不是欄位存在。刪證據跟消除矛盾是兩回事 ——
       同一份檔案的 `test_the_transcribed_worksheet_numbers_are_not_swept_away`
       就是在講這件事。所以這條改成驗一致性。
    """
    wrong = []
    for f in _all_key_reading_files():
        kr = _key_reading_of(f)
        s, e = kr.get("start_paragraph"), kr.get("end_paragraph")
        if s is None or e is None:
            continue
        for key in ("spans_paragraphs", "char_marks_cover_paragraphs"):
            v = kr.get(key)
            if isinstance(v, list) and v and all(isinstance(x, int) for x in v):
                if (min(v), max(v)) != (s, e):
                    wrong.append(
                        f"  {f.parts[-3]}/{f.name}: {key}={v} 但 start={s} end={e}"
                    )
    assert wrong == [], (
        "宣稱範圍的欄位跟 passage 的起訖矛盾 —— 矛盾的敘述會讓下一個讀資料的人"
        "得到錯的結論（要嘛修欄位、要嘛修 start/end，不要用刪欄位解決）：\n"
        + "\n".join(wrong)
    )

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


def test_the_unnumbered_closing_block_is_part_of_the_range():
    """L0084 的實資料：段號欄 6 個號、課文欄 7 段，第 7 段沒號。

    ⚠️ **2026-08-30 反過來了。** 原本斷言出貨的是第六段本身（179 字）、不含後面
    125 字的結語 —— 那是「只取指定的那一段」規則下的結果。

    這一課自己的 `passage_note` 就寫著答案：

        朗讀範圍是第 6 段 ＋ 最後那段沒有段號的結語（兩段合計 304 字，
        **與字數欄末筆吻合**）

    字數欄末筆是紙上印的、可獨立驗證的事實，而「沒有段號」只是排版 ——
    不是「不用唸」。所以結語**在範圍內**。

    ⚠️ 這條鎖的是**結果**，`test_the_passage_spans_to_where_the_counter_stops`
    鎖的是**判準** —— 少了判準那條，有人把規則改回「只取一段」時
    這條仍可能綠（L0084 剛好只有一個段號），反之亦然。
    """
    kr = _key_reading("L0084")
    passage = kr["passage"]
    assert "阿德勒" in passage, (
        "沒編號的結語被排除了 —— 那段在字數欄的計數範圍內（末筆 304 == 第 6 段 ＋ 結語），"
        "『沒有段號』是排版，不是『不用唸』"
    )
    assert len(passage) >= 300, (
        f"只有 {len(passage)} 字。字數欄末筆是 304，少於它代表結語又被切掉了"
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
