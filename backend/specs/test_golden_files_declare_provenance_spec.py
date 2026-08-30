"""對照組要說得出自己從哪來（#2729 機制 4）。

票上的原話：**「測試的對照組不可以是 pipeline 的產物 —— 產物會跟著被測的東西一起移動。」**

那條到今天為止只是文字。這支把它變成擋 —— 但**不是禁止**用 pipeline 產物當
baseline（棘輪本來就得那樣做），而是**要求它說出來**：
從哪來、哪一版、什麼時候凍的。少了這幾行，下一個人就會拿它當「真值」。

## 這條為什麼是今晚寫的

`spotlight_regression_baseline.json` 與 `keypoints_regression_baseline.json`
都凍於 **2026-06-24（一版）**，而二修（#2683）在 2026-08。兩支對應的檢查器今天是紅的：

    spotlight  61 課「spotlight 整個 load 不出」
    keypoints  文-L9「列數 5→4 掉列」

看起來像內容不見了。實查 L0157 有 `spotlight.na3kk.yml`、API 也服務得出來 ——
兩支都 import 舊的 `lesson_loader`（57 課 Layer 1），而服務端是 175 課。

⭐ 這是今晚第三次被「拿一版當裁判」咬到（另兩次見 `docs/pdca/2026-08-key-reading-range.md`）。
所以判準不是「不准用」，是**「不准不說」**。

## 既有的債

其餘 8 個 committed golden 也沒有 provenance，列在 `GRANDFATHERED` 裡設棘輪 ——
只能變少。⛔ 新的不收。
"""
import json
import pathlib
import re
import subprocess

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]

#: 這幾行任一出現就算「說得出從哪來」
_PROV = re.compile(r"_provenance|derived_from|generated_by|frozen_at|來源|原稿|人工")

#: 2026-08-31 的既有債，逐條列在 docs/qa/golden-provenance-debt.txt。
#: ⛔ 只准變少 —— 新的 golden 一律要寫 `_provenance`。
DEBT_FILE = REPO / "docs" / "qa" / "golden-provenance-debt.txt"


def _debt() -> set:
    return {l.strip() for l in DEBT_FILE.read_text(encoding="utf-8").split("\n")
            if l.strip() and not l.startswith("#")}


def _committed_goldens() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=REPO,
                         capture_output=True, text=True).stdout.split("\n")
    return [f for f in out
            if f and f.endswith((".json", ".yml", ".yaml"))
            and re.search(r"(golden|baseline)", f)
            # 掃描產出的暫存目錄不是對照組
            and not f.startswith(".qa-screenshots/")]


def _without_provenance() -> list[str]:
    bad = []
    for f in _committed_goldens():
        p = REPO / f
        if not p.is_file():
            continue
        if not _PROV.search(p.read_text(encoding="utf-8", errors="ignore")[:6000]):
            bad.append(f)
    return sorted(bad)


def test_no_new_golden_without_provenance():
    """⛔ 新的對照組一定要說得出從哪來。"""
    new = sorted(set(_without_provenance()) - _debt())
    assert not new, (
        f"{len(new)} 個 golden/baseline 沒說從哪來：\n  " + "\n  ".join(new)
        + "\n→ 加一段 `_provenance`：derived_from / frozen_at / edition。"
          "\n⚠️ 如果它是 pipeline 的產物，**更要寫** —— 產物會跟著被測的東西一起移動。")


def test_the_debt_only_shrinks():
    """棘輪：既有的債只能還不能欠。"""
    n = len(_without_provenance())
    ceiling = len(_debt())
    assert n <= ceiling, f"沒有 provenance 的 golden 從 {ceiling} 變成 {n}"


def test_the_debt_list_has_no_stale_entries():
    """反向：債清單裡已經還掉（或刪掉）的要移除，否則棘輪會被墊高。"""
    stale = sorted(_debt() - set(_without_provenance()))
    assert not stale, (
        f"這幾條已經不是債了（有 provenance 或檔案不在），從清單移除：{stale[:6]}")


def test_the_two_first_edition_baselines_now_say_so():
    """今晚查到的那兩份要留下警語，否則下一個人又會信它。"""
    for f in ("backend/data/curriculum_qa/spotlight_regression_baseline.json",
              "backend/data/curriculum_qa/keypoints_regression_baseline.json"):
        d = json.loads((REPO / f).read_text(encoding="utf-8"))
        prov = d.get("_provenance") or {}
        assert prov.get("edition"), f"{f} 沒寫是哪一版"
        assert "一版" in str(prov["edition"]), f"{f} 的 edition 變了？重新查證再改這條"
        assert "lesson_uid_loader" in str(prov.get("warning") or ""), (
            f"{f} 的警語沒說要怎麼重新啟用")


def test_the_checkers_skip_metadata_keys():
    """⛔ 加 metadata 不可以把檢查器弄壞 —— 我加完就踩到 KeyError: 'row_count'。"""
    for s in ("keypoints_regression_check.py", "spotlight_regression_check.py"):
        src = (REPO / "scripts" / s).read_text(encoding="utf-8")
        assert 'code.startswith("_")' in src, f"{s} 沒有跳過底線開頭的 metadata key"


def test_the_scan_finds_something():
    """正向對照：真的掃到 golden，否則上面幾條恆真。"""
    assert len(_committed_goldens()) >= 10, "掃到的 golden 太少 —— 量具可能壞了"
