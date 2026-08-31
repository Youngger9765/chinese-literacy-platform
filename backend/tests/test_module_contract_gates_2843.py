"""模組契約的兩道門 —— schema 門與分派對帳門（#2843 階段 0）

為什麼需要這個檔案
------------------
`backend/data/lessons/*/v3/` 底下 2019 個模組檔，24 種模組，**598 種不同的
top-level key 形狀**。沒有 per-module 輸出契約 ⇒ 抽取時每一課自己想一個欄位名
⇒ 消費端 `.get("questions")` 回 `None` ⇒ **不報錯、其他門全綠、學生看不到**。

這不是假設。2026-08-21 實測，用正向對照驗過：

    27 課的閱讀理解寫成 `items`（消費端 `_mcq_from` 只讀 `questions`）
    → 那 27 課的 `multiple_choice` 長度是 **0**
    → 正向對照：寫 `questions` 的課同一支函式回 5 題

畫面上那 27 課的閱讀理解就是空的，而且沒有任何一道門在看這件事。

這個檔案鎖兩件事：
  1. `module_schema_gate` —— 每個模組的欄位名在宣告的詞彙表內、consumer 要的必填欄位在
  2. `module_reconcile_gate` —— 學習單自己印的大題目錄（`sections_present`）跟實際
     產出的模組檔對得上

⚠️ 兩道門都是**棘輪**，不是 `== 0`
------------------------------------
598 種形狀擺在那裡，嚴格門一上線 175 課全紅。恆紅的門會被訓練成無視 ——
`keypoints_shape_gate` 的 docstring 記過同一件事（那 19 條被當成內容缺陷掛了一整天，
真正的原因只是漏帶一個 flag）。所以判準是「不合規課數 <= 已記錄的基準值」，
只准降不准升，降了就更新基準。

⚠️ 數量斷言，不是「至少有一個」
------------------------------
覆蓋率一律用**數量**斷言（24 個模組全部登記 / 0 個落單），並配**檔案數下限** ——
少了下限，一個掃不到檔案的 glob 會讓每一條斷言都空跑成功。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

import module_reconcile_gate as recon  # noqa: E402
import module_schema_gate as schema_gate  # noqa: E402

SCHEMA_DIR = REPO / "backend/data/schemas/modules"
LESSONS = REPO / "backend/data/lessons"

# 實測值（2026-08-21）。下限而不是等號 —— 課會變多，但**掃不到檔案**要立刻紅。
MIN_MODULE_FILES = 2000
SERVED_MODULE_COUNT = 24


# ─────────────────────────────────────────────────────────────────────────────
# A. 登記表：24 個模組全部有歸屬，一個都不能落單
# ─────────────────────────────────────────────────────────────────────────────

def test_registry_covers_every_served_module_exactly():
    """24 個服務中的模組，每一個恰好登記一次。

    模組清單**不在這裡抄一份** —— 從 `module_entry_gate.ENTRY` 讀（那是既有的
    24 模組真相）。抄一份必漂，`orphan_key_gate` 對 `MODULES` 也是這樣處理的。
    """
    served = recon.served_modules()
    registered = set(recon.load_registry()["modules"])

    assert len(served) == SERVED_MODULE_COUNT, (
        f"服務中的模組數變成 {len(served)}（原本 {SERVED_MODULE_COUNT}）—— "
        "登記表要跟著更新，不是改這個數字"
    )
    # 數量斷言：兩邊完全相等，不是「至少涵蓋一個」
    assert registered == served, (
        f"沒登記: {sorted(served - registered)}  多登記: {sorted(registered - served)}"
    )


def test_declarable_and_non_declarable_partition_the_24():
    """17 個會印在大題目錄上 + 7 個不會 = 24，且互斥。"""
    reg = recon.load_registry()
    declarable = {m for m, v in reg["modules"].items() if v["declarable"]}
    non_declarable = {m for m, v in reg["modules"].items() if not v["declarable"]}

    assert declarable & non_declarable == set()
    assert len(declarable) == 17, f"declarable={len(declarable)}: {sorted(declarable)}"
    assert len(non_declarable) == 7, f"non_declarable={sorted(non_declarable)}"
    assert len(declarable) + len(non_declarable) == SERVED_MODULE_COUNT


def test_registry_does_not_contradict_the_splitter():
    """登記表的大題名對應，不得跟 `split_lesson_modules` 已有的那份打架。

    那份是**行為的來源**（它決定 `section_no`）。登記表可以是它的超集
    （補齊文言文那幾個），但同一個名字不能對到不同模組 —— 否則就是兩份真相。
    """
    splitter_src = (REPO / "scripts/split_lesson_modules.py").read_text(encoding="utf-8")
    ns: dict = {}
    # 只取那一份對應表，不 import 整個 splitter（它會拉 yaml/subprocess）
    start = splitter_src.index("SECTION_NAME_TO_MODULE = [")
    end = splitter_src.index("]", start) + 1
    exec(splitter_src[start:end], ns)  # noqa: S102 - 讀自家 repo 的常數字面

    reg_aliases = recon.load_registry()["section_name_aliases"]
    assert len(ns["SECTION_NAME_TO_MODULE"]) >= 10, "解析壞了，抓到的對應太少"

    for needle, module in ns["SECTION_NAME_TO_MODULE"]:
        assert needle in reg_aliases, f"登記表漏了 splitter 已有的大題名「{needle}」"
        assert reg_aliases[needle] == module, (
            f"「{needle}」在 splitter 對到 {module}，在登記表卻對到 {reg_aliases[needle]}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# B. schema 門的行為（合成資料，跟真實課樹隔離）
# ─────────────────────────────────────────────────────────────────────────────

def _tree(tmp_path: Path, uid: str, module: str, inner: dict) -> Path:
    d = tmp_path / uid / "v3"
    d.mkdir(parents=True)
    (d / f"{module}.yml").write_text(
        yaml.dump({"lesson_uid": uid, "version_id": "v3", module: inner},
                  allow_unicode=True, sort_keys=False),
        encoding="utf-8")
    return tmp_path


def test_schema_gate_flags_a_missing_required_field(tmp_path):
    root = _tree(tmp_path, "L9001", "comprehension", {"instruction": "讀完後回答"})
    findings = schema_gate.scan(root)
    assert len(findings) == 1
    f = findings[0]
    assert f.rule == "missing_required"
    assert f.uid == "L9001" and f.module == "comprehension" and f.field == "questions"


def test_schema_gate_flags_a_forbidden_alias_and_names_the_canonical(tmp_path):
    """訊息要**指名**用了哪個別名、正名叫什麼 —— 否則修的人還要自己查。"""
    root = _tree(tmp_path, "L9002", "comprehension",
                 {"items": [{"stem": "為什麼", "options": {"A": "甲"}, "answer": "A"}]})
    findings = schema_gate.scan(root)
    assert [f.rule for f in findings] == ["forbidden_alias"]
    assert findings[0].field == "items"
    assert "questions" in findings[0].message


def test_alias_suppresses_the_redundant_missing_required(tmp_path):
    """同一個根因只算一次。

    `items` 既是別名、也讓 `questions` 缺席。兩條都報 = 同一課被數兩次，
    棘輪基準會虛胖，而且看報告的人以為有兩個問題。
    """
    root = _tree(tmp_path, "L9003", "comprehension", {"items": [{"stem": "x"}]})
    rules = [f.rule for f in schema_gate.scan(root)]
    assert rules == ["forbidden_alias"], f"預期只有別名一條，實際 {rules}"


def test_schema_gate_passes_a_conforming_lesson(tmp_path):
    """正向對照。少了它，「什麼都沒報」也會看起來像通過。"""
    root = _tree(tmp_path, "L9004", "comprehension",
                 {"questions": [{"stem": "為什麼", "options": {"A": "甲"}, "answer": "A"}]})
    assert schema_gate.scan(root) == []


def test_required_any_of_accepts_either_and_rejects_neither(tmp_path):
    """知識補給站的 `videos`(連結) 與 `items`(片名) 是**兩個來源**不是別名 ——
    120 課兩個都有。要求任一即可，兩個都沒有才是真的沒有影片。"""
    ok_v = _tree(tmp_path / "a", "L9005", "resources", {"videos": [{"index": 1}]})
    ok_i = _tree(tmp_path / "b", "L9006", "resources", {"items": [{"title": "片"}]})
    neither = _tree(tmp_path / "c", "L9007", "resources", {"label": "九"})
    assert schema_gate.scan(ok_v) == []
    assert schema_gate.scan(ok_i) == []
    assert [f.rule for f in schema_gate.scan(neither)] == ["missing_required_any_of"]


def test_schema_gate_fails_on_an_empty_tree(tmp_path):
    """空跑不算成功。掃不到任何模組檔 = 這道門瞎了，要紅。"""
    (tmp_path / "empty").mkdir()
    rc = schema_gate.main(["--lessons-root", str(tmp_path / "empty")])
    assert rc != 0


# ─────────────────────────────────────────────────────────────────────────────
# C. schema 門對真實課樹：棘輪 + 檔案數下限
# ─────────────────────────────────────────────────────────────────────────────

def test_schema_gate_scans_the_whole_real_tree():
    """檔案數下限 —— 防「glob 掃不到所以恆綠」。"""
    assert schema_gate.count_scanned(LESSONS) >= MIN_MODULE_FILES


def test_schema_gate_within_ratchet_baseline():
    """真實課樹的違規數，每個模組每條規則都不得超過基準值。"""
    rc = schema_gate.main(["--lessons-root", str(LESSONS)])
    assert rc == 0, "違規數超過基準值 —— 只准降不准升"


def test_every_schema_cites_a_real_consumer():
    """`required` 不是我覺得該有，是**消費端真的讀它**。

    每個 schema 的 `consumer:` 必須指到一個存在的檔案，而且那個檔案裡真的有
    這個欄位名。少了這條，schema 會變成「我發明的規格」，而它擋下來的課
    其實沒有壞 —— `keypoints_shape_gate` 的 docstring 記過那次教訓：
    **判準錯的門比沒有門更糟**。
    """
    schemas = sorted(SCHEMA_DIR.glob("*.schema.yml"))
    assert len(schemas) == 14, f"schema 檔數 {len(schemas)}，預期 14"

    for path in schemas:
        s = yaml.safe_load(path.read_text(encoding="utf-8"))
        required = list(s.get("required") or []) + [
            f for group in (s.get("required_any_of") or []) for f in group
        ]
        if not required:
            continue
        cites = s.get("consumer") or []
        assert cites, f"{path.name} 宣告了必填欄位卻沒有 consumer 出處"
        for cite in cites:
            rel = cite.split("::")[0]
            target = REPO / rel
            assert target.is_file(), f"{path.name} 的 consumer 指向不存在的 {rel}"
        blob = "\n".join((REPO / c.split("::")[0]).read_text(encoding="utf-8")
                         for c in cites)
        for field in required:
            assert field in blob, (
                f"{path.name} 要求 `{field}`，但列出的 consumer 沒有一個讀它 —— "
                "這條 required 沒有根據"
            )


def test_schemas_stay_off_other_peoples_modules():
    """邊界鎖：聚光燈／重點表（@stgst）與朗讀（@if-else-master）這次不碰。

    他們正在改那三塊，同時動就是重演 v2/v3 撞車。這條讓「不小心加一個 schema」
    變成紅的，而不是等 review 時有人記得。
    """
    claimed = {"spotlight", "keypoints", "keypoints_followup_questions", "key_reading"}
    have = {p.name.split(".")[0] for p in SCHEMA_DIR.glob("*.schema.yml")}
    assert have & claimed == set(), f"這幾個模組有人在動，不該有 schema: {sorted(have & claimed)}"


# ─────────────────────────────────────────────────────────────────────────────
# D. 分派對帳門
# ─────────────────────────────────────────────────────────────────────────────

def _lesson(tmp_path: Path, uid: str, sections: list[dict], modules: list[str]) -> Path:
    d = tmp_path / uid / "v3"
    d.mkdir(parents=True)
    (d / "lesson.yml").write_text(
        yaml.dump({"lesson_uid": uid, "version_id": "v3", "sections_present": sections},
                  allow_unicode=True, sort_keys=False), encoding="utf-8")
    for m in modules:
        (d / f"{m}.yml").write_text(
            yaml.dump({"lesson_uid": uid, m: {}}, allow_unicode=True), encoding="utf-8")
    return tmp_path


def test_reconcile_flags_declared_but_not_produced(tmp_path):
    """宣告有、檔案沒有 → 那個模組的抽取沒跑成功。訊息要指名是哪一個模組。"""
    root = _lesson(tmp_path, "L9101", [{"no": "七", "name": "閱讀理解"}], [])
    findings = recon.scan(root)
    assert [f.rule for f in findings] == ["declared_not_produced"]
    assert findings[0].module == "comprehension"
    assert "comprehension" in findings[0].message


def test_reconcile_flags_produced_but_not_declared(tmp_path):
    """檔案有、宣告沒有 → 總覽漏看了一個大題。"""
    root = _lesson(tmp_path, "L9102", [{"no": "一", "name": "讀全文-做記號"}],
                   ["full_text_annotate", "comprehension"])
    findings = recon.scan(root)
    assert [f.rule for f in findings] == ["produced_not_declared"]
    assert findings[0].module == "comprehension"


def test_reconcile_ignores_modules_that_never_appear_in_the_printed_list(tmp_path):
    """`metadata`／`errata`／`goal_box` 這些不是大題，不能因為沒被宣告就報紅。"""
    root = _lesson(tmp_path, "L9103", [{"no": "一", "name": "讀全文-做記號"}],
                   ["full_text_annotate", "metadata", "errata", "goal_box"])
    assert recon.scan(root) == []


def test_reconcile_flags_an_unmapped_section_name(tmp_path):
    """認不得的大題名要**明著報**，不能靜靜跳過 ——
    靜靜跳過正是 `MODULES` 表漏一個 key 那次（15 課整節消失）的形狀。"""
    root = _lesson(tmp_path, "L9104", [{"no": "三", "name": "宇宙無敵新大題"}], [])
    findings = recon.scan(root)
    assert [f.rule for f in findings] == ["unmapped_section_name"]
    assert "宇宙無敵新大題" in findings[0].message


def test_reconcile_fails_on_an_empty_tree(tmp_path):
    (tmp_path / "empty").mkdir()
    assert recon.main(["--lessons-root", str(tmp_path / "empty")]) != 0


def test_reconcile_scans_the_whole_real_tree():
    assert recon.count_scanned(LESSONS) >= 175


def test_reconcile_within_ratchet_baseline():
    assert recon.main(["--lessons-root", str(LESSONS)]) == 0


# ─────────────────────────────────────────────────────────────────────────────
# E. 兩道門都要真的被 CI 跑到（un-run lock is theatre）
# ─────────────────────────────────────────────────────────────────────────────

def test_this_file_is_named_in_a_workflow_that_runs_it():
    """這個 repo 的 backend workflow 是**點名清單不是掃目錄** ——
    `pytest.yml` 的註解自己記過：重點表 bridge lock 的測試檔存在了很久，
    卻從來沒有任何門執行它（GHA 0 / run-ci 0 / registry 0）。
    所以這條斷言的是「我有沒有被點到名」，不是「我有沒有通過」。
    """
    wf = (REPO / ".github/workflows/pytest.yml").read_text(encoding="utf-8")
    assert Path(__file__).name in wf, "這個檔案沒被 pytest.yml 點名 —— 加進去"


def test_the_named_test_list_has_no_broken_line_continuation():
    """`\\` 續行斷掉 = 那個 step 跑 0 個測試，而 CI 照樣綠。

    2026-08-21 就有人插入時多打了一個 `\\ \\`，整段名單靜靜地不跑了。
    """
    lines = (REPO / ".github/workflows/pytest.yml").read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        if line.rstrip().endswith("\\"):
            assert not line.rstrip().endswith("\\ \\"), f"第 {i+1} 行續行符重複"
            assert lines[i + 1].strip(), f"第 {i+1} 行以 \\ 結尾，但下一行是空的"
