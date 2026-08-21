"""文言文 10 課的 TTS mapping 是空的，所以它們的朗讀永遠冷合成（#2792）。

`build_lesson_tts_mapping` 只讀 `paragraphs`。文言文那批的 `paragraphs` 是空的，
內容全在 `classical_text.paragraphs`（282～817 字）—— 於是 `/api/tts/mapping/{id}`
回 0 句。

連帶：預熱腳本從 mapping 列舉要預熱的句子，**所以這 10 課從來不在預熱範圍內**，
每次點「AI 朗讀」都是冷合成（約 1.9 秒，就是 #2764 修掉的那個症狀）。

前端的選段邏輯已經有 classical_text 的 fallback（`readingPassagesOf`），
所以學生看得到文章 —— 看得到卻預熱不到，只有這一半沒補。
"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lesson_loader import get_all_lessons
from app.services.tts.lesson_mapping import build_lesson_tts_mapping


def _sentence_count(lesson: dict) -> int:
    m = build_lesson_tts_mapping(lesson)
    return sum(len(p["sentences"]) for p in m.get("paragraphs", []))


def test_a_lesson_whose_text_is_classical_still_gets_a_mapping():
    """有 classical_text 就該有句子可預熱。

    下限在前面：掃不到任何文言文課時，「0 個違規」也會綠。
    """
    lessons = get_all_lessons()
    assert len(lessons) >= 100, f"只載到 {len(lessons)} 課 —— 這條在測空氣"

    classical = [
        x for x in lessons
        if (x.get("classical_text") or {}).get("paragraphs")
    ]
    assert len(classical) >= 5, (
        f"只找到 {len(classical)} 課有 classical_text —— 這條在測空氣，不是資料變乾淨了"
    )

    empty = [
        (x["id"], (x.get("title") or "")[:14])
        for x in classical
        if _sentence_count(x) == 0
    ]
    assert not empty, (
        f"{len(empty)} 課有文言文本文但 TTS mapping 回 0 句 —— "
        f"它們永遠不會被預熱，每次朗讀都是冷合成：\n"
        + "\n".join(f"  {i} {t}" for i, t in empty)
    )


def test_lessons_with_ordinary_paragraphs_are_unchanged():
    """正向對照：一般課文的句數不可以因為這個改動而變。

    少了這條，把 classical 的句子灌進所有課也會讓上面那條變綠。
    """
    lessons = get_all_lessons()
    ordinary = [x for x in lessons if x.get("paragraphs") and not (x.get("classical_text") or {}).get("paragraphs")]
    assert len(ordinary) >= 100, f"只找到 {len(ordinary)} 課一般課文 —— 對照失效"
    assert all(_sentence_count(x) > 0 for x in ordinary[:30]), "一般課文本來就該有句子"
