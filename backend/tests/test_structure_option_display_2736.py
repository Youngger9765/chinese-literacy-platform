"""勾選題的兩個顯示缺陷：作答指示被當答案挖掉、選項尾巴帶著別人的 □。

一、`【單選】` 不是答案，是指示
--------------------------------
`_strip_blank_answers` 把所有 `【…】` 一律換成 `【　　　】`。那對答案是對的，
但學習單用同一個括號寫**作答指示** —— 「【單選】」「【多選】」「【勾選，可複選】」。
挖掉之後學生看到 `【　　　】`，**不知道該勾一個還是勾多個**，而選項本身還在，
所以畫面看起來完全正常，沒有任何錯誤。

全庫 checkbox 列的 `【】` 內容分布（2026-08-18 實測）：
    28 處 指示語（單選 14／多選 5／勾選可複選 4／複選 2／…）  ← 不該挖
    21 處 空的 `【】`                                        ← 挖不挖都一樣
     8 處 真答案（【1】【2】【3】【①上升】【②下降】）        ← 該挖

二、選項尾巴帶著下一個選項的 `□`
--------------------------------
`parse_checkbox_options` 切每個選項時，chunk 的範圍是「這個圈號到**下一個**圈號」，
所以 ① 的內容會把 ② 前面那個 `□` 一起吃進來：

    "①積極的面對與復健 □②放棄跑步"
     └─ ① 的 chunk ─────┘        ← 尾巴多一個 □

`clean` 只做了 `lstrip("□")`（去掉開頭的），尾巴那個留著 →
學生看到的選項文字是「積極的面對與復健 □」。

⚠️ 尾巴那個 `□` 是**下一個**選項的干擾項標記，而下一個選項是從**原始 text**
讀 prefix 判斷的（`text[start-1:start+1]`），所以把它從 clean 拿掉不會影響誰是正解。
"""

from __future__ import annotations

import json
import pathlib
from _module_files import module_file, module_files
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
from app.services.story_structure_cell_parser import parse_checkbox_options  # noqa: E402

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"

# 作答指示，不是答案。挖掉會讓學生不知道要勾幾個。
INSTRUCTION_WORDS = ("單選", "多選", "複選", "勾選", "打勾", "可複選")

BLANK_RE = re.compile(r"【([^】]*)】")
BOX_RE = re.compile(r"[□■☑▢]")
# 干擾項標記：緊接在圈號前面的 □（`請在□打勾` 那種不算）
DISTRACTOR_RE = re.compile(r"[□■☑▢]+\s*(?=[①②③④⑤⑥⑦⑧⑨⑩])")
# Python 容器被 str() 之後的特徵（dict 與 list 兩種）
CONTAINER_REPR_RE = re.compile(r"\{'|': '|\{\d+: |\['")

MIN_LESSONS_SCANNED = 100


def _walk(rows):
    for row in rows or []:
        yield row
        yield from _walk(row.get("sub_rows"))


def _served():
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
        scanned += 1
        yield d.name, _sanitize_structure_for_client(_format_yaml_structure_table(table))
    if scanned < MIN_LESSONS_SCANNED:
        pytest.fail(
            f"只掃到 {scanned} 課，少於下限 {MIN_LESSONS_SCANNED} —— "
            "這代表這支測試沒掃到課，不是缺陷消失了"
        )


def test_no_answer_survives_on_any_row_type():
    """答案不可以因為「這列是 checkbox」就逃過挖空。

    消毒器原本只在 `interactive_type == "fill_blank"` 時才挖 `【…】`，
    checkbox 列整條跳過 —— 於是 `【①上升】`、`【文旦】` 這些答案原樣送給學生。
    9 課 / 39 處（2026-08-18 實測）。
    """
    leaked = []
    for uid, served in _served():
        for row in _walk(served.get("rows")):
            for m in BLANK_RE.finditer(row.get("value") or ""):
                inner = m.group(1).strip()
                if not inner or inner == "\u3000\u3000\u3000":
                    continue                      # 已挖空
                if any(w in inner for w in INSTRUCTION_WORDS):
                    continue                      # 作答指示，該留
                leaked.append((uid, row.get("interactive_type"), inner[:24]))
    assert not leaked, (
        f"{len({l[0] for l in leaked})} 課 / {len(leaked)} 處答案沒被挖掉：\n"
        + "\n".join(f"  {u} [{t}] 【{v}】" for u, t, v in leaked[:10])
    )


def test_instruction_survives_sanitising():
    """核心斷言：帶指示語的 checkbox 列，消毒後指示語還在。"""
    from app.routes.stories import _sanitize_row_for_client

    row = {
        "label": "x",
        "interactive_type": "checkbox",
        "value": "他選擇【單選】\n①積極面對 □②放棄",
        "options": ["積極面對", "放棄"],
        "correct_options": [0],
    }
    out = _sanitize_row_for_client(row)
    assert "單選" in out["value"], (
        f"作答指示被挖掉了：{out['value']!r} —— 學生不會知道該勾幾個"
    )
    assert "correct_options" not in out, "答案鑰匙不可以送給學生"


def test_real_answers_are_still_blanked():
    """正向對照：真答案仍然要被挖掉，不能為了保留指示語而放行答案。"""
    from app.routes.stories import _sanitize_row_for_client

    row = {
        "label": "x",
        "interactive_type": "fill_blank",
        "value": "溫度會【上升】",
    }
    out = _sanitize_row_for_client(row)
    assert "上升" not in out["value"], f"答案沒被挖掉：{out['value']!r}"


def test_options_carry_no_leftover_box_marker():
    """選項文字不可以帶著下一個選項的 □。"""
    bad = []
    for uid, served in _served():
        for row in _walk(served.get("rows")):
            for i, opt in enumerate(row.get("options") or []):
                if BOX_RE.search(opt):
                    bad.append((uid, i, opt[:40]))
    assert not bad, (
        f"{len({b[0] for b in bad})} 課 / {len(bad)} 個選項殘留 □ 記號：\n"
        + "\n".join(f"  {u} options[{i}] = {o!r}" for u, i, o in bad[:8])
    )


def test_the_whole_payload_is_clean_not_just_rows():
    """掃**整個** payload，不是只掃 `rows`。

    2026-08-18 的教訓：干擾項移除只加在 `_sanitize_row_for_client`（管 `rows`），
    而 `worksheet_rows` 走的是另一條消毒路徑，漏掉了。
    我本機的鎖也只走 `rows` —— 於是**本機全綠、staging 40 課裡有 39 個 `□①`**。

    鎖跟修復犯了同一個錯：都只看了一半。所以這條改成序列化整個 payload 再掃，
    結構長出新的分支時不會再從縫隙溜走。
    """
    bad_box, bad_ans = [], []
    for uid, served in _served():
        blob = json.dumps(served, ensure_ascii=False)
        for m in DISTRACTOR_RE.finditer(blob):
            bad_box.append((uid, blob[max(0, m.start() - 16): m.start() + 20]))
        for m in BLANK_RE.finditer(blob):
            inner = m.group(1).strip()
            if not inner or inner == "\u3000\u3000\u3000":
                continue
            if any(w in inner for w in INSTRUCTION_WORDS):
                continue
            # 章節標題用 `【】` 點名主角（`人物一【福爾摩斯】`），那是標題不是填空。
            # 判準：那一段前面緊接著「人物」「角色」這種標題詞。
            before = blob[max(0, m.start() - 8): m.start()]
            if any(w in before for w in ("人物", "角色", "篇章", "文本")):
                continue
            bad_ans.append((uid, inner[:20]))
    assert not bad_box, (
        f"{len({b[0] for b in bad_box})} 課的 payload 仍有干擾項標記：\n"
        + "\n".join(f"  {u} …{c}…" for u, c in bad_box[:6])
    )
    assert not bad_ans, (
        f"{len({b[0] for b in bad_ans})} 課的 payload 仍有沒挖空的答案：\n"
        + "\n".join(f"  {u} 【{v}】" for u, v in bad_ans[:6])
    )


def test_options_are_never_split_artifacts():
    """選項不可以帶 `【` `】` —— 那一定是整格按圈號切壞的碎片。

    L0072 有一列在 value 裡寫了三組行內選擇（`【□①多 ②少】`），整格切開之後
    options 變成 `'少】；\n 東西越小【 柳丁 】…'`，而 `【 柳丁 】` 是答案。
    """
    bad = []
    for uid, served in _served():
        for row in _walk(served.get("rows")):
            for o in row.get("options") or []:
                if "【" in o or "】" in o:
                    bad.append((uid, o[:36]))
    assert not bad, (
        f"{len({b[0] for b in bad})} 課的選項是切壞的碎片：\n"
        + "\n".join(f"  {u} {o!r}" for u, o in bad[:6])
    )


def test_no_distractor_marker_reaches_the_student():
    """`□①` 是「這個選項是錯的」，送到學生端就是把答案印出來。

    修復前：42 課 / 256 個，其中絕大多數在 `value` 裡（不是 `options`）——
    第一版的鎖只查 `options`，所以把干擾項移除整個拿掉也照樣綠。
    mutation 抓到之後才補上這條。

        □①驕傲地奪得銀牌 ②以微小差距…      ← □ 在 ① 前 ⇒ ① 是錯的
        【勾選，可複選】①尷尬 □②生氣 ③感到丟臉  ⇒ 答案是 ①③
    """
    bad = []
    for uid, served in _served():
        for row in _walk(served.get("rows")):
            fields = [row.get("value") or "", row.get("label") or ""]
            fields += list(row.get("options") or [])
            for f in fields:
                for m in DISTRACTOR_RE.finditer(f):
                    bad.append((uid, f[max(0, m.start() - 12): m.start() + 14]))
    assert not bad, (
        f"{len({b[0] for b in bad})} 課 / {len(bad)} 個干擾項標記送到了學生端：\n"
        + "\n".join(f"  {u} …{c}…" for u, c in bad[:10])
    )


def test_no_python_container_repr_reaches_the_student():
    """`['1.小美…', '2.阿哲…']` 不該出現在畫面上。

    有幾課把編號小題寫成 list[str]（L0167／L0168／L0169 的「內容」欄），
    橋 `str()` 了它 —— 學生看到的是 Python 的 list repr，方括號和引號都在。
    dict 那半（`{'answer': [1, 3]}`）先前已修，list 這半沒接上。

    ⚠️ 這條不只是美觀：dict 那半的 repr 裡帶著答案。兩種容器都不可以 str()。
    """
    bad = []
    for uid, served in _served():
        blob = json.dumps(served, ensure_ascii=False)
        for m in CONTAINER_REPR_RE.finditer(blob):
            bad.append((uid, blob[max(0, m.start() - 20): m.start() + 40]))
    assert not bad, (
        f"{len({b[0] for b in bad})} 課 / {len(bad)} 處把容器 repr 印給學生：\n"
        + "\n".join(f"  {u} …{c}…" for u, c in bad[:6])
    )


def test_list_cell_renders_as_lines_not_repr():
    """正向對照：list 要接成換行，不是變成空的。"""
    from app.services.keypoints_to_structure import _render_cell

    got = _render_cell(["1.第一題", "2.第二題"], None)
    assert got == "1.第一題\n2.第二題", repr(got)


def test_instructional_box_is_not_removed():
    """正向對照：`請在□打勾` 裡的 □ 是指示語，不可以連它一起刪。"""
    from app.routes.stories import _strip_distractor_marks

    assert _strip_distractor_marks("請在□打勾") == "請在□打勾"
    assert _strip_distractor_marks("①對 □②錯") == "①對 ②錯"


def test_parser_strips_trailing_box_but_keeps_distractor_detection():
    """負向對照：拿掉尾巴的 □ 之後，誰是干擾項仍要判對。"""
    got = parse_checkbox_options("①積極面對 □②放棄")
    assert got is not None
    assert got["options"] == ["積極面對", "放棄"], got["options"]
    # ② 前面有 □ ⇒ ② 是干擾項，正解只有 ①(index 0)
    assert got["correct_options"] == [0], got["correct_options"]


def test_parser_still_handles_leading_box():
    """正向對照：開頭就帶 □ 的選項，原本就處理得對，不可以被改壞。"""
    got = parse_checkbox_options("□①錯的 ②對的")
    assert got is not None
    assert got["options"] == ["錯的", "對的"], got["options"]
    assert got["correct_options"] == [1], got["correct_options"]
