"""老師打的勾要能被讀出來，而且**不准動到文字流**（#2735 / #2555）。

## 為什麼是旁路，不是在文字裡插記號

第一版我讓 `_para_text` 把 `<w:sym w:char="F0FE"/>` 吐成 `☑` 而不是 `□`，
想讓下游分得出哪個被勾。**那個設計是錯的**：這個 repo 裡有 **209 行、20 個檔**
硬寫 `□`（`split_inline_box_options` 的正則、各種 QA lib、spotlight 解析器……），
換一個字元等於要人工列全 209 個消費端，漏一個就是一個只有剛好被測到才會發現的
靜默 bug —— 我當場就漏了 `split_inline_box_options`。

所以改成：**文字流原封不動（照樣是 `□`），勾走另一條路傳。**
沒有任何既有解析器需要知道這件事。

## 真值來源

L2 私有 repo 的教師版原稿（77 份裡 69 份帶 F0FE，對得上平台 74 課）。
抽驗過 L0001（G4-L10）與 L0019（G4-L8）：舊答案 == ☑ 標的那個，現行答案不是。
"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _para(*runs):
    """組一個 <w:p>：字串 → <w:t>，None → 被勾的 <w:sym>。"""
    import xml.etree.ElementTree as ET

    p = ET.Element(W + "p")
    for r in runs:
        run = ET.SubElement(p, W + "r")
        if r is None:
            ET.SubElement(run, W + "sym", {W + "font": "Wingdings", W + "char": "F0FE"})
        else:
            t = ET.SubElement(run, W + "t")
            t.text = r
    return p


class TestTheTickIsReadableWithoutTouchingTheText:
    def test_it_reports_which_positions_were_ticked(self):
        from build_lesson_schema import checked_box_positions

        # □①甲　☑②乙　□③丙 —— 第 2 個框被勾（0-based index 1）
        p = _para("□①甲　", None, "②乙　□③丙")
        assert checked_box_positions(p) == [1], checked_box_positions(p)

    def test_a_paragraph_with_no_tick_reports_nothing(self):
        """負向對照：沒有勾就是空 list，不是 [0]。"""
        from build_lesson_schema import checked_box_positions

        assert checked_box_positions(_para("□①甲　□②乙")) == []

    def test_more_than_one_tick_is_reported(self):
        """複選題：勾不只一個。回 list 而不是單一 index 就是為了這個。"""
        from build_lesson_schema import checked_box_positions

        p = _para(None, "①甲　", None, "②乙　□③丙")
        assert checked_box_positions(p) == [0, 1], checked_box_positions(p)

    def test_the_text_stream_is_byte_for_byte_unchanged(self):
        """🔴 這條是整個設計的重點。

        209 行硬寫 `□`。只要 `_para_text` 吐出來的東西跟以前差一個字元，
        那 209 處就都要重新確認。所以它必須**逐字元相同**。
        """
        from build_lesson_schema import _para_text

        p = _para("□①甲　", None, "②乙")
        out = _para_text(None, p)
        assert "☑" not in out, f"新字元流進文字了：{out!r}"
        assert out == "□①甲　□②乙", f"文字流被改動了：{out!r}"

    def test_positions_line_up_with_the_boxes_in_the_text(self):
        """旁路要對得上文字裡的框，不然 index 指到別的選項。

        少了這條，`checked_box_positions` 回 [1]、而文字裡第 1 個框其實是別的東西，
        答案就標到錯的選項 —— 上面那幾條卻還是全綠。
        """
        from build_lesson_schema import _para_text, checked_box_positions

        p = _para("□①甲　", None, "②乙　□③丙")
        text = _para_text(None, p)
        boxes = [i for i, ch in enumerate(text) if ch == "□"]
        assert len(boxes) == 3, f"文字裡應該有 3 個框：{text!r}"

        idx = checked_box_positions(p)
        assert idx == [1]
        start = boxes[idx[0]]
        assert text[start:start + 3] == "□②乙", text[start:start + 6]


def _write_docx(tmp_path, paragraphs):
    """把 `_para()` 建的 <w:p> 塞進一份最小可用的真 .docx，回傳存檔路徑。

    只有 `extract_raw()` 本身（走 `docx.Document(path).element.body.iterchildren()`）
    需要一份真的 docx；`extract_raw` 以下的所有函式都只吃 dict，不需要這個。
    """
    import xml.etree.ElementTree as ET
    import docx as _docx
    from lxml import etree

    d = _docx.Document()
    body = d.element.body
    for child in list(body):
        if child.tag == W + "p":
            body.remove(child)
    sect_pr = body.find(W + "sectPr")
    for p in paragraphs:
        lxml_p = etree.fromstring(ET.tostring(p))
        if sect_pr is not None:
            sect_pr.addprevious(lxml_p)
        else:
            body.append(lxml_p)
    path = tmp_path / "fixture.docx"
    d.save(str(path))
    return path


class TestExtractRawCarriesTheGroundTruth:
    """`extract_raw()` 是唯一碰得到真 XML 的地方；再往下的每個函式都只吃 dict。

    Fixture 文字取自 issue #2735 本文（L0001 / G4-L10）—— 已經是公開資訊。
    """

    def test_paragraph_dicts_carry_the_checked_position(self, tmp_path):
        from build_lesson_schema import extract_raw

        # 真 docx 裡沒勾的選項是字面的「□」文字字元；被勾的那個沒有字面「□」——
        # F0FE 這個 <w:sym> 本身就是那個位置唯一的框（見 issue #2735 README 的實測）。
        paras = [
            _para("□①拿下世大運金牌後，一路順利，最後取得奧運資格"),
            _para(None, "②先拿下金牌，後來遇到失敗與受傷，但仍努力復健、重回賽場"),
            _para("□③一開始就受傷復健，後來才拿下世大運金牌，最後參加亞運比賽"),
        ]
        path = _write_docx(tmp_path, paras)
        raw = extract_raw(path)

        assert [r["checked"] for r in raw] == [[], [0], []], raw
        # 文字流本身要維持既有格式（不能因為加了 checked 欄位就順手改了文字）
        assert raw[1]["text"] == "□②先拿下金牌，後來遇到失敗與受傷，但仍努力復健、重回賽場"

    def test_a_docx_with_no_ticks_reports_empty_checked_everywhere(self, tmp_path):
        """負向對照：沒有 ☑ 的來源，每段的 checked 都是空的，不是憑空生出索引。"""
        from build_lesson_schema import extract_raw

        paras = [_para("□①甲"), _para("□②乙")]
        path = _write_docx(tmp_path, paras)
        raw = extract_raw(path)

        assert [r["checked"] for r in raw] == [[], []], raw


class TestGroundTruthWinsOverTheMissingBoxGuess:
    """`_collect_option_run`（`_append_options_from_block` 的唯一呼叫點）要在有
    `checked` 資料時用它，而不是 #2555 之後永遠為 True 的 `is_dist`。
    """

    def test_one_option_per_paragraph_uses_the_tick(self):
        from build_lesson_schema import _collect_option_run

        blocks = [
            {"type": "_option_line", "text": "□①拿下世大運金牌後，一路順利，最後取得奧運資格", "checked": []},
            {"type": "_option_line", "text": "□②先拿下金牌，後來遇到失敗與受傷，但仍努力復健、重回賽場", "checked": [0]},
            {"type": "_option_line", "text": "□③一開始就受傷復健，後來才拿下世大運金牌，最後參加亞運比賽", "checked": []},
        ]
        options, answer, j = _collect_option_run(blocks, 0)

        assert j == 3
        assert options == [
            "拿下世大運金牌後，一路順利，最後取得奧運資格",
            "先拿下金牌，後來遇到失敗與受傷，但仍努力復健、重回賽場",
            "一開始就受傷復健，後來才拿下世大運金牌，最後參加亞運比賽",
        ]
        assert answer == "先拿下金牌，後來遇到失敗與受傷，但仍努力復健、重回賽場", (
            f"answer 標到 {answer!r}——沒有用 ☑，退回成『第一個沒被標 distractor 的』"
            "（#2555 之後 is_dist 對每個選項都是 True，所以那條路只會落到 options[0]）"
        )

    def test_inline_multi_option_line_uses_the_tick(self):
        """一行塞多個選項（`split_inline_box_options` 分支），一樣要照 checked 走。"""
        from build_lesson_schema import _collect_option_run

        blocks = [
            {"type": "guide", "text": "□①甲　□②乙　□③丙", "checked": [1]},
        ]
        options, answer, j = _collect_option_run(blocks, 0)
        assert answer == "乙", f"answer={answer!r}，應該是被勾的②乙"

    def test_first_tick_in_the_run_wins_and_a_later_block_cannot_override_it(self):
        from build_lesson_schema import _collect_option_run

        blocks = [
            {"type": "_option_line", "text": "□①甲", "checked": [0]},
            {"type": "_option_line", "text": "□②乙", "checked": []},
        ]
        options, answer, j = _collect_option_run(blocks, 0)
        assert answer == "甲"

    def test_falls_back_to_the_old_behavior_when_the_source_has_no_tick_data(self):
        """負向對照：#2735 修的是『有 ☑ 卻沒被讀到』。完全沒有 ☑ 的來源（真的沒被
        交付教師版）要維持 #2555 之後既有的行為（退到 options[0]），不能因為這次改動
        意外幫沒有真值的課『生出』一個答案。
        """
        from build_lesson_schema import _collect_option_run

        blocks = [
            {"type": "_option_line", "text": "□①甲", "checked": []},
            {"type": "_option_line", "text": "□②乙", "checked": []},
        ]
        options, answer, j = _collect_option_run(blocks, 0)
        assert answer is None, (
            f"answer={answer!r}——沒有 ☑ 資料時 `_collect_option_run` 不該猜答案，"
            "『退到 options[0]』是它呼叫端 coalesce_mcq_option_blocks 的事，不是這裡的事"
        )


class TestCoalesceStandaloneInlineGuideUsesTheTick:
    """coalesce_mcq_option_blocks 裡『free_text 後接一行內嵌多選項 guide』的分支
    （#2735 issue 原文引用的第 3 個呼叫點）。
    """

    def test_the_ticked_option_wins_even_though_every_option_has_a_box(self):
        from build_lesson_schema import coalesce_mcq_option_blocks

        blocks = [
            {"type": "free_text", "prompt": "老鷹會怎麼做？"},
            {"type": "guide", "text": "□①甲　□②乙　□③丙", "checked": [2]},
        ]
        out = coalesce_mcq_option_blocks(blocks)
        singles = [b for b in out if b.get("type") == "single"]
        assert len(singles) == 1, out
        assert singles[0]["answer"] == "丙", singles[0]


class TestOrphanOptionLineKeepsItsTick:
    """孤兒 `_option_line`（前面沒有可配對的 prompt）被降級成 guide 時，
    `checked` 不能被那次轉型悄悄丟掉——不然後面 convert_checkbox_guide_blocks
    看到的就是一個查不到真值的空 guide。
    """

    def test_checked_survives_the_option_line_to_guide_downgrade(self):
        from build_lesson_schema import coalesce_mcq_option_blocks

        blocks = [{"type": "_option_line", "text": "□①甲", "checked": [0]}]
        out = coalesce_mcq_option_blocks(blocks)
        assert len(out) == 1
        assert out[0]["type"] == "guide"
        assert out[0].get("checked") == [0], out[0]


class TestSplitQuestionInlineOptionsUsesTheTick:
    """convert_checkbox_guide_blocks 呼叫的第 4 個呼叫點：一行同時塞了『問題？選項』。"""

    def test_the_ticked_option_wins_when_indices_line_up_cleanly(self):
        from build_lesson_schema import split_question_inline_options

        # opt_part 本來就以 □ 開頭 → 不需要人工補框，index 跟 checked 是 1:1
        result = split_question_inline_options(
            "老鷹會怎麼做？□①甲　□②乙　□③丙", checked=[1]
        )
        assert result is not None
        assert result["answer"] == "乙", result

    def test_does_not_guess_when_a_synthetic_box_was_inserted(self):
        """負向對照：`opt_part` 沒有以 □ 開頭時，函式會人工補一個框才能解析——
        那個補的框在真文字裡沒有對應的位置，用 checked 去對它一定會對錯行，
        所以這個分支寧可不套用 ground truth，維持舊行為。
        """
        from build_lesson_schema import split_question_inline_options

        # 第一個選項沒有框（正是 #2555 之前的洩漏形狀）——不能假裝 checked=[0] 指得到它
        result = split_question_inline_options(
            "老鷹會怎麼做？甲　□乙　□丙", checked=[0]
        )
        assert result is not None
        # 舊行為：沒被標 distractor 的第一項（甲，因為它沒有 □）
        assert result["answer"] == "甲", result


class TestCheckboxGuideRunUsesTheTick:
    """第 5 個呼叫點（code review 抓到，原本漏掉）：`convert_checkbox_guide_blocks`
    裡『問題後面接一串各自獨立段落的 □ 選項』分支（`_is_checkbox_guide_text` →
    `_options_from_checkbox_guide`）。跟已修的四個一樣呼叫 `split_inline_box_options`
    拿到 `is_distractor`，卻直接丟掉那個資訊，永遠回 `options[0]`。
    """

    def test_the_ticked_option_wins_for_a_two_option_single(self):
        """code review 的重現案例：兩個選項、各自一段 guide，勾在第二個。"""
        from build_lesson_schema import convert_checkbox_guide_blocks

        blocks = [
            {"type": "free_text", "prompt": "老鷹會怎麼做？"},
            {"type": "guide", "text": "□甲：先拿下金牌", "checked": []},
            {"type": "guide", "text": "□乙：後來受傷復健", "checked": [0]},
        ]
        out = convert_checkbox_guide_blocks(blocks)
        singles = [b for b in out if b.get("type") == "single"]
        assert len(singles) == 1, out
        assert singles[0]["answer"] == "乙：後來受傷復健", singles[0]

    def test_falls_back_to_options_zero_when_the_source_has_no_tick_data(self):
        """負向對照：完全沒有 ☑ 資料的來源要維持舊行為（options[0]），
        不能因為這次改動意外幫沒有真值的課『生出』一個答案。
        """
        from build_lesson_schema import convert_checkbox_guide_blocks

        blocks = [
            {"type": "free_text", "prompt": "老鷹會怎麼做？"},
            {"type": "guide", "text": "□甲：先拿下金牌", "checked": []},
            {"type": "guide", "text": "□乙：後來受傷復健", "checked": []},
        ]
        out = convert_checkbox_guide_blocks(blocks)
        singles = [b for b in out if b.get("type") == "single"]
        assert len(singles) == 1, out
        assert singles[0]["answer"] == "甲：先拿下金牌", singles[0]

    def test_the_tick_wins_inside_a_single_inline_multi_option_guide_line(self):
        """同一個分支也吃『一行塞多個 □ 選項』的 guide（split_inline_box_options
        分支），不只是『各自一段』的形狀。用 2 個選項留在 single（>2 個會被判成
        multi，multi 的 answer 本來就是全部選項，不是這條鎖要管的範圍）。"""
        from build_lesson_schema import convert_checkbox_guide_blocks

        blocks = [
            {"type": "free_text", "prompt": "老鷹會怎麼做？"},
            {"type": "guide", "text": "□①甲　□②乙", "checked": [1]},
        ]
        out = convert_checkbox_guide_blocks(blocks)
        singles = [b for b in out if b.get("type") == "single"]
        assert len(singles) == 1, out
        assert singles[0]["answer"] == "乙", singles[0]


class TestClassifyQuestionParaUsesTheTick:
    """第 6 個呼叫點（第二輪 code review 抓到）：`_classify_question_para` 處理
    『❶問題？□①甲　□②乙』這種整段塞在同一個段落的題型，走的是自己另一套
    `re.split(r"□")` 邏輯（不呼叫 `parse_option_line`/`split_inline_box_options`，
    所以沒被前兩輪的字面搜尋抓到），一樣是靠『沒被框到的殘留字』猜答案。

    #2555 之後每個選項都有框，這條路徑量測結果（真教材語料庫，175 份 docx）：
    74 次命中「同段落多框」形狀，其中 62 次直接回傳 answer=None——不是『改成
    另一個錯答案』，是『答案整個消失』，而且沒有 `_needs_answer_extraction`，
    後面也不會有人再幫它填。這條測試守住的是「有真值可用時不該讓答案消失」。
    """

    def test_the_ticked_option_wins_when_every_box_has_exactly_one_option(self):
        from build_lesson_schema import _classify_question_para

        # 對應真實形狀：問題敘述 + 「叫做□①甲　□②乙」，兩個框各自一個選項，
        # 沒有任何殘留在框外的字——這正是 62 次 answer=None 的那種形狀。
        txt = "這種說法叫做□①甲　□②乙"
        result = _classify_question_para(txt, "unknown", checked=[1])

        assert result["type"] == "single"
        assert result["answer"] == "乙", (
            f"answer={result['answer']!r}——不是被 None 蓋過就是撿到舊猜測，"
            "沒有讀到 checked=[1] 指到的②"
        )

    def test_falls_back_to_none_when_the_source_has_no_tick_data(self):
        """負向對照：#2735 之前這個形狀（每框恰好一個選項、框外沒有殘字）本來
        就會回 answer=None——checked 是空的時候必須維持這個（不冒充自己解得出）。
        """
        from build_lesson_schema import _classify_question_para

        txt = "這種說法叫做□①甲　□②乙"
        result = _classify_question_para(txt, "unknown", checked=[])

        assert result["answer"] is None, result

    def test_classify_block_threads_checked_into_this_path(self):
        """確認 classify_block（真正的呼叫點）有把 b['checked'] 傳進去，
        不是只有直接呼叫 `_classify_question_para` 才會用到。"""
        from build_lesson_schema import classify_block

        b = {"kind": "p", "style": "Normal",
             "text": "❶這種說法叫做□①甲　□②乙", "checked": [1]}
        result = classify_block(b, None, [b], "unknown")

        assert result["type"] == "single"
        assert result["answer"] == "乙", result


class TestCheckedBoxPositionsCountsEveryBoxGlyph:
    """第三輪 code review 抓到：`checked_box_positions` 只數 `\u25a1`（純 □），
    但 `_para_text` 會把 ⃞▢☐◻ 這幾個異體字**全部**正規化成 `□`（#2555 commit
    message 就寫了 ⃞ 出現 37 次、▢ 出現 16 次）。只數其中一種字元，會在「未勾的
    distractor 用異體字、排在真正的勾之前」時把 index 少算，指到錯的選項——
    比完全沒有這條路徑還糟（它讓錯答案看起來像是『查過真值』的，比舊的猜測
    更有信心地錯）。
    """

    def test_an_alt_glyph_distractor_before_the_tick_does_not_shift_the_index(self):
        from build_lesson_schema import checked_box_positions

        # ▢①甲（異體字，未勾）　☑②乙（真的勾，F0FE）　□③丙（純 □，未勾）
        p = _para("▢①甲　", None, "②乙　□③丙")
        assert checked_box_positions(p) == [1], checked_box_positions(p)

    def test_each_alt_glyph_individually_counts_as_a_box(self):
        from build_lesson_schema import checked_box_positions

        for glyph in "\u25a1\u20de\u25a2\u2610\u25fb":
            p = _para(f"{glyph}①甲　", None, "②乙")
            assert checked_box_positions(p) == [1], (
                f"glyph={glyph!r} (U+{ord(glyph):04X}) 沒被算進框計數，"
                f"got {checked_box_positions(p)}"
            )

    def test_positions_still_line_up_with_the_rendered_text_when_mixed(self):
        """跟既有的 `test_positions_line_up_with_the_boxes_in_the_text` 同精神，
        但混了一個異體字進去——確保正規化後 index 對到的還是文字裡對的那個 □。
        """
        from build_lesson_schema import _para_text, checked_box_positions

        p = _para("▢①甲　", None, "②乙　□③丙")
        text = _para_text(None, p)
        boxes = [i for i, ch in enumerate(text) if ch == "□"]
        assert len(boxes) == 3, f"文字裡應該有 3 個框：{text!r}"

        idx = checked_box_positions(p)
        assert idx == [1]
        start = boxes[idx[0]]
        assert text[start:start + 3] == "□②乙", text[start:start + 6]
