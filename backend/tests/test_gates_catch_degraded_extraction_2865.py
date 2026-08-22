"""三道門合起來擋不住一份劣化的抽取（#2865）。

## 怎麼發現的

2026-08-22 第一次真的派飛機跑 `extract-vocab-definitions`（L0072）。
它照指示做完之後，自己做了一次 mutation：把輸出砍成

    只剩 items、只留 1 題（原本 5 題）、definition 空字串、
    拿掉 vocabulary_bank、拿掉 lesson_uid/version_id/section_no 的外層

**三道門全綠。** schema 過、`verify_bank_coverage` 回 0、對帳門也會綠
（它只比「宣告的模組集合 == 產出的模組檔集合」，檔在就算數）。

三個原因疊在一起：

| | |
|---|---|
| schema | `required` 只有 `items`，而 `items` 宣告成裸 `{"type":"array"}` → item 層零約束 |
| 骨架鐵律 2 的 snippet | 只做鍵名集合比對，不驗型別、不驗 item、不驗外層 |
| `verify_bank_coverage.py` | 沒有語詞框時 `return 0` —— 而語詞框 143/150 課都有印，「沒有 bank」在這個模組幾乎一定是抽漏了 |

⛔ 這比「沒有門」更糟：三道門都在跑、都是綠的，所以沒有人會去看。

## 這支測什麼

只測「劣化的輸出會不會被擋下來」。每一條都配正向對照 ——
少了它，「擋住」可能只是整支檢查壞了。
"""
from __future__ import annotations

import json
import pathlib

import pytest
import yaml
from jsonschema import Draft7Validator

REPO = pathlib.Path(__file__).resolve().parents[2]
SCHEMAS = REPO / "specs" / "modules" / "schemas"
LESSONS = REPO / "backend" / "data" / "lessons"

#: 飛機實際做的那份 mutation，逐字保留。
DEGRADED = {
    "vocab_definitions": {
        "items": [{"index": 1, "word": "", "definition": ""}],
    }
}


def _validator(module: str) -> Draft7Validator:
    return Draft7Validator(json.loads((SCHEMAS / f"{module}.schema.json").read_text()))


def _body(doc: dict, module: str) -> dict:
    return doc.get(module, doc)


def test_a_real_lesson_still_validates():
    """正向對照。沒有這條，下面的『擋住』可能只是 schema 整個壞了。

    抽 5 課而不是 1 課 —— 「有一課過」不代表 schema 沒把好課判死。
    """
    files = sorted(LESSONS.glob("L*/v3/vocab_definitions.yml"))[:5]
    assert len(files) == 5, f"只找到 {len(files)} 份，掃描前提不成立"
    v = _validator("vocab_definitions")
    for f in files:
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        errs = sorted(v.iter_errors(_body(doc, "vocab_definitions")), key=str)
        assert not errs, f"{f.parts[-3]} 這份好的被判死了：{errs[0].message}"


def test_empty_definition_is_rejected():
    """空字串的解釋 = 沒抽到東西，不可以算過。"""
    v = _validator("vocab_definitions")
    errs = list(v.iter_errors(DEGRADED["vocab_definitions"]))
    assert errs, "空 definition 的劣化輸出仍然通過 schema"


def test_item_must_name_its_answer():
    """`word` 或 `answer` 至少要有一個。

    兩種都在服務中（有語詞框用 word、沒有用 answer），
    但**一個都沒有**代表這題沒有答案 —— 那不是形狀差異，是抽漏了。
    """
    v = _validator("vocab_definitions")
    no_answer = {"items": [{"index": 1, "definition": "有解釋但沒有答案"}]}
    assert list(v.iter_errors(no_answer)), "沒有 word 也沒有 answer 的題目通過了"


def test_item_must_have_an_index():
    v = _validator("vocab_definitions")
    assert list(v.iter_errors({"items": [{"word": "質疑", "definition": "提出疑問"}]})), \
        "沒有 index 的題目通過了"


def test_items_must_not_be_empty():
    """一題都沒有的 items 是抽失敗，不是「這課只有一題」。"""
    v = _validator("vocab_definitions")
    assert list(v.iter_errors({"items": []})), "空的 items 通過了"


# ---------------------------------------------------------------------------
# 一致率量測工具本身要分得出好壞（#2865）
# ---------------------------------------------------------------------------

import subprocess
import sys

HARNESS = REPO / "scripts" / "eval_overview_repeatability.py"


def _run_harness(tmp_path, runs: list[list[dict]]):
    paths = []
    for i, r in enumerate(runs):
        p = tmp_path / f"run-{i}.json"
        p.write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
        paths.append(str(p))
    return subprocess.run(
        [sys.executable, str(HARNESS), "--uid", "L0072", *paths],
        cwd=REPO, capture_output=True, text=True, timeout=120,
    )


AGREE = [{"no": "一", "name": "讀全文-做記號", "pages": [1, 2]},
         {"no": "二", "name": "念順順", "pages": [2, 3]}]


def test_harness_passes_when_runs_agree(tmp_path):
    """正向對照 —— 沒有這條，下面的『抓到分歧』可能只是它永遠回非零。"""
    r = _run_harness(tmp_path, [AGREE, [dict(s) for s in AGREE]])
    assert r.returncode == 0, r.stdout + r.stderr


def test_harness_catches_a_different_section_set(tmp_path):
    """大題集合分歧 = 分派層不可信，必須非零。"""
    fewer = [AGREE[0]]
    r = _run_harness(tmp_path, [AGREE, fewer])
    assert r.returncode == 1, f"少一個大題卻回 {r.returncode}：\n{r.stdout}"


def test_harness_reports_page_disagreement_without_failing(tmp_path):
    """頁碼分歧只警告 —— 頁碼由定位器出，不該讓這支變成恆紅的門。"""
    shifted = [{**AGREE[0], "pages": [1]}, AGREE[1]]
    r = _run_harness(tmp_path, [AGREE, shifted])
    assert r.returncode == 0, r.stdout
    assert "8/9" not in r.stdout
    assert "1/2 全部相同" in r.stdout, r.stdout


def test_harness_refuses_a_single_run(tmp_path):
    """一個 run 量不出一致率。回 0 的話等於「一次就算穩」。"""
    r = _run_harness(tmp_path, [AGREE])
    assert r.returncode == 2, r.stdout


def test_harness_reports_unreadable_input_rather_than_passing(tmp_path):
    """讀不到要回 2，⛔ 不可以因為『沒讀到分歧』就回 0。"""
    bad = tmp_path / "not-json.json"
    bad.write_text("這不是 JSON", encoding="utf-8")
    good = tmp_path / "ok.json"
    good.write_text(json.dumps(AGREE, ensure_ascii=False), encoding="utf-8")
    r = subprocess.run(
        [sys.executable, str(HARNESS), "--uid", "L0072", str(good), str(bad)],
        cwd=REPO, capture_output=True, text=True, timeout=120,
    )
    assert r.returncode == 2, r.stdout


# ---------------------------------------------------------------------------
# 頁碼必須由定位器出，不能由 LLM 出（#2865）
# ---------------------------------------------------------------------------

BRIDGE = REPO / "scripts" / "locate_scanned_sections.py"
FIXTURE_PDF = REPO / "backend" / "tests" / "fixtures" / "synthetic_worksheet.pdf"


def _bridge(tmp_path, scan: list[dict], pdf: pathlib.Path):
    f = tmp_path / "scan.json"
    f.write_text(json.dumps(scan, ensure_ascii=False), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(BRIDGE), "--scan", str(f), "--pdf", str(pdf), "--uid", "L0072"],
        cwd=REPO, capture_output=True, text=True, timeout=300,
    )


@pytest.mark.skipif(not FIXTURE_PDF.is_file(), reason="沒有 fixture PDF（要 private/ 才生得出來）")
def test_llm_page_numbers_are_overridden_by_the_locator(tmp_path):
    """LLM 給錯頁碼時，出來的派工單要是對的。

    這是實際發生過的：同一份 PDF 跑三次，一次說「讀全文-做記號」只在第 1 頁，
    兩次說 1-2 頁。定位器說 1-2。少讀一頁的飛機會抽到一半然後回報成功。
    """
    wrong = [{"no": "一", "name": "讀全文-做記號", "pages": [1]},
             {"no": "二", "name": "念順順", "pages": [3]}]
    right = [{"no": "一", "name": "讀全文-做記號", "pages": [1, 2]},
             {"no": "二", "name": "念順順", "pages": [2]}]
    a = _bridge(tmp_path, wrong, FIXTURE_PDF)
    b = _bridge(tmp_path, right, FIXTURE_PDF)
    assert a.returncode == 0 and b.returncode == 0, a.stderr + b.stderr
    # 餵進去的頁碼不同，出來的必須一樣 —— 那就是「頁碼不出自 LLM」的定義
    assert a.stdout == b.stdout, (
        "餵不同的 LLM 頁碼得到不同的派工單 —— 頁碼還是出自 LLM\n"
        f"--- wrong ---\n{a.stdout}\n--- right ---\n{b.stdout}"
    )


def test_bridge_refuses_an_empty_scan(tmp_path):
    """一個大題都沒有 = 掃描失敗，不可以產出一份空派工單。"""
    r = _bridge(tmp_path, [], FIXTURE_PDF if FIXTURE_PDF.is_file() else REPO / "README.md")
    assert r.returncode == 2, r.stdout + r.stderr


def test_bridge_does_not_reimplement_the_locator():
    """橋接不可以複製定位演算法過來。

    那支的單調指派 DP 修過兩個真實 bug（子字串吃掉、散文提及被當標題）。
    複製一份 = 把那兩個 bug 放回來，而且改一邊不會改到另一邊。
    """
    src = BRIDGE.read_text(encoding="utf-8")
    assert "build_section_pages" in src, "橋接沒有借用定位器"
    for own in ("def locate(", "def candidates(", "def spans("):
        assert own not in src, f"橋接自己實作了 {own} —— 應該借用而不是複製"


# ---------------------------------------------------------------------------
# 見證對帳：裁判不能是球員（#2865）
# ---------------------------------------------------------------------------

WITNESS = REPO / "scripts" / "extract_source_witnesses.py"
RECONCILE = REPO / "scripts" / "witness_reconcile_gate.py"
SYNTH = REPO / "backend" / "tests" / "fixtures" / "synthetic_worksheet.pdf"


def _witness_mod():
    import importlib.util
    spec = importlib.util.spec_from_file_location("esw", WITNESS)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.mark.skipif(not SYNTH.is_file(), reason="沒有合成 fixture")
@pytest.mark.parametrize("section,pages,expected", [
    # 跨頁：續頁沒有再印標題。第一版整頁跳過，L0009 的第 6–12 題就是這樣丟的
    ("讀全文-做記號", [1, 2], 4),
    # 標題後面還有字（「三 語詞我最棒  在空格內填入語詞」）。第一版的 `\s*$` 對不上
    ("語詞我最棒", [3], 3),
    # 同一頁上的隔壁節，不能被算進來
    ("語詞應用", [3], 2),
])
def test_referee_counts_the_right_targets(section, pages, expected):
    """裁判要數對，而且三種版面陷阱都要過。

    這三個 case 不是想出來的，是校準時被真實版面打臉才知道的
    （12 課裡 5 課數錯，修完 12/12）。
    """
    esw = _witness_mod()
    got = [w for w in esw.witnesses(SYNTH, pages, section) if w["kind"] == "item"]
    assert len(got) == expected, f"{section} 數到 {len(got)} 題，應該是 {expected}"


@pytest.mark.skipif(not SYNTH.is_file(), reason="沒有合成 fixture")
def test_referee_refuses_when_the_section_is_not_on_that_page():
    """頁碼錯了要回空，⛔ 不可以退回「整頁都算」。

    退回整頁的話，隔壁節的題目會被算成自己的 —— 那比數不到更糟，
    因為它會產出一個看起來合理的錯誤數字。
    """
    esw = _witness_mod()
    got = esw.witnesses(SYNTH, [3], "念順順")   # 念順順 在 p2，不在 p3
    assert [w for w in got if w["kind"] == "item"] == [], \
        "在沒有這一節的頁上數到了題目 —— 那是隔壁節的"


@pytest.mark.skipif(not SYNTH.is_file(), reason="沒有合成 fixture")
def test_reconcile_gate_catches_missing_items(tmp_path):
    """漏抽要擋，而且要指名漏了哪幾題。"""
    y = tmp_path / "vocab_definitions.yml"
    y.write_text(yaml.safe_dump({"vocab_definitions": {"items": [
        {"index": 1, "word": "甲乙", "definition": "解釋一"},
    ]}}, allow_unicode=True), encoding="utf-8")
    r = subprocess.run(
        [sys.executable, str(RECONCILE), "--uid", "SYNTH", "--module", "vocab_definitions",
         "--pdf", str(SYNTH), "--section", "語詞我最棒", "--yaml", str(y), "--pages", "3"],
        cwd=REPO, capture_output=True, text=True, timeout=180,
    )
    assert r.returncode == 1, r.stdout + r.stderr
    assert "漏抽" in r.stdout, r.stdout


@pytest.mark.skipif(not SYNTH.is_file(), reason="沒有合成 fixture")
def test_reconcile_gate_passes_a_complete_extraction(tmp_path):
    """正向對照 —— 沒有它，上面的『擋住』可能只是這支恆紅。"""
    y = tmp_path / "vocab_definitions.yml"
    y.write_text(yaml.safe_dump({"vocab_definitions": {"items": [
        {"index": i, "word": w, "definition": f"解釋{i}"}
        for i, w in enumerate(["甲乙", "丙丁", "戊己"], 1)
    ]}}, allow_unicode=True), encoding="utf-8")
    r = subprocess.run(
        [sys.executable, str(RECONCILE), "--uid", "SYNTH", "--module", "vocab_definitions",
         "--pdf", str(SYNTH), "--section", "語詞我最棒", "--yaml", str(y), "--pages", "3"],
        cwd=REPO, capture_output=True, text=True, timeout=180,
    )
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.skipif(not SYNTH.is_file(), reason="沒有合成 fixture")
def test_reconcile_gate_catches_shifted_indices(tmp_path):
    """題數對但編號錯位 —— 數量相同不代表抽對了。"""
    y = tmp_path / "vocab_definitions.yml"
    y.write_text(yaml.safe_dump({"vocab_definitions": {"items": [
        {"index": i, "word": "x", "definition": "y"} for i in (11, 12, 13)
    ]}}, allow_unicode=True), encoding="utf-8")
    r = subprocess.run(
        [sys.executable, str(RECONCILE), "--uid", "SYNTH", "--module", "vocab_definitions",
         "--pdf", str(SYNTH), "--section", "語詞我最棒", "--yaml", str(y), "--pages", "3"],
        cwd=REPO, capture_output=True, text=True, timeout=180,
    )
    assert r.returncode == 1, r.stdout


def test_the_referee_has_no_llm_in_it():
    """裁判鏈上不能有 LLM —— 那是整個設計唯一重要的地方。

    見證清單由 LLM 產生的話，就回到「球員兼裁判」：
    飛機少看到 3 題、回報 3 題，數字自己對自己，永遠一致。
    """
    for path in (WITNESS, RECONCILE):
        src = path.read_text(encoding="utf-8")
        for marker in ("genai", "vertexai", "GenerativeModel", "anthropic", "openai"):
            # 只看實際 code，不看說明文字
            code = "\n".join(l for l in src.split("\n")
                             if not l.strip().startswith("#") and marker in l)
            assert not code, f"{path.name} 裡有 LLM 呼叫：{code[:80]}"


# ---------------------------------------------------------------------------
# 串接器：積木要真的被串起來（#2865）
# ---------------------------------------------------------------------------

PIPELINE = REPO / "scripts" / "run_extraction_pipeline.py"
SKILLS = REPO / ".claude" / "skills"


def test_the_pipeline_script_exists_and_has_both_halves():
    """LLM 前後各一道，缺一邊等於沒夾住。"""
    src = PIPELINE.read_text(encoding="utf-8")
    assert "def plan(" in src and "def verify(" in src


@pytest.mark.parametrize("skill,must_mention", [
    # 航母要叫整條決定性流程
    ("extract-lesson-multimodal", "run_extraction_pipeline.py"),
    # 飛機要叫見證對帳
    ("extract-module", "witness_reconcile_gate.py"),
    # overview 的頁碼要交給橋接器，不是自己回
    ("lesson-overview-scan", "locate_scanned_sections.py"),
])
def test_skill_actually_calls_its_gate(skill, must_mention):
    """門建了沒插電 = 比沒有門更糟，因為大家以為它在守。

    #2843 盤點時 16 道門只有 1 道從 CI 到得了，就是這個病；
    `pdf_pages` 也是寫在每一份派工單裡卻沒有任何消費者。
    """
    path = SKILLS / skill / "SKILL.md"
    assert path.is_file(), f"{skill} 不見了"
    assert must_mention in path.read_text(encoding="utf-8"), \
        f"{skill} 沒有叫 {must_mention}"


def test_pipeline_refuses_an_unknown_lesson():
    """材料不齊要回 2，⛔ 不可以因為「沒發現問題」就回 0。"""
    r = subprocess.run(
        [sys.executable, str(PIPELINE), "plan", "--uid", "L9999"],
        cwd=REPO, capture_output=True, text=True, timeout=180,
    )
    assert r.returncode == 2, f"未知的課回了 {r.returncode}：{r.stdout}{r.stderr}"


def test_verify_refuses_an_empty_output_dir(tmp_path):
    """一份 yml 都沒有 = 抽失敗，不是零模組。"""
    r = subprocess.run(
        [sys.executable, str(PIPELINE), "verify", "--uid", "L0072", "--out", str(tmp_path)],
        cwd=REPO, capture_output=True, text=True, timeout=180,
    )
    assert r.returncode == 2, r.stdout + r.stderr


# ---------------------------------------------------------------------------
# 跑真課跑出來的四個缺陷（#2865，2026-08-22）
#
# 這四個都不是想出來的 —— 是拿 5 課普通白話課從頭跑到尾才撞到的。
# 每一個當下的症狀都是「來源 0 題」或「抽失敗」，看起來像資料壞了，
# 實際上全是門自己的問題。假警報比沒有門更糟：紅久了大家學會忽略。
# ---------------------------------------------------------------------------

import re as _re


def _item_re():
    esw = _witness_mod()
    return esw.ITEM_RE


def _heading_re():
    esw = _witness_mod()
    return esw.HEADING_RE


@pytest.mark.parametrize("line,expected,why", [
    ("（ A ）1. 下列哪個詞語使用正確？", ["1"], "閱讀理解：題號緊貼在答案括號後"),
    ("(1)  質疑   ：對某件事", ["1"], "語詞我最棒：括號包數字"),
    ("（ C ）2. 楊俊瀚在 2018 年面對失敗的態度", ["2"], "同一行有年份也只能抓題號"),
    ("例如：這間教室可以容納 30 位學生。", [], "內文數字不是題號"),
    ("2017-2021 年楊俊瀚的體育生涯", [], "年份範圍不是題號"),
    ("字數 190 字 191~220 字", [], "字數表不是題號"),
    ("（ B ）5. 根據這篇文章", ["5"], "最後一題"),
])
def test_item_marker_regex(line, expected, why):
    """題號有兩種寫法，而且不能把內文數字誤認。

    只認 `(N)` 的話，閱讀理解**每一課都數到 0 題** —— 而那看起來像頁碼錯了。
    """
    got = [g for m in _item_re().finditer(line) for g in m.groups() if g]
    assert got == expected, why


@pytest.mark.parametrize("line,expected,why", [
    ("三    語詞我最棒", ("三", "語詞我最棒"), "一般寫法"),
    ("三 🅐  語詞我最棒", ("三", "語詞我最棒"), "🔴 同一份 DOCX 轉兩次會變成這樣"),
    ("三  語詞我最棒   在空格內填入語詞", ("三", "語詞我最棒"), "標題後面還有字"),
    ("四          語詞應用", ("四", "語詞應用"), "序號後空格超過 8 個"),
    ("ㄧ    讀全文-做記號", ("ㄧ", "讀全文-做記號"), "序號是注音（9 課原稿如此）"),
])
def test_heading_regex_survives_layout_drift(line, expected, why):
    """標題抓不到 = 整節消失，而症狀只是「來源 0 題」。

    🅐 那個 case 是實測撞到的：同一份 DOCX 轉兩次，一次乾淨、
    一次圈號跑進標題。**兩份都是 8 頁，所以 ⑤ 的頁數檢查放行。**
    """
    m = _heading_re().search(line)
    assert m, f"抓不到：{why}"
    assert (m.group(1), m.group(2)) == expected, why


def test_non_numbered_modules_are_not_reported_as_failures():
    """21 個模組裡只有 7 個是題號型。

    對 `key_reading` / `keypoints` / `spotlight` 喊「讀不到 items = 抽失敗」
    是假警報 —— 它們的內容本來就不是編號題目。
    """
    src = RECONCILE.read_text(encoding="utf-8")
    assert "NUMBERED_MODULES" in src
    import importlib.util
    spec = importlib.util.spec_from_file_location("wrg", RECONCILE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert "comprehension" in m.NUMBERED_MODULES
    assert "vocab_definitions" in m.NUMBERED_MODULES
    for not_numbered in ("key_reading", "keypoints", "spotlight", "full_text_annotate"):
        assert not_numbered not in m.NUMBERED_MODULES, \
            f"{not_numbered} 沒有編號題目，不該進對帳"


def test_resources_carrier_is_not_only_items():
    """`resources` 有 19 課只有 `videos`（實測 items+videos 120 / videos 19 / items 9）。

    只認 items 的話那 19 課會被報成抽失敗。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("wrg", RECONCILE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    src = RECONCILE.read_text(encoding="utf-8")
    assert '"videos"' in src, "載體沒有認 videos"


def test_lesson_level_files_skip_reconciliation():
    """`metadata` / `errata` 是課級檔，沒有大題，派工單自然沒有它們的節名。

    拿它們跑對帳只會得到「派工單沒有節名，驗不了」—— 又一個假警報。
    ⚠️ 但 schema 還是要驗，所以只從對帳排除。
    """
    src = PIPELINE.read_text(encoding="utf-8")
    assert "LESSON_LEVEL" in src
    assert "schema" in src, "課級檔的 schema 檢查不可以一起被跳過"
