"""出貨字型是「台灣讀音」的權威 —— 換字型不可以把台灣音換成大陸音。

## 為什麼需要這條鎖

這個 repo 花了很大力氣處理「聲音唸出大陸音」的問題：
`backend/data/tts/taiwan_pronunciation.json`（2026-08-10，#2612／#2649）是
「jieba 斷詞 → 教育部注音 vs pypinyin(大陸) 比對聲韻」生成的 198 列修正表，
起因是 Hans 回報「攻擊／嘆息」唸成大陸音。

**但那件事其實已經被出貨的字型解決了，只是沒人知道。**
`BpmfZihiSerif-Regular.ttf` 的變體字符是複合字符，第一個元件叫 `z_<拼音><聲調>`，
而它收的是**台灣讀音**。實測（2026-09-12）13 個經典的兩岸差異字，
**12 個字型收台灣音，而且多半只收台灣音**；pypinyin 則是 13/13 全給大陸音。

所以這條鎖守的是：**有人換字型時，不可以把台灣音換掉**。
字型是整個注音顯示的讀音真值（見 `backend/scripts/extract_font_readings.py`），
它一換成大陸讀音的字型，全站注音就默默錯了，而且沒有任何其他測試看得到。

## ⚠️ 這條鎖不是在驗「教育部說什麼」

它驗的是**我們出貨的字型說什麼**。教育部辭典是 CC BY-ND，不進這個 repo；
下面每個讀音的依據是「字型的 glyph 元件名」加上 Young 2026-09-12 的人工確認。
"""
import importlib.util
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
FONT = REPO / "frontend" / "public" / "fonts" / "BpmfZihiSerif-Regular.ttf"
EXTRACTOR = REPO / "backend" / "scripts" / "extract_font_readings.py"


@pytest.fixture(scope="module")
def readings():
    assert FONT.exists(), f"出貨字型不在 {FONT} —— 路徑改了就要改這條鎖"
    spec = importlib.util.spec_from_file_location("efr", EXTRACTOR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.build_reading_table(str(FONT))


# (字, 台灣音, 大陸音, 詞例) —— 台灣音一欄由 Young 2026-09-12 確認
TAIWAN_VS_MAINLAND = [
    ("和", "han4", "he2", "你和我（連接詞）"),
    ("期", "qi2", "qi1", "星期"),
    ("血", "xie3", "xue4", "血液"),
    ("髮", "fa3", "fa4", "頭髮"),
    ("究", "jiu4", "jiu1", "研究"),
    ("息", "xi2", "xi1", "休息"),
    ("擊", "ji2", "ji1", "攻擊"),
    ("危", "wei2", "wei1", "危險"),
    ("誼", "yi4", "yi2", "友誼"),
    ("蝸", "gua1", "wo1", "蝸牛"),
    ("企", "qi4", "qi3", "企業"),
    ("攜", "xi1", "xie2", "攜帶"),
]

# 字型**沒有**台灣音的字 —— 誠實記著，不要讓它們靜靜消失
KNOWN_FONT_GAPS = [
    ("液", "yi4", "ye4", "液體 —— 字型只有大陸音 ye4"),
    ("癌", "yan2", "ai2", "癌症 —— 字型只有 ai2；Young 2026-09-12 裁定台灣音是 ㄧㄢˊ（癌=言）"),
]

# `taiwan_pronunciation.json` 收錯的兩列 —— 字型是對的，表是錯的
# Young 2026-09-12 裁定：蛻=退、蠕=如。表收的是古音／又音。
TABLE_IS_WRONG_FONT_IS_RIGHT = [
    ("蛻", "tui4", "shui4", "蛻變 —— 表說 shui4（古音），字型 tui4 才對"),
    ("蠕", "ru2", "ruan3", "蠕動 —— 表說 ruan3（又音），字型 ru2 才對"),
]


@pytest.mark.parametrize("ch,tw,cn,word", TAIWAN_VS_MAINLAND)
def test_font_carries_the_taiwan_reading(readings, ch, tw, cn, word):
    """⭐ 核心：這 12 個字，字型必須收台灣音。"""
    slots = readings.get(ch, {})
    assert slots, f"字型裡查不到「{ch}」—— 換字型了嗎？"
    assert tw in slots.values(), (
        f"「{ch}」（{word}）台灣音是 {tw}，但出貨字型只有 {sorted(slots.values())}。"
        f" 換到大陸讀音的字型會讓全站注音默默變錯 —— 這正是這條鎖存在的理由。"
    )


@pytest.mark.parametrize("ch,tw,cn,why", KNOWN_FONT_GAPS)
def test_known_font_gaps_stay_visible(readings, ch, tw, cn, why):
    """字型缺的那兩個，明確記著。

    這條**故意斷言「字型沒有台灣音」** —— 哪天字型補上了，這條會紅，
    那是好消息，改成上面那組即可。⛔ 不要因為它紅就刪掉它。
    """
    slots = readings.get(ch, {})
    assert slots, f"字型裡查不到「{ch}」"
    assert tw not in slots.values(), (
        f"好消息：「{ch}」的台灣音 {tw} 已經進字型了（{why}）。"
        f" 請把它從 KNOWN_FONT_GAPS 移到 TAIWAN_VS_MAINLAND。"
    )


@pytest.mark.parametrize("ch,right,table_says,why", TABLE_IS_WRONG_FONT_IS_RIGHT)
def test_font_beats_the_tts_table_on_these(readings, ch, right, table_says, why):
    """⚠️ 這兩個字，`taiwan_pronunciation.json` 是錯的、字型是對的。

    沒有這條，將來有人看到兩邊不一致，會反過來「修正」字型去配合那張表 ——
    那就是把對的改成錯的。這個 repo 已經這樣錯過一次（#3177：#219 把對的
    行／著 改成錯的，然後 44 條測試綠著鎖住錯信念半年）。
    """
    slots = readings.get(ch, {})
    assert slots, f"字型裡查不到「{ch}」"
    vals = set(slots.values())
    assert right in vals, f"「{ch}」應為 {right}（{why}），字型只有 {sorted(vals)}"
    assert table_says not in vals, (
        f"「{ch}」字型出現了 {table_says} —— 那是 taiwan_pronunciation.json 收的古音／又音。"
        f" 字型若真的改了，要重新裁定，不可以直接照那張表。"
    )


def test_pypinyin_would_get_these_wrong(readings):
    """正向對照：證明上面那 12 條不是恆真。

    如果讀音來源換成 pypinyin，這 12 個字**全部**會變成大陸音。
    這條同時記錄了「為什麼不能用 pypinyin 當讀音來源」。
    """
    from pypinyin import Style, lazy_pinyin

    mainland_hits = 0
    for ch, tw, cn, _ in TAIWAN_VS_MAINLAND:
        got = lazy_pinyin(ch, style=Style.TONE3, neutral_tone_with_five=True)[0]
        if got == cn:
            mainland_hits += 1
    assert mainland_hits >= 10, (
        f"pypinyin 只在 {mainland_hits}/12 個字上給大陸音 —— 這條對照失效了，"
        f" 可能是 pypinyin 改版。要重新確認「不用 pypinyin 當讀音來源」的理由是否仍成立。"
    )
