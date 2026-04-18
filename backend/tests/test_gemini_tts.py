"""
Tests for Gemini TTS Taiwan pronunciation corrections.
Run: pytest backend/tests/test_gemini_tts.py -v
"""
import pytest


class TestTaiwanPronunciation:
    """_apply_taiwan_pronunciation() replaces words with Taiwan-correct homophones."""

    def _apply(self, text: str) -> str:
        from app.services.tts_service import _apply_taiwan_pronunciation
        return _apply_taiwan_pronunciation(text)

    # --- Cat 1: 聲調不同 ---

    def test_垃圾_replaced(self):
        assert self._apply("倒垃圾") == "倒樂色"

    def test_研究_replaced(self):
        assert self._apply("這項研究很重要") == "這項研舊很重要"

    def test_危險_replaced(self):
        assert self._apply("非常危險") == "非常圍險"

    def test_企業_replaced(self):
        assert self._apply("大型企業") == "大型氣業"

    def test_成績_replaced(self):
        assert self._apply("成績很好") == "成基很好"

    def test_星期_replaced(self):
        assert self._apply("星期一") == "星其一"

    def test_日期_replaced(self):
        assert self._apply("繳費日期") == "繳費日其"

    def test_期待_replaced(self):
        assert self._apply("充滿期待") == "充滿其待"

    def test_期限_replaced(self):
        assert self._apply("截止期限") == "截止其限"

    def test_期間_replaced(self):
        assert self._apply("活動期間") == "活動其間"

    def test_期末_replaced(self):
        assert self._apply("期末考試") == "其末考試"

    def test_法律_replaced(self):
        assert self._apply("遵守法律") == "遵守罰律"

    def test_方法_replaced(self):
        assert self._apply("解決方法") == "解決方罰"

    def test_辦法_replaced(self):
        assert self._apply("沒有辦法") == "沒有辦罰"

    def test_微笑_replaced(self):
        assert self._apply("她微笑著") == "她圍笑著"

    def test_盡量_replaced(self):
        assert self._apply("盡量努力") == "近量努力"

    def test_盡力_replaced(self):
        assert self._apply("盡力而為") == "近力而為"

    def test_休息_replaced(self):
        assert self._apply("需要休息") == "需要休席"

    def test_暫時_replaced(self):
        assert self._apply("暫時停止") == "站時停止"

    def test_包括_replaced(self):
        assert self._apply("包括所有人") == "包刮所有人"

    def test_綜合_replaced(self):
        assert self._apply("綜合評分") == "粽合評分"

    def test_友誼_replaced(self):
        assert self._apply("真摯的友誼") == "真摯的友宜"

    def test_品質_replaced(self):
        assert self._apply("提升品質") == "提升品直"

    def test_攻擊_replaced(self):
        assert self._apply("發動攻擊") == "發動攻急"

    def test_阿姨_replaced(self):
        assert self._apply("阿姨好") == "啞姨好"

    # --- Cat 2: 聲母/韻母不同 ---

    def test_蝸牛_replaced(self):
        assert self._apply("一隻蝸牛") == "一隻瓜牛"

    def test_液體_replaced(self):
        assert self._apply("液體狀態") == "意體狀態"

    def test_堤防_replaced(self):
        assert self._apply("加固堤防") == "加固提防"

    # --- Cat 3: 多音字偏好 ---

    def test_知識_replaced(self):
        assert self._apply("增廣知識") == "增廣知是"

    def test_認識_replaced(self):
        assert self._apply("認識新朋友") == "認是新朋友"

    def test_常識_replaced(self):
        assert self._apply("生活常識") == "生活常是"

    def test_地殼_replaced(self):
        assert self._apply("地殼運動") == "地咳運動"

    def test_喝采_replaced(self):
        assert self._apply("大聲喝采") == "大聲賀采"

    def test_喝彩_replaced(self):
        assert self._apply("鼓掌喝彩") == "鼓掌賀彩"

    # --- Edge cases ---

    def test_no_match_unchanged(self):
        assert self._apply("今天天氣很好") == "今天天氣很好"

    def test_multiple_replacements_in_one_string(self):
        result = self._apply("研究成績和友誼")
        assert "研舊" in result
        assert "成基" in result
        assert "友宜" in result

    def test_empty_string(self):
        assert self._apply("") == ""

    def test_replacement_list_is_nonempty(self):
        from app.services.tts_service import _TAIWAN_TTS_REPLACEMENTS
        assert len(_TAIWAN_TTS_REPLACEMENTS) > 0


class TestCleanForGemini:
    """_clean_for_gemini() chains number conversion then pronunciation fixes."""

    def _clean(self, text: str) -> str:
        from app.services.tts_service import _clean_for_gemini
        return _clean_for_gemini(text)

    def test_pronunciation_applied_after_numbers(self):
        # Verify the pipeline runs: numbers first, then pronunciation
        result = self._clean("研究了214個案例")
        assert "研舊" in result        # pronunciation fix applied
        assert "兩百" in result        # Taiwan number style

    def test_plain_text_pronunciation_fix(self):
        result = self._clean("垃圾桶")
        assert result == "樂色桶"

    def test_number_only(self):
        result = self._clean("200")
        assert result == "兩百"

    def test_no_change_needed(self):
        result = self._clean("今天天氣晴朗")
        assert result == "今天天氣晴朗"
