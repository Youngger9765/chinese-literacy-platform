"""`pull_request_target` 絕不能跟「checkout PR 的 head sha」同一支檔案。

為什麼
------
CodeQL 把這個組合標成 critical：一支 workflow 的 `on:` 裡只要有
`pull_request_target`（連 fork PR 都給 secrets、跑在 base repo context），
同一個檔案裡**任何**一個 job 去 checkout
`github.event.pull_request.head.sha`（攻擊者能控制的 ref），就是
pwn-request 的典型形狀——不管是哪個 job 做 checkout、不管那個 job 自己的
`if:` 寫得多嚴謹，CodeQL 的靜態分析不做這麼深的條件推理。

2026-11-05 實例：`preview-deploy.yml` 本來同時有 `pull_request_target:
types: [closed]`（給 `cleanup-preview` 用）跟兩個會 checkout PR head sha
的 job（`deploy-preview`、新加的 `e2e-preview-check`）。`cleanup-preview`
其實完全不需要 checkout 任何東西（只讀 `github.event.pull_request.
{head.ref,number}`，照 env 傳遞，從不直接內插進 shell）——把它搬到
`preview-cleanup-on-close.yml`，那支檔案只留 `pull_request_target`、
零 checkout，`preview-deploy.yml` 只留 `pull_request`（fork 拿不到
secrets），兩邊都不再構成 CodeQL 那個 query 認得的 pattern。

這條鎖守的是**結構**，不是這次的修法——以後誰要把 cleanup 搬回同一個檔案、
或在這兩支檔案的任何一支裡又混了另一種觸發方式，這裡要紅。
"""
from __future__ import annotations

import pathlib

import yaml

WF_DIR = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows"


def _load(filename: str) -> dict:
    return yaml.safe_load((WF_DIR / filename).read_text(encoding="utf-8"))


def _triggers(doc: dict) -> set[str]:
    on = doc.get(True) or doc.get("on") or {}  # YAML 1.1: 裸 `on:` 有時被解成 bool key True
    if isinstance(on, str):
        return {on}
    if isinstance(on, list):
        return set(on)
    return set(on.keys())


def _checks_out_pr_head_sha(job: dict) -> bool:
    for step in job.get("steps") or []:
        if not isinstance(step, dict):
            continue
        if step.get("uses", "").startswith("actions/checkout"):
            ref = (step.get("with") or {}).get("ref", "")
            if isinstance(ref, str) and "pull_request.head.sha" in ref:
                return True
    return False


def test_preview_deploy_has_no_pull_request_target_trigger() -> None:
    doc = _load("preview-deploy.yml")
    triggers = _triggers(doc)
    assert "pull_request_target" not in triggers, (
        "preview-deploy.yml 裡的 deploy-preview/e2e-preview-check 都會 "
        "checkout PR head sha -- 這支檔案絕不能同時有 pull_request_target "
        f"觸發，否則就是 CodeQL 標的 pwn-request pattern。現有觸發：{triggers}"
    )


def test_cleanup_on_close_has_no_checkout_of_pr_head_sha() -> None:
    doc = _load("preview-cleanup-on-close.yml")
    assert "pull_request_target" in _triggers(doc), (
        "這支檔案存在的唯一理由就是扛 pull_request_target:closed -- "
        "沒有這個觸發，正向對照就是空的"
    )
    for job_name, job in (doc.get("jobs") or {}).items():
        assert not _checks_out_pr_head_sha(job), (
            f"{job_name} 在一支有 pull_request_target 觸發的檔案裡 checkout "
            "了 PR 的 head sha -- 這正是這條鎖存在的理由，絕不能發生"
        )


def test_the_check_actually_flags_the_original_shape() -> None:
    """正向對照：把舊的（有問題的）組合塞進記憶體裡的假 doc，確認掃法真的
    會抓到——不是因為掃法本身壞了才看起來乾淨。"""
    bad_doc = {
        "on": {"pull_request": {}, "pull_request_target": {"types": ["closed"]}},
        "jobs": {
            "deploy-preview": {
                "steps": [
                    {
                        "uses": "actions/checkout@v6",
                        "with": {"ref": "${{ github.event.pull_request.head.sha }}"},
                    }
                ]
            },
        },
    }
    triggers = _triggers(bad_doc)
    assert "pull_request_target" in triggers
    assert _checks_out_pr_head_sha(bad_doc["jobs"]["deploy-preview"])
    # i.e. the bad shape IS what test_preview_deploy_has_no_pull_request_target_trigger
    # would fail on if preview-deploy.yml still looked like this.
