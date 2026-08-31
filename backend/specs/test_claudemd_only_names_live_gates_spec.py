"""CLAUDE.md 說「必跑」的門，必須真的跑得起來。

2026-08-30 之前 CLAUDE.md 寫著：改聚光燈／重點表的 PR「**必跑** content evidence gate…
必須印 `CONTENT_EVIDENCE_GATE=PASS`」。

那道門：
  · 在**任何 workflow 裡都沒有**（`specs/run-ci.sh:125` 自己就這樣寫著）
  · golden 凍結在 2026-07-03，早於 #2736 的多模態重抽 → `golden_match` 對現行內容恆紅

也就是說**照 CLAUDE.md 做的人會被一個過不了的門擋住**，然後多半就繞過它 ——
而繞過去之後，那一整段紀律就跟著失效了。

這條守的是：CLAUDE.md 點名「必跑」的每一個腳本，都要在 workflow 或 run-ci.sh 裡真的被叫到。
"""
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
CLAUDE = REPO / "CLAUDE.md"
RUNNERS = [REPO / "specs" / "run-ci.sh"] + sorted((REPO / ".github" / "workflows").glob("*.yml"))


def _runner_text() -> str:
    return "\n".join(p.read_text(encoding="utf-8") for p in RUNNERS if p.is_file())


def _mandatory_scripts() -> set:
    """CLAUDE.md 裡被「必跑 / 必先跑 / 必須跑」修飾的那一行提到的 scripts/*.py|sh"""
    out = set()
    for line in CLAUDE.read_text(encoding="utf-8").split("\n"):
        if not any(w in line for w in ("必跑", "必先跑", "必須跑")):
            continue
        # ⚠️ 不能只找 `scripts/` —— 真正在跑的那道門住在 `specs/run-ci.sh`。
        #    只找一個目錄的話，把必跑門改指向另一個目錄就會讓這條靜靜地變恆真。
        out |= set(re.findall(r"(?:scripts|specs)/[A-Za-z0-9_./-]+\.(?:py|sh)", line))
    return out


def test_every_gate_claudemd_calls_mandatory_is_actually_wired():
    """⛔ 點名必跑卻沒有人跑 = 照做的人被擋住，然後整段紀律被繞過。"""
    runners = _runner_text()
    dead = sorted(s for s in _mandatory_scripts() if s not in runners)
    assert not dead, (
        "CLAUDE.md 說這些必跑，但 workflow 與 run-ci.sh 都沒有叫它們：\n  "
        + "\n  ".join(dead)
        + "\n→ 要嘛接上去，要嘛把 CLAUDE.md 改成實話（並說為什麼不跑）。")


def test_the_named_scripts_exist_on_disk():
    """順帶擋掉「指向已刪檔案」的那種漂移。"""
    missing = sorted(s for s in _mandatory_scripts() if not (REPO / s).is_file())
    assert not missing, f"CLAUDE.md 點名的腳本不在磁碟上：{missing}"


def test_the_gate_is_measuring_something():
    """正向對照：真的有抓到「必跑」的行，否則上面兩條恆真。"""
    found = _mandatory_scripts()
    assert found, "CLAUDE.md 裡一個「必跑 + scripts/」的組合都沒抓到 —— 量法可能壞了"


@pytest.mark.parametrize("script", sorted(_mandatory_scripts()))
def test_each_mandatory_script_names_its_runner(script):
    """逐支列出來，紅的時候一眼看得到是哪一支（不是一整包）。"""
    assert script in _runner_text(), f"{script} 被 CLAUDE.md 列為必跑，但沒有任何 runner 叫它"
