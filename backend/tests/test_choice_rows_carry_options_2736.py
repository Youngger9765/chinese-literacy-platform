"""說「單選」卻沒有任何選項可以選 —— 20 課 / 27 列。

Young 在 `/learn/20001/keypoints-table` 看到：

    他成為再度登上奧運（單選）【　　　】的短跑項目的臺灣選手。

問：單選？？？選項呢？？？

來源是完好的。L0012 的那一列長這樣：

    label: 阿耀的問題
    prompt: 下列哪個是阿耀遇到的問題？(單選)
    options: {1: 阿耀的疑問：一定要讀書嗎？, 2: 阿耀覺得自己跟不上課程，想請教學長。}
    answer: 2

`prompt`、`options`、`answer` 三個都在，橋卻只送出題幹：

    interactive_type: fill_blank    options: None
    value: '下列哪個是阿耀遇到的問題？【 單選 】'

⚠️ 這一族今天修過一半：`options` 是 **list** 的情況已經接好了，
**dict** 的沒有。同一個缺口的兩個形狀，修了看得見的那個。

分成兩類，各自要有自己的答案
----------------------------
27 列裡：

  9 列  選項就寫在 `value` 裡（`①體力不足 ②肌肉強度不足…`），只是沒被切成 options
 18 列  `value` 裡也沒有 —— 要回頭查來源，**不可以直接判成「教材沒印」**
        （L0012 就是這樣：來源好好的，是橋漏了）
"""
from __future__ import annotations

import pathlib
import re
import sys

import pytest
import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.routes.stories import (  # noqa: E402
    _format_yaml_structure_table,
    _sanitize_structure_for_client,
)
from app.services.keypoints_to_structure import keypoints_to_structure_table  # noqa: E402

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"
INSTRUCTION = ("單選", "多選", "複選", "勾選", "打勾")
MIN_SCANNED = 100

def _known_gap_lessons() -> set[str]:
    """來源真的沒有選項的課 —— 修法不在我方 code。

    ⛔ 這份名單**不是免死金牌**。進來之前要先證明來源真的沒有：
    L0012 一度看起來也像「教材沒印」，實際上 `options` 好好躺在 yml 裡，
    是橋沒接。20 課裡有 19 課是這種。

    名單存在 `data/curriculum_qa/content_known_gaps.yaml`，每一筆都要寫
    `answer_carrier`（憑什麼說來源沒有）。
    """
    doc = yaml.safe_load(
        (pathlib.Path(__file__).resolve().parent.parent
         / "data" / "curriculum_qa" / "content_known_gaps.yaml").read_text(encoding="utf-8")
    ) or {}
    entry = doc.get("choice_rows_without_options") or {}
    return {str(l.get("lesson_uid")) for l in (entry.get("lessons") or [])}


_KNOWN_GAPS = _known_gap_lessons()


def _walk(rows):
    for row in rows or []:
        yield row
        yield from _walk(row.get("sub_rows"))


def _served():
    scanned = 0
    for d in sorted(LESSONS.iterdir()):
        f = d / "v3" / "keypoints.yml"
        if not (d.is_dir() and d.name.startswith("L") and f.exists()):
            continue
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        try:
            table = keypoints_to_structure_table(doc.get("keypoints") or {})
        except Exception:
            continue
        if not table:
            continue
        scanned += 1
        yield d.name, _sanitize_structure_for_client(_format_yaml_structure_table(table))
    if scanned < MIN_SCANNED:
        pytest.fail(f"只掃到 {scanned} 課（下限 {MIN_SCANNED}）—— 這條在測空氣")


def test_a_row_that_says_choose_offers_something_to_choose():
    """自稱選擇題的列，一定要有選項可選。

    沒有選項的選擇題，學生**做不了那一題**，而且畫面上沒有任何錯誤 ——
    它看起來就只是一個沒填的空格。
    """
    naked = []
    for uid, served in _served():
        rows = list(_walk(served.get("rows")))
        for i, row in enumerate(rows):
            value = str(row.get("value") or "")
            if not any(w in value for w in INSTRUCTION):
                continue
            if row.get("options"):
                continue
            # 圈號寫在 value 裡也算「看得到選項」（雖然不是理想形狀）
            if len(re.findall(r"[①②③④⑤⑥⑦⑧⑨⑩]", value)) >= 2:
                continue
            # 行內選擇（句子中間的「（　）」）會展開成緊接著的子列：
            #     結果    「結果，小戴【　】球賽，卻【　】全國人民的尊敬。」【單選】
            #     結果-1  ①贏了 ②輸了
            #     結果-2  ①贏得 ②失去
            # 題幹那一列本身沒有 options —— 選項在它後面。
            # 第一版斷言要求「同一列要有 options」，把這個正確的形狀判成缺陷。
            label = str(row.get("label") or "")
            if label and any(
                str(r.get("label") or "").startswith(f"{label}-") and r.get("options")
                for r in rows[i + 1: i + 6]
            ):
                continue
            if uid in _KNOWN_GAPS:
                continue
            naked.append((uid, row.get("interactive_type"), value[:44]))
    assert not naked, (
        f"{len({n[0] for n in naked})} 課 / {len(naked)} 列說要選，卻沒有東西可選：\n"
        + "\n".join(f"  {u} [{t}] {v!r}" for u, t, v in naked[:10])
    )


def test_dict_shaped_options_survive_the_bridge():
    """`options` 是 dict 的形狀要跟 list 一樣接得住。

    L0012 的來源 `options: {1: ..., 2: ...}` 完好，橋卻回 `options: None`。
    今天已經接好 list 那個形狀 —— 同一個缺口的兩個形狀，只修了看得見的那個。
    """
    doc = yaml.safe_load((LESSONS / "L0012" / "v3" / "keypoints.yml").read_text(encoding="utf-8"))
    kp = doc.get("keypoints") or {}
    src = kp["rows"][0]
    assert isinstance(src.get("options"), dict), "來源形狀變了，這條在測別的東西"

    served = _sanitize_structure_for_client(
        _format_yaml_structure_table(keypoints_to_structure_table(kp))
    )
    row = next((r for r in _walk(served.get("rows")) if "阿耀的問題" == r.get("label")), None)
    assert row is not None, "找不到那一列"
    assert row.get("options"), f"選項沒送出去：{row!r}"
    assert len(row["options"]) == len(src["options"])


def test_the_answer_still_never_reaches_the_student():
    """正向對照：補上選項不可以順手把答案也送出去。"""
    import json

    leaked = []
    for uid, served in _served():
        blob = json.dumps(served, ensure_ascii=False)
        for key in ('"answer"', '"correct_options"', '"correct_answer"'):
            if key in blob:
                leaked.append((uid, key))
    assert not leaked, (
        f"{len({l[0] for l in leaked})} 課的學生端 payload 帶答案：{leaked[:6]}"
    )
