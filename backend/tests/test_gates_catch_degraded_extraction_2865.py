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

import re
import json
import pathlib

import pytest
import yaml
from jsonschema import Draft7Validator

REPO = pathlib.Path(__file__).resolve().parents[2]
#: poppler（pdftotext / pdfinfo）在 CI 沒裝。
#: ⚠️ 這些測試**不是**可有可無 —— 它們是本機開發的主力回歸鎖。
#: skip 掉只是承認「CI 這個環境驗不了」，跟「不用驗」是兩件事。
#: 要在 CI 也跑，得在 workflow 裝 poppler-utils（見 #2868 一併處理）。
import shutil
HAS_POPPLER = bool(shutil.which("pdftotext") and shutil.which("pdfinfo"))
needs_poppler = pytest.mark.skipif(not HAS_POPPLER, reason="CI 沒裝 poppler（pdftotext/pdfinfo）")
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
    files = sorted(LESSONS.glob("L*/v3/vocab_definitions.*.yml"))[:5]
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


@needs_poppler
@pytest.mark.skipif(not FIXTURE_PDF.is_file(), reason="沒有 fixture PDF")
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


@needs_poppler
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


@needs_poppler
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


@needs_poppler
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


@needs_poppler
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


@needs_poppler
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


# ---------------------------------------------------------------------------
# 跑 30 課真課又跑出來的四個版面陷阱（#2865 第二輪）
#
# 前一輪跑 5 課，這輪跑 30 課。每多跑一批就多撞到幾個 ——
# 這正是「樣本小就別宣稱穩」的實證。
# ---------------------------------------------------------------------------

@needs_poppler
@pytest.mark.skipif(not SYNTH.is_file(), reason="沒有合成 fixture")
def test_continuation_items_after_the_next_heading():
    """雙欄下，續頁的題號可能排在**下一個大題標題之後**。

    實測 L0022 p4：第 1 行是「五 品格聚光燈」，語詞應用的第 8 題在第 4 行。
    切在標題救不了 —— 文字順序就是這樣。只收「編號接得上自己的」，
    這樣不會把隔壁節重新從 1 開始的題吃進來。
    """
    esw = _witness_mod()
    src = pathlib.Path(esw.__file__).read_text(encoding="utf-8")
    assert "_seen_max" in src, "沒有續頁編號銜接"
    assert "編號接得上自己的" in src or "nxt in tail_nums" in src


def test_split_heading_only_accepts_the_requested_section_name():
    """序號與名稱被拆成兩行時，⛔ 不可以隨便抓第一個中文詞當名稱。

    實測 L0018 p7：第 19 行只有「七」，第 20 行是別欄的內文
    「明都叫承恩，身高卻差了近三十公分」—— 抓它就造出一個假標題。
    只認派工單給的那個節名，找不到就不補。
    """
    esw = _witness_mod()
    src = pathlib.Path(esw.__file__).read_text(encoding="utf-8")
    assert "LONE_ORDINAL_RE" in src
    assert "if section in lines[j]" in src, "拆行標題沒有比對節名"


def test_resources_is_deliberately_excluded_from_reconciliation():
    """`resources` 的內容是 QR 圖與影片連結，文字層數不到。

    實測 26 課只對 20 課（77%），而錯的 6 課都不是資料壞。
    判準訂錯比沒有判準更糟 —— 所以刻意不放進名單。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("wrg", RECONCILE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert "resources" not in m.NUMBERED_MODULES
    assert "QR" in RECONCILE.read_text(encoding="utf-8"), "沒寫明為什麼排除"


def test_multi_text_lessons_are_marked_not_applicable_not_passed():
    """多文本課（4 課）同一模組對應兩個大題，頁碼是聯集、題號各篇從 1 開始。

    對帳在這裡沒有意義 —— 但回 0 必須講清楚是「不適用」而不是「驗過了」，
    否則那 4 課會被當成有守。
    """
    src = RECONCILE.read_text(encoding="utf-8")
    assert "多文本" in src
    assert "不代表**它被驗過" in src, "不適用的訊息沒有講清楚"


# ---------------------------------------------------------------------------
# 跑 147 課又撞出來的四個（#2865 第三輪）
#
# 這輪最重要的收穫不是修好幾個 bug，是**承認有一種課驗不了**。
# pdftotext 對某些雙欄版面會完全打亂文字順序（三種模式都一樣），
# 那時候任何切節規則都是錯的 —— 與其給假答案，不如說驗不了。
# ---------------------------------------------------------------------------

def test_item_ids_do_not_carry_the_page():
    """跨頁時同一題號不可以被算成兩個見證。

    實測 L0047 的語詞應用跨三頁，帶頁碼的 id 讓 8 題數成 16。
    題號在一節裡本來就唯一。
    """
    esw = _witness_mod()
    src = pathlib.Path(esw.__file__).read_text(encoding="utf-8")
    assert 'f"item-{n}"' in src, "item id 還帶著頁碼"
    assert 'f"p{p}-heading' in src, "heading 反而不該拿掉頁碼"


def test_scrambled_text_order_is_reported_not_guessed():
    """文字順序還原不出版面順序時，要說驗不了，⛔ 不可以猜。

    實測 L0038 p3：「三 語詞我最棒」排在第 39 行 —— 在它自己的題目
    和「四 語詞應用」**之後**。-layout / 預設 / -raw 三種都一樣亂。
    那時候切出來的範圍只剩 21 個字元，回報「漏抽 11 題」是假指控。
    """
    esw = _witness_mod()
    src = pathlib.Path(esw.__file__).read_text(encoding="utf-8")
    assert "ORDER-SCRAMBLED" in src
    assert "unreliable" in src
    gate = RECONCILE.read_text(encoding="utf-8")
    assert "unreliable" in gate, "對帳門沒有處理這個狀態"
    assert "這**不是**通過" in gate, "驗不了必須跟通過分得開"


def test_scrambling_check_only_looks_at_my_own_section():
    """判準只看**我要找的那一節**排錯沒有，不是整頁序號遞不遞增。

    第一版用整頁遞增，把 L0047 / L0022 這種「別節排錯、我這節好好的」
    也判成驗不了 —— 把好的判死比漏抓更糟。
    """
    esw = _witness_mod()
    src = pathlib.Path(esw.__file__).read_text(encoding="utf-8")
    assert "earlier_bigger" in src, "判準沒有收斂到自己那一節"


def test_continuation_stitching_refuses_a_restart():
    """切點之後那段如果**重新從 1 開始**，那是下一節不是我的延續。

    L0022 切點後只有 (8)，接得上我的 7 → 收。
    L0055 切點後有 (1)…(9)，重新從 1 → 不收。
    兩者長得一模一樣，少了這個判準就是多一題或少一題。
    """
    esw = _witness_mod()
    src = pathlib.Path(esw.__file__).read_text(encoding="utf-8")
    assert "1 not in tail_nums" in src, "續頁銜接沒有擋掉重新編號"


# ---------------------------------------------------------------------------
# 147 課全跑（#2865 第四輪）
#
# 這輪的核心是**分辨「驗不了」與「抽錯了」**。兩者的畫面症狀一樣，
# 但把真缺陷判成「驗不了」等於放它過去，把正確資料判成「抽錯」是假指控。
# ---------------------------------------------------------------------------

def test_unnumbered_elements_are_excluded():
    """無編號元素（跨大題的框）本來就沒有節名。

    實測 goal_box 70/70、self_check_before_reading 58/58、
    multi_text_parts 4/4、cross_text_banner 2/2 課都沒有節名。
    不排除的話 147 課裡有 31 課無故變紅。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("wrg", RECONCILE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    for mod in ("self_check_before_reading", "goal_box",
                "multi_text_parts", "cross_text_banner"):
        assert mod not in m.NUMBERED_MODULES, f"{mod} 是無編號元素，不該進對帳"
    src = PIPELINE.read_text(encoding="utf-8")
    for mod in ("goal_box", "self_check_before_reading"):
        assert mod in src, f"流程沒有排除 {mod}"


def test_scrambling_detector_distinguishes_a_real_gap():
    """🔴 這條最重要：把真缺陷判成「驗不了」= 放它過去。

    三種情況的標題前後題號分布：

        L0067 p11  標題前 1,2,3   標題後 3,4,5   → 錯亂（我的 1、2 被排到前面）
        L0022 p3   標題前 1..8    標題後 1..7    → 正常（前面是上一節的）
        L0066 p4   標題前 1,2,3…  標題後 1..7    → 正常，而且它是**真的漏抽第 8 題**

    判準是「標題後面有沒有第 1 題」。少了它，兩課正確的和一個真缺陷
    會被一起判成驗不了 —— 而 L0066 的缺口就這樣溜過去了（見 #2867）。
    """
    esw = _witness_mod()
    src = pathlib.Path(esw.__file__).read_text(encoding="utf-8")
    assert "nums_after" in src, "沒有檢查標題後面的題號"
    assert "1 not in nums_after" in src, "判準沒有收斂 —— 會把真缺陷判成驗不了"


def test_both_scrambling_shapes_are_covered():
    """兩種錯亂形狀都要抓：別節排在我前面、我的題排在我標題前。"""
    esw = _witness_mod()
    src = pathlib.Path(esw.__file__).read_text(encoding="utf-8")
    assert "earlier_bigger" in src, "缺第一種（序號更大的節排在前面）"
    assert "排在自己的標題之前" in src, "缺第二種（自己的題排在自己標題前）"


# ---------------------------------------------------------------------------
# 內容忠實度：Layer ⑥（#2865）
#
# 前面所有的門都在驗形狀。這一道驗「抄的字對不對」——
# 在它之前，把甲課的解釋抄到乙課、把正解 A 抄成 B，所有門都是綠的。
# ---------------------------------------------------------------------------

ATTEST = REPO / "scripts" / "content_fidelity_attest.py"
FIDELITY = REPO / "specs" / "modules" / "fidelity"


def _attest_mod():
    import importlib.util
    spec = importlib.util.spec_from_file_location("cfa", ATTEST)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_attestation_binds_all_three_hashes():
    """證明必須綁死原稿、yml、判準版本三者。

    少綁任何一個，證明就能被回收利用到不同的內容上 ——
    那比沒有證明更糟，因為它看起來像有守。
    """
    src = ATTEST.read_text(encoding="utf-8")
    for k in ("docx_sha256", "yaml_sha256", "gate_version"):
        assert k in src, f"證明沒綁 {k}"


def test_verify_rejects_changed_content(tmp_path):
    """yml 改過之後證明要失效 —— 那才是「綁定」的意思。"""
    m = _attest_mod()
    real = sorted(FIDELITY.glob("L*.json"))
    if not real:
        pytest.skip("還沒有任何證明")
    doc = json.loads(real[0].read_text(encoding="utf-8"))
    uid = doc["uid"]
    mod, rec = next(iter(doc["modules"].items()))
    f = REPO / "backend" / "data" / "lessons" / uid / "v3" / f"{mod}.yml"
    if not f.is_file():
        pytest.skip(f"{mod}.yml 不見了")
    # 正向對照：現在應該是有效的
    assert m.sha(f) == rec["yaml_sha256"], "證明與現況已經對不上（先重產）"
    # 負向：改一個位元組就該失效
    original = f.read_bytes()
    try:
        f.write_bytes(original + b"\n# mutation\n")
        assert m.sha(f) != rec["yaml_sha256"], "改了內容雜湊卻沒變 —— 綁定是假的"
    finally:
        f.write_bytes(original)


def test_hashes_do_not_look_like_tokens():
    """雜湊留 16 字元。

    完整的 64 字元 sha256 會被 secret 掃描器判成 Azure / CircleCI /
    Linode / LINE 的 token（實測一份證明觸發 62 次警報），
    於是每次 commit 都要 bypass —— **而習慣 bypass 就是真 secret 溜進去的方式**。
    """
    m = _attest_mod()
    assert m.HASH_CHARS <= 32, "雜湊太長，會被 secret 掃描器誤判"
    # ⚠️ 只看**雜湊欄位**。第一版掃整份 JSON 的長字串，於是模組名
    #    `self_check_before_reading`（25 字）被判成 token —— 這條鎖在
    #    語料庫從 1 份證明長到 174 份的那一刻才紅，而它抓的是自己的判準錯，
    #    不是資料有問題。判準太寬的鎖跟沒有鎖一樣沒用：它會被當成雜訊關掉。
    for f in FIDELITY.glob("L*.json"):
        doc = json.loads(f.read_text(encoding="utf-8"))
        hashes = [doc.get("docx_sha256", "")] + [
            rec.get("yaml_sha256", "") for rec in (doc.get("modules") or {}).values()
        ]
        too_long = [h for h in hashes if len(h.replace("-", "")) > m.HASH_CHARS]
        assert not too_long, f"{f.name} 的雜湊沒截短：{too_long[:2]}"
        # 分組也是必要的 —— 純十六進位會撞台灣身分證 / 手機號規則，
        # 而習慣去 touch bypass marker 就是真 secret 溜進去的方式。
        flat = [h for h in hashes if h and "-" not in h]
        assert not flat, f"{f.name} 的雜湊沒分組：{flat[:2]}"
        raw = f.read_text(encoding="utf-8")
        assert not re.findall(r"[A-Za-z][12]\d{8}", raw), f"{f.name} 有像身分證的字串"
        assert not re.findall(r"09\d{8}", raw), f"{f.name} 有像手機號的字串"


def test_url_source_is_excluded_but_passage_source_is_not():
    """溯源註記不該進逐字門，但**不可以一律排除所有 `*_source`**。

    `url_source`（291 處）是我方記「這連結出自哪張總表」—— 原稿沒有這行字。
    `passage_source` 是「（本文出自國立編譯館）」—— 那是原稿印的出處註記，該檢查。
    一律排除等於把該驗的也放掉。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("vg", REPO / "scripts" / "verbatim_gate.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert "url_source" in m.ANNOTATION_KEYS
    assert "passage_source" not in m.ANNOTATION_KEYS, \
        "passage_source 是原稿印的出處，不可以排除"


def test_zero_checked_strings_is_not_a_pass():
    """「一個字串都沒被檢查」不是通過，是沒驗到。"""
    src = ATTEST.read_text(encoding="utf-8")
    assert "受檢 0" in src or "total == 0" in src, "沒有處理『零受檢』的情況"


# ---------------------------------------------------------------------------
# ⑥a 重跑一致率 + ② 的隨機性（#2865）
# ---------------------------------------------------------------------------

REP = REPO / "scripts" / "eval_extract_repeatability.py"


def test_repeatability_tool_separates_content_from_annotation():
    """教學內容與自由註記要分開報。

    實測 L0072 語詞我最棒跑三次：題數、題號、答案、解釋逐字、欄位集合
    **全部 3/3 相同**，飄的只有 `notes` —— 三個任務描述同一件事用了
    三個不同的 key（layout / section_boundary / page_boundary）。

    混在一起報「不一致」會讓人以為內容會飄；完全不報又會漏掉真的差異。
    ⚠️ 第一版就漏了：報「每一層都一致」，但三個檔案大小是 1699/1561/1512。
    """
    src = REP.read_text(encoding="utf-8")
    assert "CONTENT" in src and "ANNOT" in src, "沒有分層"
    assert "if layer in CONTENT:" in src, "註記層不該計入 exit code"


def test_repeatability_tool_compares_definitions_verbatim():
    """只比題數會騙人 —— 三份可以題數相同而解釋全不一樣。"""
    src = REP.read_text(encoding="utf-8")
    for layer in ("題數", "題號集合", "答案", "解釋逐字", "欄位集合"):
        assert layer in src, f"少了 {layer} 這一層"


def test_docx_conversion_does_not_pretend_to_be_deterministic():
    """⛔ 不要在轉檔腳本裡加重試或多數決。

    實測 20 次單轉：8 頁 9 次 / 9 頁 11 次 —— 55/45，幾乎是擲硬幣。
    在那個分布下三次取多數只有 57% 命中多數值，等於沒用（實際跑 6 次
    仍然 8/9 交錯）。

    正確做法是把 PDF 當一次性產物，整條流程用同一份 ——
    那是 assert_pdf_matches_manifest.py 在守的事。
    """
    src = (REPO / "scripts" / "docx_to_pdf.sh").read_text(encoding="utf-8")
    assert "不是決定性" in src, "沒有寫明這件事"
    assert "DOCX2PDF_ATTEMPTS" not in src, "多數決沒移乾淨 —— 它只有 57% 命中"
    # 排除過的假設要留在檔案裡，否則下一個人會再驗一次
    for ruled_out in ("冷熱 profile", "字型替換", "三次取多數"):
        assert ruled_out in src, f"沒記錄排除過「{ruled_out}」"


# ---------------------------------------------------------------------------
# ⑤ 從「只比頁數」升級成「比每頁文字指紋」（#2865）
# ---------------------------------------------------------------------------

def test_page_print_catches_layout_drift_but_ignores_whitespace():
    """指紋要抓得到版面重排，又不能被空白數量騙。

    🔴 第一版先 `normalise` 再雜湊 —— 而 normalise 的工作就是洗掉符號，
    於是「三　語詞我最棒」→「三 🅐 語詞我最棒」的差異**抓不到**，
    而那正是這道門要抓的東西（兩份都 8 頁、字也一樣，只是標題多了圈號，
    切節就切不到了）。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "bsp", REPO / "scripts" / "build_section_pages.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    base = "三　語詞我最棒 請在空格內填入"
    assert m.page_print(base) != m.page_print("三 🅐 語詞我最棒 請在空格內填入"), \
        "塞了圈號卻抓不到 —— 指紋沒有用"
    assert m.page_print(base) == m.page_print("三　語詞我最棒    請在空格內填入"), \
        "只是空白數不同就報警 —— 這道門會恆紅"


def test_page_prints_are_stored_and_are_not_token_shaped():
    """指紋要真的存進派工單，而且不能長得像 token。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "bsp", REPO / "scripts" / "build_section_pages.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.PRINT_CHARS <= 20, "指紋太長，會被 secret 掃描器誤判成 token"

    db = REPO / "specs" / "modules" / "section-pages.yml"
    if not db.is_file():
        pytest.skip("沒有 section-pages.yml")
    doc = yaml.safe_load(db.read_text(encoding="utf-8")) or {}
    with_prints = [u for u, e in (doc.get("lessons") or {}).items()
                   if isinstance(e, dict) and e.get("page_prints")]
    assert with_prints, "一課都沒有指紋 —— 這道門形同不存在"
    for u in with_prints[:5]:
        e = doc["lessons"][u]
        assert len(e["page_prints"]) == e["pdf_pages"], \
            f"{u} 的指紋數與頁數對不上"


def test_missing_prints_are_skipped_not_treated_as_mismatch():
    """舊資料沒有指紋 —— 要跳過，⛔ 不可以當成不符。

    把「沒存」當成「不符」會讓每一課都紅，而那道門紅久了就等於沒有。
    """
    src = (REPO / "scripts" / "assert_pdf_matches_manifest.py").read_text(encoding="utf-8")
    assert "這課還沒存指紋" in src or "return None   # 這課還沒存指紋" in src, \
        "沒有處理『舊資料沒指紋』"
    assert "算不出這份 PDF 的頁面指紋" in src, \
        "算不出來時必須擋，不可以當成比對過了"


def test_page_prints_do_not_look_like_taiwan_id_or_phone():
    """指紋不可以長得像個資 —— ⛔ 這條不是潔癖。

    第一版是純十六進位 12 碼，172 課裡有 7 個長成 `b26431196…`
    （字母 + 1/2 + 8 位數 = 台灣身分證的形狀），pre-commit 直接擋下。
    當下最省事的做法是 touch bypass marker —— 而那正是
    「習慣繞掃描器，真的 secret 遲早跟著過去」的起點。
    正解是改格式。這條鎖住它別被改回去。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "bsp", REPO / "scripts" / "build_section_pages.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert "-" in m.page_print("x"), "指紋沒有分組 —— 會撞回掃描器"

    db = REPO / "specs" / "modules" / "section-pages.yml"
    if not db.is_file():
        pytest.skip("沒有 section-pages.yml")
    raw = db.read_text(encoding="utf-8")
    assert not re.findall(r"[A-Za-z][12]\d{8}", raw), "檔裡有像身分證的字串"
    assert not re.findall(r"09\d{8}", raw), "檔裡有像手機號的字串"


# ---------------------------------------------------------------------------
# ⑦b 內容忠實度證明 —— 門要真的插電（#2865）
# ---------------------------------------------------------------------------

def test_fidelity_gate_is_actually_wired_into_ci():
    """⛔ 門建了沒插電比沒有門更糟 —— 大家會以為它在看。

    2026-08-22 之前：`content_fidelity_attest.py` 存在、只有 **1 課**有證明、
    而且沒有任何 workflow 或 run-ci 跑過它。這條鎖住「它在具名清單裡」。
    """
    ci = (REPO / "specs" / "run-ci.sh").read_text(encoding="utf-8")
    assert "content_fidelity_attest.py --verify-all" in ci, \
        "run-ci.sh 沒有跑內容忠實度門"

    wf = REPO / ".github" / "workflows" / "spec-check.yml"
    assert "specs/run-ci.sh" in wf.read_text(encoding="utf-8"), \
        "spec-check.yml 不再跑 run-ci.sh —— 上面那條就白鎖了"


def test_every_lesson_has_a_fidelity_attestation():
    """覆蓋率要用**數量**斷言，不是「至少有一份」。

    只驗「有沒有存在一份證明」的話，1 份跟 174 份長得一樣綠 ——
    而 1 份正是這道門躺了整段時間的實際狀態。
    """
    lessons = {p.parent.parent.name
               for p in (REPO / "backend" / "data" / "lessons").glob("L*/v3/_manifest.yml")}
    attested = {p.stem for p in (REPO / "specs" / "modules" / "fidelity").glob("L*.json")}
    missing = sorted(lessons - attested)
    assert not missing, f"{len(missing)} 課沒有內容忠實度證明：{missing[:8]}"
    assert len(attested) >= 174, f"證明只有 {len(attested)} 份"


def test_fidelity_records_three_states_not_two():
    """「一個字串都沒驗到」跟「驗了對不上」不可以混成同一個紅燈。

    混成一個會製造**沒有人修得掉的紅**（22 份 errata 的原文只有一個字，
    短於 4 字門檻本來就驗不到），而恆紅的門最後會被關掉。
    ⛔ 但也不可以判 pass —— 那是把「沒驗」講成「驗過了」。
    """
    seen = set()
    for p in (REPO / "specs" / "modules" / "fidelity").glob("L*.json"):
        for rec in (json.loads(p.read_text(encoding="utf-8")).get("modules") or {}).values():
            assert "status" in rec, f"{p.stem} 還在用兩態"
            seen.add(rec["status"])
    assert seen <= {"pass", "fail", "unverifiable"}, f"冒出沒定義的狀態：{seen}"
    assert "unverifiable" in seen, "一個 unverifiable 都沒有 —— 三態是假的"


def test_unverifiable_count_is_ratcheted():
    """驗不到的數量只准往下 —— 無聲增加 = 覆蓋率在漏，而每次都是綠的。"""
    ratchet = REPO / "specs" / "modules" / "fidelity" / "_ratchet.json"
    assert ratchet.is_file(), "沒有棘輪基準檔，那個數字就可以無限漲"
    cap = json.loads(ratchet.read_text(encoding="utf-8"))["unverifiable_max"]
    actual = sum(
        1
        for p in (REPO / "specs" / "modules" / "fidelity").glob("L*.json")
        for rec in (json.loads(p.read_text(encoding="utf-8")).get("modules") or {}).values()
        if rec.get("status") == "unverifiable"
    )
    assert actual <= cap, f"驗不到的從 {cap} 漲到 {actual}"


def test_gate_emits_machine_readable_checked_count():
    """受檢數要走契約行，⛔ 不要刮中文散文。

    刮的那版把**每一份** attestation 都算成 4 —— 它切全形「：」但輸出用半形，
    於是整行都進去，再把非數字濾掉，從「≥ 4」跟真正的數字湊出 "04"。
    我拿那個數字對外報過「1176 字串」「308196 字串」，全是假的。
    """
    gate = (REPO / "scripts" / "verbatim_gate.py").read_text(encoding="utf-8")
    assert "VERBATIM_GATE_CHECKED=" in gate, "逐字門沒印契約行"
    att = (REPO / "scripts" / "content_fidelity_attest.py").read_text(encoding="utf-8")
    assert "VERBATIM_GATE_CHECKED=" in att, "attest 沒讀契約行"
    assert 'line.split("：")' not in att, "還在刮中文散文"
