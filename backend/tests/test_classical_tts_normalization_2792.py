"""文言文課文帶著教學用的標記進 TTS，那些標記會被念出來（#2792）。

`classical_text` 用 ASCII `.` 當**斷詞點**（`賈人.某，至.直隸1界`），
另有**註腳數字**貼在字中間（`直隸1界` 的 `1`）。兩者都是給眼睛看的，不是字。

⚠️ 為什麼不改共用的 `_clean_for_tts`：
`衛福部2023年` 跟 `直隸1界` 的形狀**完全一樣**（中文-數字-中文），
靠字元規則分不出註腳與年份。所以清理只掛在**文言文這個來源**上，
一般課文一個字都不動。
"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tts.normalization import (
    _clean_for_tts,
    _split_sentences,
    strip_classical_markup,
)

RAW = "賈人.某，至.直隸1界，忽.大雨2雹，伏.禾中。"


class TestClassicalMarkupNeverReachesTts:
    def test_word_break_dots_are_removed(self):
        out = strip_classical_markup(RAW)
        assert "." not in out, f"斷詞點還在，TTS 會照著停頓：{out}"

    def test_footnote_digits_glued_to_characters_are_removed(self):
        out = strip_classical_markup(RAW)
        assert not any(c.isdigit() for c in out), f"註腳數字還在，會被念出來：{out}"

    def test_the_words_themselves_survive(self):
        """正向對照：清掉標記不可以順手清掉字。

        少了這條，`return ""` 也會讓上面兩條全綠。
        """
        out = strip_classical_markup(RAW)
        for word in ("賈人", "直隸", "大雨", "禾中"):
            assert word in out, f"「{word}」被清掉了：{out}"
        assert out.startswith("賈人某"), out

    def test_punctuation_is_preserved(self):
        """逗號句號要留 —— 它們是 TTS 的停頓依據，拿掉會變一長串。"""
        out = strip_classical_markup(RAW)
        assert "，" in out and "。" in out, out


class TestOrdinaryTextIsUntouched:
    """負向對照：這個清理只掛在文言文來源，一般課文不該被碰。"""

    def test_shared_cleaner_still_keeps_real_numbers(self):
        out = _clean_for_tts("根據衛福部2023年的統計，15到24歲的死亡人數是3倍。")
        for keep in ("2023", "15", "24", "3"):
            assert keep in out, f"一般數字「{keep}」被誤刪了：{out}"

    def test_shared_cleaner_is_not_stripping_dots_globally(self):
        """`_clean_for_tts` 不該被我順手改成全域刪點 —— 那會動到所有課。"""
        assert "3.5" in _clean_for_tts("大約 3.5 公尺。")


class TestNoSentenceIsPunctuationOnly:
    def test_a_closing_quote_is_not_its_own_sentence(self):
        """斷句把結尾的「」」切成獨立一句 = 一個只有標點的合成請求。"""
        parts = _split_sentences(strip_classical_markup("聞.空中.云：「此.張不量田，勿傷.其稼。」"))
        bare = [p for p in parts if not p.strip(" 「」『』，。、！？：；")]
        assert not bare, f"有只剩標點的句子：{parts}"

    def test_real_sentences_still_come_through(self):
        """正向對照：過濾標點句不可以把真句子一起濾掉。"""
        parts = _split_sentences("今天天氣很好。我們出門散步。")
        assert len(parts) >= 2, parts
