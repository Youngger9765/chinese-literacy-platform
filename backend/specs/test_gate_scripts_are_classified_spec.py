"""每一支「像門」的腳本都要有明確去處：接上了，或說得出為什麼不接（#2729）。

#2729 的一句話是「**我擅長局部迴圈，不行的是連接**」，並要求
「要擋，不要提醒」。這支就是那個擋。

2026-08-31 普查：65 支像門的腳本，**21 支沒有任何 CI／測試／skill 叫它**。
逐支跑過之後，那 21 支分成三種，而且**第三種是這張票真正的教訓**：

  ① 一次性工具（migrate_* / convert_* / parse_*）—— 本來就不該進 CI
  ② 今天就能跑、也該接的     —— 例：`essential_fields_check.py`（175 課 PASS）
  ③ **建在一個已經不存在的世界上** —— 接上去只會多一盞永久紅燈

③ 的實例（本次普查發現）：

    spotlight_regression_check.py   61 課「spotlight 整個 load 不出」
    keypoints_regression_check.py   文-L9「列數 5→4 掉列」

兩支都 import `lesson_loader`（**舊的**：57 課 Layer 1 + manifest 158 課），
而服務端真相是 `lesson_uid_loader` 的 175 課；兩支的 baseline 都立於
**2026-06-24（一版）**，比的是二修的內容。

⭐ 所以「連接既有的東西」不能無條件做 —— **既有的東西有一部分在描述舊世界**。
判斷順序是：先問它描述的世界還在不在，再問要不要接。
"""
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "scripts"

#: 「像門」＝ 有 __main__ 且會回非零或印 GATE/PASS/FAIL
_GATEISH = re.compile(r"(GATE=|_GATE\b|return 1\b|sys\.exit\(1|SystemExit\(1|=PASS|=FAIL)")

#: 刻意不接，理由逐支寫死。⛔ 加新的一定要寫理由，不可以只是加名字。
NOT_WIRED = {
    "lint_prompt_overfit.py":
        "🔴 它的預設輸入目錄 `backend/data/lessons/_ai_lessons` **不存在** —— "
        "裸跑印 ADAPTER_OVERFIT_PASS 但沒有東西可掃。接了就是一盞假燈。"
        "要接必須先給它一個真的存在的 --lessons-dir。",
    # ③ 建在舊世界上（續）—— 這批是更嚴的偵測（行層級判「真的在叫」）才撈出來的
    "keypoints_shape_gate.py":
        "🔴 建在舊世界：找 `v3/keypoints.yml`（寫死無 slug），而 #2916 之後 155 個檔全有 slug "
        "→ 它檢查 **0 課**卻印 KEYPOINTS_SHAPE_GATE=PASS。接了就是一盞永遠綠的假燈。"
        "要接必須先改成 glob `keypoints.*.yml`。",
    "check_curriculum_drift.py": "需要 --source 或 MANIFEST.source_dir（原稿），裸跑 exit 2",
    "merge_reparsed_to_prod.py": "舊 regex 管線的合併工具（#2751），且需要 --demo/--all 參數",
    "extract_source_witnesses.py": "#2865 裁判鏈的一半，需要 --uid 等參數，由 witness_reconcile_gate 那條路帶",
    "eval_overview_repeatability.py": "需要多次 LLM 掃描結果當輸入（見 #2854 盤點）",
    "skill_dryrun_diff.py": "需要參數（比對 skill 乾跑輸出），由人在改 skill 時手動叫",
    # ① 一次性 / 建置期工具
    "batch_all_lessons.py": "一次性批次建置，不是門",
    "build_lesson_registry.py": "建置期產 registry",
    "build_lesson_uid_registry.py": "建置期產 registry",
    "convert_docx_to_pdf.py": "DOCX→PDF 轉檔工具，派工單流程的前置，不是門",
    "extract_docx_blocks.py": "把 DOCX 拆成 block 的抽取工具，供其他腳本呼叫",
    "gen_lesson_intent.py": "抽取工具（且輸入指向已刪的 _online-schema，見 #2751）",
    "generate_vocab_bank.py": "產語詞庫的工具",
    "migrate_ai_fallback_to_table.py": "一次性 migration",
    "parse_materials.py": "舊 regex 管線的產物（#2751）",
    "pre-generate-example-sentences.py": "預產例句的工具",
    "reconcile_reading_audio_orphans.py": "音檔清理工具",
    "refresh_keypoints_manifest.py": "建置期重整 manifest",
    "spotlight_convert_guided_steps.py": "一次性資料轉換",
    "yml_canonicalise_aliases.py": "一次性正規化",
    # ② 需要參數/原稿，不能裸跑
    "errata_locator_check.py": "跑得起來但目前只吐 🟡『這種 locator 還沒有驗法』，沒有判斷力",
    "spotlight_contract.py": "需要 --dev7 / --test15 fixture 參數",
    "validate_lesson_content.py": "需要 paths / --fixtures / --dir",
    "spotlight_judge_calibration.py": "校準用，要人看",
    # ③ 建在舊世界上 —— 接了只會多一盞永久紅燈
    "spotlight_regression_check.py":
        "🔴 建在舊世界：import 舊的 lesson_loader（57 課 Layer 1），"
        "baseline 立於 2026-06-24（一版）→ 61 課報『spotlight 整個 load 不出』，"
        "但那些課的 spotlight.{slug}.yml 都在、API 也服務得出來。要接必須先改讀 "
        "lesson_uid_loader 並對二修重立 baseline。",
    "keypoints_regression_check.py":
        "🔴 同上：舊 loader + 2026-06-24 的一版 baseline，"
        "報出來的『掉列』是版本差異不是缺陷。",
}


def _gate_scripts() -> list[str]:
    out = []
    for f in sorted(SCRIPTS.glob("*.py")):
        src = f.read_text(encoding="utf-8", errors="ignore")
        if "__main__" in src and _GATEISH.search(src):
            out.append(f.name)
    return out


def _invocation_lines() -> list[str]:
    """只收「看起來像在叫它」的那些行。

    ⛔ 不可以用「整份檔案含這個檔名」判 —— 別的 spec 只是在 docstring 裡**提到**
       它（例如解釋為什麼不接），就會被算成「有人叫」，於是整支恆綠。
       2026-08-31 實際踩到：我在 provenance 那支的 docstring 寫了兩支 checker 的名字，
       這條當場紅了。
    """
    lines: list[str] = []
    for p in [REPO / "specs" / "run-ci.sh"] + sorted((REPO / ".github" / "workflows").glob("*.yml")):
        if p.is_file():
            lines += p.read_text(encoding="utf-8", errors="ignore").split("\n")
    me = pathlib.Path(__file__).resolve()
    code_dirs = [REPO / "backend" / "tests", REPO / "backend" / "specs",
                 REPO / ".claude" / "skills"]
    for d in code_dirs:
        for f in list(d.rglob("*.py")) + list(d.rglob("SKILL.md")):
            if not f.is_file() or f.resolve() == me:
                continue
            for ln in f.read_text(encoding="utf-8", errors="ignore").split("\n"):
                # 像呼叫：subprocess / python 指令 / import / 組路徑
                if any(k in ln for k in ("subprocess", "sys.executable", "python ",
                                         "python3 ", "import ", "SCRIPTS /", 'scripts/"')):
                    lines.append(ln)
    return lines


def _is_called(name: str) -> bool:
    return any(name in ln for ln in _invocation_lines())


def test_every_gate_script_is_either_wired_or_explained():
    """⛔ 這條就是 #2729 要的擋：新加一支門而沒接、也沒說為什麼，就紅。"""
    unclassified = sorted(n for n in _gate_scripts()
                          if not _is_called(n) and n not in NOT_WIRED)
    assert not unclassified, (
        f"{len(unclassified)} 支像門的腳本沒有人叫、也沒寫為什麼不接：\n  "
        + "\n  ".join(unclassified)
        + "\n→ 接進 specs/run-ci.sh，或加進這支的 NOT_WIRED 並寫明理由。"
          "\n⚠️ 接之前先問：它描述的世界還在嗎？（見本檔 docstring 的 ③）")


def test_the_not_wired_list_has_no_dead_entries():
    """反向：列表裡的檔不存在了就要清掉，不然它會一直長。"""
    gone = sorted(n for n in NOT_WIRED if not (SCRIPTS / n).is_file())
    assert not gone, f"NOT_WIRED 裡這幾支已經不在了：{gone}"


def test_the_not_wired_list_is_not_hiding_wired_ones():
    """反向之二：已經接上的不該還掛在「不接」的名單裡（讀的人會被誤導）。"""
    both = sorted(n for n in NOT_WIRED if _is_called(n))
    assert not both, f"這幾支其實已經被叫了，從 NOT_WIRED 移除：{both}"


def test_every_reason_actually_says_something():
    """理由不可以是空字串或一個字 —— 那等於沒寫。"""
    thin = sorted(n for n, why in NOT_WIRED.items() if len(str(why).strip()) < 6)
    assert not thin, f"這幾支的理由太短，等於沒寫：{thin}"


def test_the_census_is_measuring_something():
    """正向對照：真的掃到門了，否則上面四條恆真。"""
    n = len(_gate_scripts())
    assert n > 30, f"只掃到 {n} 支像門的腳本 —— 量具可能壞了"
