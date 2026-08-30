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


def _callers() -> str:
    parts = [REPO / "specs" / "run-ci.sh"]
    parts += sorted((REPO / ".github" / "workflows").glob("*.yml"))
    parts += list((REPO / "backend" / "tests").rglob("*.py"))
    parts += list((REPO / "backend" / "specs").rglob("*.py"))
    parts += list((REPO / ".claude" / "skills").rglob("SKILL.md"))
    # ⛔ 排除這支自己 —— NOT_WIRED 的名字寫在這裡面，不排除的話每一支都會被
    #    算成「有人叫」，於是整支恆綠。第一版就是這樣紅在自我參照上。
    me = pathlib.Path(__file__).resolve()
    return "\n".join(p.read_text(encoding="utf-8", errors="ignore")
                     for p in parts if p.is_file() and p.resolve() != me)


def test_every_gate_script_is_either_wired_or_explained():
    """⛔ 這條就是 #2729 要的擋：新加一支門而沒接、也沒說為什麼，就紅。"""
    callers = _callers()
    unclassified = sorted(n for n in _gate_scripts()
                          if n not in callers and n not in NOT_WIRED)
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
    callers = _callers()
    both = sorted(n for n in NOT_WIRED if n in callers)
    assert not both, f"這幾支其實已經被叫了，從 NOT_WIRED 移除：{both}"


def test_every_reason_actually_says_something():
    """理由不可以是空字串或一個字 —— 那等於沒寫。"""
    thin = sorted(n for n, why in NOT_WIRED.items() if len(str(why).strip()) < 6)
    assert not thin, f"這幾支的理由太短，等於沒寫：{thin}"


def test_the_census_is_measuring_something():
    """正向對照：真的掃到門了，否則上面四條恆真。"""
    n = len(_gate_scripts())
    assert n > 30, f"只掃到 {n} 支像門的腳本 —— 量具可能壞了"
