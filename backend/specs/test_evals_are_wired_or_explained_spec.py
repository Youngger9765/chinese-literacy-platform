"""六支 eval 的盤點：能跑的要接進 CI，不能跑的要說得出為什麼（#2854）。

⑥ 內容忠實度是唯一會在「結構全對但內容放錯課」時變紅的一層，
而票開的時候它**一道 CI 都沒有**。料是齊的 —— 6 支 harness 都在，只是沒人跑。

2026-08-31 逐支實跑：

| eval | 今天能在 CI 跑嗎 | 狀況 |
|---|---|---|
| `eval_strategy_validate.py` | ✅ | fixtures 2 PASS，不加 `--live` 不打 LLM |
| `eval_lesson_content.py --fixtures` | ✅ | RESULT: PASS |
| `eval_lesson_schema.py --all` | ❌ | schema-dir 預設指已刪的 `_online-schema` → **0/0 靜默空跑** |
| `eval_keypoints_text_fidelity.py` | ❌ | **沒有 `main()`**，直接跑 exit 0 零輸出；輸入也指向已刪目錄 |
| `eval_extract_repeatability.py` | ❌ | 需要多次 LLM 抽取結果比對 |
| `eval_overview_repeatability.py` | ❌ | 同上 |

⛔ 最危險的是中間那兩支：**exit 0、零輸出**，接進 CI 只會多兩盞假綠燈。
這支鎖擋的就是那個 —— 能跑的要真的跑出案例數，不能跑的要留下理由。
"""
import pathlib
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]

#: 今天就能在 CI 跑（不需原稿、不打 LLM）—— 每一支都要跑出 > 0 個案例
RUNNABLE = {
    "eval_strategy_validate.py": ([], "PASS"),
    "eval_lesson_content.py": (["--fixtures"], "PASS"),
}
#: 不能跑的，理由要寫在檔案裡（否則下一個人會以為只是沒人接）
BLOCKED = {
    "eval_lesson_schema.py": "_online-schema",
    "eval_keypoints_text_fidelity.py": "_online-schema",
    "eval_extract_repeatability.py": "runs",
    "eval_overview_repeatability.py": "runs",
}


@pytest.mark.parametrize("name,spec", sorted(RUNNABLE.items()))
def test_runnable_evals_actually_produce_cases(name, spec):
    """⛔ 不是「exit 0 就算過」—— 要真的印出結果。

    `eval_keypoints_text_fidelity.py` 直接跑就是 exit 0 零輸出（它沒有 main），
    照 exit code 收會多一盞假綠燈。
    """
    args, want = spec
    p = REPO / "scripts" / name
    assert p.is_file(), f"{name} 不在"
    r = subprocess.run([sys.executable, str(p), *args], cwd=REPO,
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, f"{name} exit {r.returncode}\n{r.stdout[-500:]}{r.stderr[-500:]}"
    assert want in r.stdout, (
        f"{name} 沒有印出 {want!r} —— exit 0 但沒跑出東西，那是假綠。\n{r.stdout[-400:]}")


@pytest.mark.parametrize("name,marker", sorted(BLOCKED.items()))
def test_blocked_evals_say_why(name, marker):
    """跑不了的要留下線索，不然下一個人會以為只是沒人接。"""
    p = REPO / "scripts" / name
    assert p.is_file(), f"{name} 不在"
    src = p.read_text(encoding="utf-8")
    assert marker in src, (
        f"{name} 裡找不到 {marker!r} —— 它跑不了的理由變了？重新盤點並更新這條")


def test_the_wired_ones_are_actually_in_run_ci():
    """⛔ 盤點完不接 = 這張票白做。"""
    ci = (REPO / "specs" / "run-ci.sh").read_text(encoding="utf-8")
    missing = sorted(n for n in RUNNABLE if n not in ci)
    assert not missing, f"這幾支能跑卻沒接進 run-ci.sh：{missing}"


def test_the_broken_ones_are_not_wired():
    """正向對照：不能跑的**不准**接 —— 接了就是兩盞假綠燈。"""
    ci = (REPO / "specs" / "run-ci.sh").read_text(encoding="utf-8")
    wired = sorted(n for n in ("eval_keypoints_text_fidelity.py", "eval_lesson_schema.py")
                   if n in ci)
    assert not wired, (
        f"{wired} 被接進 CI 了 —— 它們 exit 0 但零輸出／0 案例，是假綠。"
        "要接的話先修好它們（見 #2751 的已刪目錄）並改寫這條")
