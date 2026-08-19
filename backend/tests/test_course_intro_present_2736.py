"""課程簡介整頁空白 —— 全部 175 課。

Young 2026-08-19 打開 `/learn/20001/lesson-intro`：

    這篇課文目前沒有簡介資料。

> ??????? 為什麼啊？？？？？之前不是有給過嗎？？

有過。`scripts/_archive/generate_course_intros.py` 用 Gemini 從課文生，
寫進一修產物 `_parsed_2026-05-01/*.yml`。那個目錄在二修重抽時整個刪掉，
簡介跟著沒了 —— **而抽取本身不產簡介**：學習單上沒有這段文字，它從來就是我們生的。
總表也沒有這個欄位（`1.總表` 23 欄查過）。所以它不會自己回來。

2026-08-19 用 `scripts/generate_course_intros_v3.py` 重生，寫進
`metadata.yml` 的 `intro`（服務層 `_meta(l)["intro"]` 讀的就是它）。

⚠️ 第一版只讀 `full_text_annotate.yml`，於是文言文那 10 課全部回報「沒有課文」。
它們的正文在 `classical_text.yml`。**一個工具只認一種來源，就會把另一種說成不存在。**
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.lesson_loader import search_lessons  # noqa: E402

# 只能下降。L0136 沒有任何正文檔可以生 —— 憑課名編一段出來是把猜測寫進教材。
MAX_LESSONS_WITHOUT_INTRO = 1


def test_almost_every_lesson_has_an_intro():
    lessons = search_lessons()
    assert len(lessons) >= 150, f"只讀到 {len(lessons)} 課 —— 這條在測空氣"
    missing = [l.get("lesson_uid") for l in lessons
               if not (l.get("intro") or {}).get("background")]
    assert len(missing) <= MAX_LESSONS_WITHOUT_INTRO, (
        f"{len(missing)} 課沒有簡介（上限 {MAX_LESSONS_WITHOUT_INTRO}）：{missing[:10]}"
    )


def test_intros_are_the_right_length():
    """150–250 字是 prompt 的要求。差太多通常代表模型回了別的東西。"""
    bad = []
    for l in search_lessons():
        text = (l.get("intro") or {}).get("background") or ""
        if text and not (100 <= len(text) <= 400):
            bad.append((l.get("lesson_uid"), len(text)))
    assert not bad, f"{len(bad)} 課的簡介長度不合理：{bad[:8]}"


def test_intros_do_not_leak_the_strategy_explanation():
    """簡介不可以寫成「這一課用 XX 策略」——那是 #1598 走查時明確排除的。

    正向對照：這條若連一課都掃不到就是在測空氣，所以先確認有簡介可掃。
    """
    lessons = [l for l in search_lessons() if (l.get("intro") or {}).get("background")]
    assert len(lessons) >= 150, f"只有 {len(lessons)} 課有簡介 —— 這條在測空氣"
    leaked = [
        l.get("lesson_uid") for l in lessons
        if any(p in (l["intro"]["background"] or "")
               for p in ("這一課用", "本課使用", "閱讀策略是", "你會學到"))
    ]
    assert not leaked, f"{len(leaked)} 課的簡介寫成了策略說明或學習目標：{leaked[:6]}"
