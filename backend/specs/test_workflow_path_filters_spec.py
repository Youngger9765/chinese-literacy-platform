"""路徑過濾不可以再用 `on.*.paths`（#2916 收尾）。

GitHub 的 `paths:` 只看**前 300 個變更檔**。一個批次改名的 PR（#2920 改了
3691 個檔，前 300 個全是 `backend/data/lessons/**`）會讓所有 paths 指向
`frontend/**` 的 workflow 判定「沒有相關變更」而跳過 ——
**而且檢查清單上不會出現那一列**，看起來就是全綠。紅燈還會被看到，
不出現的那一列不會。

改用 `dorny/paths-filter`（repo 既有做法，算完整 diff）。這條盯著不要改回去。
"""
from __future__ import annotations

import pathlib

import pytest
import yaml

WF = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows"

#: 這幾支的觸發條件曾經因為 300 上限而失效，改用 paths-filter 之後不可以退回去。
GUARDED = ["frontend-checks.yml", "e2e-tests.yml", "schema-check.yml"]


def _load(name):
    d = yaml.safe_load((WF / name).read_text(encoding="utf-8"))
    # PyYAML 把裸 `on:` 讀成布林 True
    return d, (d.get("on") or d.get(True) or {})


def test_the_workflow_dir_is_there():
    """正向對照 —— 少了它，下面每一條都可能在對空集合斷言。"""
    n = len(list(WF.glob("*.yml")))
    assert n > 10, f"只找到 {n} 個 workflow —— 路徑錯了"


@pytest.mark.parametrize("name", GUARDED)
def test_no_paths_filter_on_the_trigger(name):
    on = _load(name)[1]
    offenders = []
    for event in ("pull_request", "push"):
        cfg = on.get(event)
        if isinstance(cfg, dict) and ("paths" in cfg or "paths-ignore" in cfg):
            offenders.append(event)
    assert not offenders, (
        f"{name} 的 {offenders} 又用了 `paths:` —— 超過 300 檔的 PR 會靜靜跳過整支。\n"
        f"改用 `dorny/paths-filter` 判斷（見 staging-deploy.yml）。")


@pytest.mark.parametrize("name", GUARDED)
def test_it_still_skips_unrelated_prs(name):
    """拿掉 `paths:` 不等於「每個 PR 都跑」—— 要有 detect-changes 擋著。

    少了這一半，修法就變成「為了保險每次都跑」，那是另一種浪費。
    """
    jobs = _load(name)[0].get("jobs") or {}
    assert "detect-changes" in jobs, f"{name} 沒有 detect-changes job"
    uses = yaml.dump(jobs["detect-changes"])
    assert "dorny/paths-filter" in uses, f"{name} 的 detect-changes 沒用 paths-filter"
    gated = [j for j, cfg in jobs.items()
             if j != "detect-changes" and "detect-changes" in str(cfg.get("needs", ""))]
    assert gated, f"{name} 有 detect-changes 但沒有任何 job 依賴它 —— 等於沒接上"
