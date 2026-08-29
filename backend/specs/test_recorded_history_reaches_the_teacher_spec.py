"""L4：學生用完之後留下的東西，老師從他真正用的介面要讀得回來（#2964）。

## 這一層為什麼要有門

既有的 `layer-verification-framework.md` L1–L5 停在「畫面對不對」——
**沒有「用完之後留下什麼」那一層**。而那一層的洞是活的，不是理論的：

- #2904：prod 561 課完成，只有 **9 筆**有 `overall_score`。
  寫入路徑的測試一直是綠的（它先用 SQL 把欄位塞好再呼叫），
  而真實流程從來沒有輸入 —— 老師打開報告看到一片空白。
- #2962：`status` 被關在 `if scores` 裡面，沒分數的 session 連「完成」都沒記錄，
  於是第一個徽章永遠發不出來。

兩個都不是「抽錯」也不是「畫錯」，是**做完之後沒留下對的痕跡**。

## 這支守什麼

`process_session_completion()` 寫進 `LearningSession` 的每一個欄位，
都必須出現在老師報告的回應模型裡。少了那一半，我們會繼續「寫得很認真、
而老師的畫面上什麼都沒有」。

⛔ 這是**契約**檢查不是行為檢查 —— 行為那半在
`backend/tests/test_session_scoring_below_threshold_2904.py`（分數）與
`test_gamification.py`（徽章、完成狀態）。兩半都要有：
只驗契約會漏掉「欄位在但永遠是 None」，只驗行為會漏掉「寫了但老師看不到」。
"""
from __future__ import annotations

import ast
import pathlib

_REPO = pathlib.Path(__file__).resolve().parents[2]
_SERVICE = _REPO / "backend" / "app" / "services" / "gamification_service.py"
_SCHEMA = _REPO / "backend" / "app" / "routes" / "teacher" / "teacher_schemas.py"


def _fields_written_to_the_session() -> set[str]:
    """gamification_service 對 learning_session.<欄位> 做過賦值的所有欄位。

    用 AST 不用 grep —— grep 會把註解、字串裡的同名字也算進去。
    """
    tree = ast.parse(_SERVICE.read_text(encoding="utf-8"))
    out: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for tgt in node.targets:
            if (isinstance(tgt, ast.Attribute)
                    and isinstance(tgt.value, ast.Name)
                    and tgt.value.id == "learning_session"):
                out.add(tgt.attr)
    return out


def _teacher_report_fields() -> set[str]:
    tree = ast.parse(_SCHEMA.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "TeacherSessionReportResponse":
            return {
                s.target.id for s in node.body
                if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)
            }
    raise AssertionError("找不到 TeacherSessionReportResponse —— 模型改名了？")


def test_the_two_files_parsed():
    """正向對照 —— 少了它，下面兩條可能在對空集合斷言。"""
    written = _fields_written_to_the_session()
    exposed = _teacher_report_fields()
    assert len(written) >= 3, f"只解析到 {len(written)} 個寫入欄位：{written}"
    assert len(exposed) >= 15, f"只解析到 {len(exposed)} 個回應欄位"
    assert "overall_score" in written, "連 overall_score 都沒抓到，AST 掃描壞了"


def test_everything_recorded_is_visible_to_the_teacher():
    """⭐ 學生做完留下的每一個欄位，老師的報告都要看得到。"""
    written = _fields_written_to_the_session()
    exposed = _teacher_report_fields()
    invisible = sorted(written - exposed)
    assert not invisible, (
        f"這些欄位有寫進 session，但老師的報告讀不到：{invisible}\n"
        "寫得很認真而老師的畫面上什麼都沒有 —— 那就是 #2904 的形狀。\n"
        "要嘛加進 TeacherSessionReportResponse，要嘛說明為什麼老師不需要看到。")


def test_completion_is_recorded_independently_of_scoring():
    """完成是事實、分數是量測 —— `status` 的賦值不可以縮在 `if scores` 裡面。

    #2962：原本那三行縮在 `if scores and weights:` 底下，於是三個來源都空的
    session 連「完成」都沒記錄，接著 get_completed_story_count() 回 0，
    第一個徽章永遠發不出來。
    """
    tree = ast.parse(_SERVICE.read_text(encoding="utf-8"))
    guilty = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        cond = ast.dump(node.test)
        if "scores" not in cond or "weights" not in cond:
            continue
        for inner in ast.walk(node):
            if (isinstance(inner, ast.Assign)
                    and any(isinstance(t, ast.Attribute) and t.attr == "status"
                            for t in inner.targets)):
                guilty.append(node.lineno)
    assert not guilty, (
        f"第 {guilty} 行：`status` 的賦值又被關進 `if scores and weights:` 裡面了。\n"
        "沒有分數的 session 就不會被標成完成 → 徽章與完成數全部歸零（#2962）。")
