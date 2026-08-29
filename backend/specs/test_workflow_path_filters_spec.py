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
#: ⛔ 這份清單**不是手維護的**（見下方 GUARDED）——手維護的清單只會保護到
#: 「上次出事的那幾支」。2026-08-28 就是這樣：三支修好了，而 pytest / spec-check /
#: keypoints-manifest-gate 三道真正的門還留著同一個洞，清單裡沒有它們所以沒人發現。
_FIXED_BY_2916 = ["frontend-checks.yml", "e2e-tests.yml", "schema-check.yml"]

#: 允許保留頂層 paths 的例外，每一支都要寫明為什麼跳過它是安全的。
#: 新增例外＝在說「這支門被靜靜跳過我可以接受」，要有理由。
PATHS_ALLOWED = {
    # 只是把 docs/index.html 同步成 gh-pages 上的 Brand Book。
    # 被跳過的後果是「線上的 Brand Book 沒更新」，不是「門沒把關」，
    # 而且 CLAUDE.md 本來就寫著它要手動同步 + 手動觸發 build。
    "sync-brand-book.yml": "發佈用，不是把關用；漏跑只會讓線上版落後",
}


def _gate_workflows():
    """所有由 push / pull_request 觸發的 workflow —— 全庫掃，不是手打清單。"""
    out = []
    for f in sorted(WF.glob("*.yml")):
        if f.name in PATHS_ALLOWED:
            continue
        try:
            d = yaml.safe_load(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        on = d.get("on") or d.get(True) or {}
        if isinstance(on, dict) and any(k in on for k in ("pull_request", "push")):
            out.append(f.name)
    return out


GUARDED = _gate_workflows()


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


def _has_detect_changes(name):
    return "detect-changes" in ((_load(name)[0].get("jobs") or {}))


#: 有些 workflow **本來就該每個 PR 都跑**（安全掃描、secret 掃描）——
#: 對它們要求 detect-changes 是錯的判準。所以這條只驗「有裝的要接對」，
#: 不驗「每一支都要裝」。
@pytest.mark.parametrize("name", [n for n in GUARDED if _has_detect_changes(n)])
def test_the_detect_changes_job_is_actually_wired(name):
    """有 detect-changes 就要真的接上，否則它只是個裝飾的 job。

    拿掉 `paths:` 之後如果沒有東西擋，修法就變成「為了保險每次都跑」，
    那是另一種浪費；而裝了卻沒有人 needs 它，等於兩邊都沒有。
    """
    jobs = _load(name)[0].get("jobs") or {}
    uses = yaml.dump(jobs["detect-changes"])
    assert "dorny/paths-filter" in uses, f"{name} 的 detect-changes 沒用 paths-filter"
    gated = [j for j, cfg in jobs.items()
             if j != "detect-changes" and "detect-changes" in str(cfg.get("needs", ""))]
    assert gated, f"{name} 有 detect-changes 但沒有任何 job 依賴它 —— 等於沒接上"


def test_the_scan_covers_the_real_gates():
    """正向對照 + 防萎縮 —— 全庫掃出來的清單必須包含那幾道真的門。

    沒有這條，把一支門丟進 PATHS_ALLOWED 就能讓它從此不被檢查，
    而測試照樣全綠 —— 那正是這支 spec 要防的病本身。
    """
    assert len(GUARDED) >= 8, f"只掃到 {len(GUARDED)} 支，掃描壞了"
    must = {"pytest.yml", "spec-check.yml", "keypoints-manifest-gate.yml",
            *_FIXED_BY_2916}
    missing = must - set(GUARDED)
    assert not missing, (
        f"{sorted(missing)} 不在被守的清單裡。\n"
        f"它們是真的門，不可以放進 PATHS_ALLOWED —— 被 300 上限靜靜跳過時，"
        f"檢查清單上不會出現那一列，看起來就是全綠。")


def test_the_workflow_that_runs_me_watches_the_files_i_guard():
    """守 workflow 的鎖，必須在「改 workflow 的 PR」上被觸發。

    否則有人把 `paths:` 改回頂層時，這支 spec 根本不會跑 ——
    鎖還在、卻永遠不會紅。那正是這支 spec 要防的病，只是換一層。
    """
    d = _load("spec-check.yml")[0]
    steps = d["jobs"]["detect-changes"]["steps"]
    flt = next(s for s in steps if "paths-filter" in str(s.get("uses", "")))["with"]["filters"]
    watched = [l.strip()[2:].strip("'\"") for l in flt.split("\n") if l.strip().startswith("- ")]
    assert any(".github/workflows" in w for w in watched), (
        "spec-check.yml 沒有盯 .github/workflows/** —— "
        "改 workflow 的 PR 不會跑到這支 spec，這裡的每一條鎖都是擺設。\n"
        f"目前盯的: {watched}")
    # 正向對照：確認真的解析到東西，不是空清單讓上面空過
    assert len(watched) >= 5, f"只解析到 {len(watched)} 條路徑，解析壞了"

