"""回歸測試：寶貝命名白名單（2026-10-26 security review 要求）。

跑法：
    cd docs/design/word-babies && python3 -m pytest test_name_filter.py -v

這支測試鎖住兩件事：
1. 一組「已知不適合當寶貝名字」的詞（含『3 字以上成語裡剛好有一個白名單字，
   但整體語意負面/沉重/不恰當』的具體案例）全部要被擋下——這就是本輪修掉的
   那個漏洞：原本規則是「整詞含一個白名單字就放行」，會讓這類詞溜過去。
2. 一組「已核准的正向/中性詞」要全部通過——確保修嚴規則沒有連好詞也一起擋掉
   （過猶不及：規則改錯方向，100 隻湊不滿也是一種失敗）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_config import _is_suitable_as_pet_name  # noqa: E402


# ── 已知不適合的詞：全部必須被擋下 ──────────────────────────────────────────
# 分兩類：(a) 黑名單字元/詞直接擋（舊規則就擋得住）
#         (b) 3 字以上、只靠「整詞含一個白名單字」才會誤放行的案例
#             （這批才是這次修的漏洞——驗證「含一個字」不再等於「整詞過」）
KNOWN_BAD_NAMES = [
    # (a) 黑名單字元/詞
    "深淵", "孤立無援", "軟禁", "凶多吉少", "擊垮", "茫然", "懈怠", "沮喪",
    "絕望", "憤怒", "墮落", "腐敗", "恐怖", "驚嚇", "悲慘", "痛苦",
    "不可收拾", "不堪設想", "人心惶惶", "危機四伏", "力不從心", "功敗垂成",
    # (b) 3 字以上只含一個白名單字、整體語意負面/沉重/不適合當名字的案例
    "哀鴻遍野",   # 含「野」（NATURE_CHARS）——整詞是「災民遍野」的慘況
    "杳無人煙",   # 含「人」不在白名單但曾經靠别的字誤放行；此處驗證整詞命中後必須擋
    "暗無天日",   # 含「日」（NATURE_CHARS）——整詞是「暗無天日、沒有公理」
    "老態龍鍾",   # 含「龍」（NATURE_CHARS）——整詞是「年老體衰、步履蹣跚」
    "虎視眈眈",   # 含「虎」（NATURE_CHARS）——整詞是「心懷不軌地盯著」
    "覆水難收",   # 含「水」（NATURE_CHARS）——整詞是「無法挽回的後悔」
    "雪上加霜",   # 含「雪」「霜」（NATURE_CHARS）——整詞是「情況更加惡化」
    "殃及池魚",   # 含「魚」（NATURE_CHARS）——整詞是「無辜受牽連」
    "羊入虎口",   # 含「虎」（NATURE_CHARS）——整詞是「自投危險」
    "脫韁野馬",   # 含「野」（NATURE_CHARS）——整詞是「失控、難以約束」
    "負成長",     # 含「成」（曾落在 QUALITY_WORDS 的「成功」子字串誤判範圍）——整詞是經濟衰退
    "跟風起鬨",   # 含「風」（NATURE_CHARS）——整詞是盲目跟從、起鬧事
    "雜草叢生",   # 含「草」（NATURE_CHARS）——整詞是荒廢、沒人打理的畫面
    "粉墨登場",   # 含「墨」（OBJECT_CHARS）——常用於貶義，形容壞人粉飾登場
]


# ── 已核准的正向/中性詞：全部必須通過（避免規則改過頭） ───────────────────
KNOWN_GOOD_NAMES = [
    # 2 字，靠單字規則
    "甦醒", "孵化", "蛻變", "輝煌", "精準", "靈敏",
    # 3 字以上，整詞命中 QUALITY_WORDS / ACTION_WORDS
    "名列前茅", "脫穎而出", "迎刃而解", "兩全其美", "自立自強", "有條不紊",
    "一勞永逸", "伴手禮", "如魚得水", "耳目一新", "靈機一動", "鼎力相助",
]


def test_known_bad_names_are_all_rejected():
    failures = [w for w in KNOWN_BAD_NAMES if _is_suitable_as_pet_name(w)]
    assert failures == [], (
        f"這些已知不適合的詞沒有被擋下，白名單規則有漏洞：{failures}"
    )


def test_known_good_names_are_all_accepted():
    failures = [w for w in KNOWN_GOOD_NAMES if not _is_suitable_as_pet_name(w)]
    assert failures == [], (
        f"這些已核准的正向/中性詞被誤擋，規則可能改過頭：{failures}"
    )


def test_three_plus_char_word_needs_exact_whitelist_hit_not_substring():
    """直接驗證這次修的漏洞本身：含白名單字但整詞不在核准清單裡的 3+ 字詞必須被擋。

    這裡刻意組一個「真的只含一個白名單字、其餘完全不相干」的合成詞，
    確定不會因為它剛好也是某個已知壞詞而被 KNOWN_BAD_NAMES 覆蓋到。
    """
    # 「風」在 NATURE_CHARS 裡；「暴走」在舊規則下會被「風」這個字通過，
    # 但「風暴走」整詞不在 QUALITY_WORDS/ACTION_WORDS 裡，新規則必須擋下。
    synthetic_word = "風暴走"
    assert len(synthetic_word) == 3
    assert "風" in __import__("generate_config").NATURE_CHARS
    assert synthetic_word not in __import__("generate_config").QUALITY_WORDS
    assert synthetic_word not in __import__("generate_config").ACTION_WORDS
    assert _is_suitable_as_pet_name(synthetic_word) is False


def test_two_char_word_single_character_rule_still_applies():
    """2 字詞的單字規則沒有被誤改掉——只要有一個字在白名單裡就該放行。"""
    # 「晶」不在任何白名單字元集合裡，但「瑩」也沒特別列入；用一個明確案例：
    # 「山」在 NATURE_CHARS，「山丘」整詞不在 QUALITY_WORDS，但 2 字詞應該靠單字過。
    assert _is_suitable_as_pet_name("山丘") is True


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
