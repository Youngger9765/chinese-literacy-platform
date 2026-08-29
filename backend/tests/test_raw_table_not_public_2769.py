"""未消毒的原始表格躺在公開端點裡 —— 148 課的答案。

2026-08-19 全面 QA 抽樣 12 課，7 課的 `/api/stories/{id}` 回應含 `□①`。
追下去發現是 `story_structure_table` —— docx parser 的原始 list-of-lists，
**沒有經過任何消毒**：

    ["事例", "背景", "這個故事發生的情境？(多選，請打勾)\\n①奧運金牌賽 □②世界大學運動會 …"]
    ["球風", "主動出擊，追求完美的【邊角球】和【難以預測】的穿越角度。"]

干擾項 `□②`（= 這個選項是錯的）跟未挖空的答案 `【邊角球】` 都在。
全庫：**51 課有干擾項、148 課有未挖空答案。**

今天修過六次答案洩漏，每次走不同路徑：`correct_options` 欄位、`□①` 在 rows、
`□①` 在 worksheet_rows、沒挖空的 `【答案】`、配對題 A–H、排序題名次、小語老師。
這是第七條 —— 而它一直都在，我只是沒往這個欄位看。

⚠️ **前端沒有用它**（只有管理員的 story-structure-lab 讀），所以學生不會在畫面上
看到。但它在公開回應裡，開 devtools 就有。「畫面上看不到」不是「沒有洩漏」。
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import inspect  # noqa: E402

from app.routes import stories as stories_route  # noqa: E402
from app.services.lesson_loader import search_lessons  # noqa: E402

DISTRACTOR = re.compile(r"[□■▢]\s*[①②③④⑤⑥⑦⑧⑨⑩]")
BLANK = re.compile(r"【([^】]*)】")
INSTRUCTION = ("單選", "多選", "複選", "勾選", "打勾")


def _tables():
    """**送出去的**表格，不是內部資料。

    ⚠️ 第一版讀 `search_lessons()` —— 那是消毒**前**的內部形狀，
    所以修好之後測試照樣紅。今天第三次犯這個。

    ⚠️ 第二版自己呼叫消毒器 —— 那在測那個函式，不是測 route 有沒有用它。
    把 route 那行接線拿掉，測試照樣綠（mutation 證實）。所以另外有一條
    `test_the_route_actually_calls_the_sanitiser` 直接讀 route 原始碼，
    那條才是接線鎖。
    """
    n = 0
    for l in search_lessons():
        t = l.get("story_structure_table")
        if t:
            n += 1
            served = stories_route._sanitize_raw_table_for_client(t)
            yield l.get("lesson_uid"), json.dumps(served, ensure_ascii=False)
    assert n >= 100, f"只找到 {n} 課有原始表格 —— 這條在測空氣"


def test_no_distractor_marks_in_the_public_payload():
    """`□①` 是「這個選項是錯的」。放進公開回應等於把答案標出來。"""
    bad = [(uid, DISTRACTOR.search(s).group(0)) for uid, s in _tables() if DISTRACTOR.search(s)]
    assert not bad, (
        f"{len(bad)} 課的 story_structure_table 帶干擾項標記：{[b[0] for b in bad[:8]]}"
    )


def test_no_unblanked_answers_in_the_public_payload():
    """`【邊角球】` 是答案，公開回應裡該是 `【　　　】`。

    作答指示（`【單選】`）保留 —— 學生要知道勾幾個，那不是答案。
    """
    bad = []
    for uid, s in _tables():
        for m in BLANK.finditer(s):
            inner = m.group(1).strip()
            if not inner or inner == "　　　":
                continue
            if any(w in inner for w in INSTRUCTION):
                continue
            bad.append((uid, inner[:16]))
            break
    assert not bad, (
        f"{len(bad)} 課的 story_structure_table 帶未挖空答案：\n"
        + "\n".join(f"  {u} 【{v}】" for u, v in bad[:8])
    )


def test_the_instruction_survives():
    """正向對照：消毒不可以把作答指示也挖掉（學生要知道勾幾個）。"""
    kept = sum(1 for _, s in _tables() if any(w in s for w in INSTRUCTION))
    assert kept >= 20, f"只有 {kept} 課還看得到作答指示 —— 消毒過頭了"


def test_the_route_actually_calls_the_sanitiser():
    """接線鎖：`/api/stories/{id}` 真的有把原始表格送去消毒。

    ⚠️ 上面那幾條自己呼叫消毒器，所以它們只證明**消毒器**是對的 ——
    把 route 那行接線拿掉，它們照樣全綠（2026-08-19 mutation 證實）。
    一條只驗函式、不驗有沒有被呼叫的鎖，擋不住「函式在、沒人用」。

    這裡讀 route 的原始碼：`story_structure_table=` 那個參數必須是
    消毒器的呼叫，不是 `story.get(...)`。
    """
    src = inspect.getsource(stories_route)
    i = src.index("story_structure_table=")
    snippet = src[i: i + 120]
    assert "_sanitize_raw_table_for_client" in snippet, (
        f"route 沒有消毒就送出原始表格：{snippet.splitlines()[0]!r}"
    )
