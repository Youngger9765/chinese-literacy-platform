"""每一課自己的流暢率門檻要送到前端（#2722 的東西，#2964 發現整批不見）。

## 現象

`reading_benchmark` 在 175 課裡**全部是 None**（prod 也是），
於是 `getThresholdsFromBenchmark()` 每一課都退回年級預設值 ——
而每一份學習單上都印著它自己的門檻表。那正是 #2722 修掉的事。

## 根因

key_reading 的 yml 裡欄位叫 **`benchmark`**：

    benchmark:
      - {threshold: '＜220字', feedback: '還要多加練習。'}
      - {threshold: '221~250字', feedback: '...'}

而 row 讀的是 `key_reading.reading_benchmark` —— 名字對不上，永遠 None。
160 份 key_reading 檔裡 154 份有 `benchmark`。

⭐ 形狀是對的：前端 `parseCpmBenchmark()` 收的就是 `{threshold, feedback}[]`。
   所以斷點只在名字，不需要轉換。
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

_LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"


def test_the_source_files_carry_a_benchmark():
    """正向對照 —— 少了它，來源本來就沒有時下面也會綠。"""
    import yaml
    n = 0
    for f in _LESSONS.glob("L*/v3/key_reading.*.yml"):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        inner = d.get("key_reading") or d
        if inner.get("benchmark"):
            n += 1
    assert n >= 100, f"只有 {n} 份 key_reading 帶 benchmark —— 這條在測空氣"


def test_the_benchmark_reaches_the_row():
    """⭐ 送到消費端的欄位要有值，否則每一課都退回年級預設。"""
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    assert len(lessons) >= 150, f"只讀到 {len(lessons)} 課"
    with_b = [l for l in lessons if l.get("reading_benchmark")]
    assert len(with_b) >= 100, (
        f"只有 {len(with_b)} 課的 reading_benchmark 有值，"
        f"而磁碟上有 100+ 份 key_reading 帶 benchmark。\n"
        "抽對了、寫進去了、消費端讀不到 —— 每一課的門檻都退回年級預設（#2722 regress）。")


def test_the_shape_is_what_the_parser_expects():
    """形狀要是 `{threshold, feedback}[]` —— 前端 parseCpmBenchmark 收這個。

    少了這條，把別的東西塞進去也會讓上面那條綠。
    """
    from app.services.lesson_loader import get_all_lessons

    sample = next(l for l in get_all_lessons() if l.get("reading_benchmark"))
    b = sample["reading_benchmark"]
    # ⛔ API schema 要的是 {levels: [...]}，不是裸 list —— 傳 list 會讓
    #    141/175 課的 detail 驗證失敗，學生打開就是 500。
    assert isinstance(b, dict) and b.get("levels"), f"不是 {{levels: [...]}}：{type(b).__name__}"
    first = b["levels"][0]
    assert isinstance(first, dict) and "threshold" in first, (
        f"第一筆沒有 threshold：{first!r} —— 前端的 parser 讀不懂")
