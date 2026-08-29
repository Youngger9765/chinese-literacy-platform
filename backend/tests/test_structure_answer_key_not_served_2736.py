"""答案鑰匙不可以出現在學生拿到的那份結構裡。

為什麼是白名單不是黑名單
------------------------
第一版的消毒器寫成 `if k not in ("hint", "blank_hints")` —— 一份**黑名單**。
`correct_options` 從來沒被列進去，於是 41 課、104 個 checkbox 的正解索引
就跟著題目一起送到瀏覽器；學生打開 devtools 的 network 就看得到。

黑名單的問題不在於漏了這一個，而在於**它預設放行**：下次再多一個
`answer_key` / `expected` / `solution`，一樣會靜默送出去，而且不會有人發現。

所以這裡改成問相反的問題：**這個欄位有沒有被明確允許送給學生？**
沒有就紅。新欄位預設是失敗，要送出去得有人主動把它加進白名單 ——
那一刻他必須想一次「這個能給學生看嗎」。

⚠️ 判分仍然需要 `correct_options`。它留在**伺服器端的快取**裡
（`_get_cached_structure`），只是不再放進回應。這份測試同時鎖住那一半：
拿掉之後判分還要能算對，否則就是把洩題換成功能壞掉。
"""

from __future__ import annotations

import pathlib
from _module_files import module_file, module_files
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

# 學生看得到的 row 允許帶的欄位。**加東西進來之前先回答「這個能給學生看嗎」。**
ALLOWED_ROW_KEYS = {
    "label",             # 這一列的標題
    "value",             # 題幹／內容（填空已被挖成【　　　】）
    "interactive_type",  # 要畫成填空還是勾選
    "options",           # 選項文字（不含哪個是對的）
    "sub_rows",          # 巢狀小題
    "blank_in_label",    # 空格在標題裡還是在內容裡
    "select_mode",       # "single"/"multi" —— 純粹的作答方式提示，不是答案（#2776）
    "blanks",            # inline_choice 每個空格自己的選項（不含 correct_option，#2776）
}

# 掃不到課的時候 `0 個違規` 也會綠。這個下限讓那種情況講實話。
MIN_LESSONS_SCANNED = 100


def _walk(rows):
    for row in rows or []:
        yield row
        yield from _walk(row.get("sub_rows"))


def _served_rows():
    """走完整條學生路徑：橋 → formatter → 消毒器。"""
    scanned = 0
    for d in sorted(LESSONS.iterdir()):
        f = module_file(d / "v3", "keypoints")
        if not (d.is_dir() and d.name.startswith("L") and f):
            continue
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        try:
            table = keypoints_to_structure_table(doc.get("keypoints") or {})
        except Exception:
            continue
        if not table:
            continue
        served = _sanitize_structure_for_client(_format_yaml_structure_table(table))
        scanned += 1
        for row in _walk(served.get("rows")):
            yield d.name, row
    if scanned < MIN_LESSONS_SCANNED:
        pytest.fail(
            f"只掃到 {scanned} 課，少於下限 {MIN_LESSONS_SCANNED} —— "
            "這代表這支測試沒掃到課，不是答案不見了"
        )


def test_no_unapproved_field_reaches_the_student():
    """每個送到學生端的欄位都必須是明確允許的。"""
    bad: dict[str, set[str]] = {}
    for uid, row in _served_rows():
        for key in row:
            if key not in ALLOWED_ROW_KEYS:
                bad.setdefault(key, set()).add(uid)

    assert not bad, (
        "以下欄位送到了學生端但不在白名單上：\n"
        + "\n".join(
            f"  {k}：{len(v)} 課（{', '.join(sorted(v)[:6])}…）"
            for k, v in sorted(bad.items())
        )
        + "\n如果它真的該給學生看，把它加進 ALLOWED_ROW_KEYS 並說明為什麼；"
        "否則從 _sanitize_row_for_client 拿掉。"
    )


def test_whitelist_catches_a_field_it_has_never_seen():
    """負向對照：捏一個新的答案欄位，白名單必須抓得到。

    少了這條，上面那條在「白名單意外變成放行全部」時也會綠。
    """
    fabricated = {"label": "x", "value": "y", "interactive_type": "checkbox", "answer_key": [1]}
    leaked = [k for k in fabricated if k not in ALLOWED_ROW_KEYS]
    assert leaked == ["answer_key"], "白名單認不出沒見過的答案欄位"


def test_a_clean_row_is_not_flagged():
    """正向對照：正常的 row 不可以被誤判。"""
    clean = {"label": "x", "value": "y", "interactive_type": "fill_blank", "options": []}
    assert [k for k in clean if k not in ALLOWED_ROW_KEYS] == []


def test_grading_still_has_the_answers_it_needs():
    """拿掉之後判分不能壞：正解要留在**伺服器端**的結構裡。

    消毒器只作用在回應上；快取（`_get_cached_structure` 存的那份）必須原封不動，
    否則就是把洩題換成「全部答錯」。
    """
    sample = None
    for d in sorted(LESSONS.iterdir()):
        f = module_file(d / "v3", "keypoints")
        if not (d.is_dir() and d.name.startswith("L") and f):
            continue
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        try:
            table = keypoints_to_structure_table(doc.get("keypoints") or {})
        except Exception:
            continue
        if not table:
            continue
        server_side = _format_yaml_structure_table(table)
        if any("correct_options" in r for r in _walk(server_side.get("rows"))):
            sample = (d.name, server_side)
            break

    assert sample is not None, (
        "整個語料庫都找不到帶 correct_options 的 checkbox —— "
        "要嘛是資料變了，要嘛是這支測試沒在測它以為在測的東西"
    )
    uid, server_side = sample
    n = sum(1 for r in _walk(server_side.get("rows")) if "correct_options" in r)
    assert n > 0, f"{uid}：伺服器端結構沒有 correct_options，判分會全部算錯"


def test_inline_choice_blank_options_but_not_correct_option():
    """`blanks[]` 是巢狀的，上面那條逐 key 掃描的白名單看不進去。

    `correct_option` 是 inline_choice 每個空格的正解索引，跟 checkbox 的
    `correct_options` 同一條規則 —— 判分用，作答前不給學生看（#2776）。
    白名單放行了 `blanks` 這個 key 本身，但沒人檢查它「裡面」帶了什麼；
    這條測試專門補那個縫。
    """
    found_inline_choice = False
    for uid, row in _served_rows():
        blanks = row.get("blanks")
        if not blanks:
            continue
        found_inline_choice = True
        for i, blank in enumerate(blanks):
            assert set(blank.keys()) <= {"options"}, (
                f"{uid} 第 {i} 個空格帶了不該給學生看的欄位：{sorted(blank.keys())}"
            )
    assert found_inline_choice, (
        "整個語料庫都找不到 inline_choice 欄位 —— "
        "要嘛是資料變了，要嘛這條測試沒測到它以為在測的東西"
    )
