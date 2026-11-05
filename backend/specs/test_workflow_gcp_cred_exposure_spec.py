"""第三方安裝／測試程式碼，不可以在手上已經握有 GCP 憑證的 job 裡執行。

為什麼
------
`google-github-actions/auth@v2` 一跑完，那個 job 剩下的每一步都在同一個
runner 上，憑證檔案就在環境裡，直到 job 結束都不會自動撤銷。如果同一個
job 後面還有 `npm ci` / `npm install` / `pip install` / `playwright install`
這類「照 lockfile 去抓任意第三方套件」的步驟，等於讓攻擊者能控制的
（或被供應鏈污染的）程式碼，在握有雲端憑證的環境裡執行。

Claude Security finding `find_01WStrhArZsNRHeb92RWHZRE`（high）點名的正是
這個形狀：`preview-deploy.yml` 的 `deploy-preview` job 早早就
`Authenticate to Google Cloud`，而工作列表最後一步是
`npm ci && npx playwright install --with-deps && npx playwright test`
——整段 E2E 安裝都在已認證的 runner 上跑。

2026-11-05 修法：把那段 E2E 測試抽成獨立的 `e2e-preview-check` job，
靠 `needs: deploy-preview` 拿已部署好的 preview URL（純 HTTP 位址，
不需要雲端憑證），那個 job 整個不叫 `google-github-actions/auth`。

這條鎖守的是**結構**，不是這一次的修法本身——改回同一個 job、或新增
一個 job 又把兩者擠在一起，這裡會紅，不靠人記得當初為什麼要拆開。

正向對照：`deploy.yml` / `staging-deploy.yml` 本來就有「`npm ci` 在
`auth` 之前」的 Firebase 部署 job（同一個 job 裡，順序是安全的）——
這條鎖必須放行這種案例，不能見到 auth 就報，否則是空鎖。
"""
from __future__ import annotations

import pathlib
import re

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
WF_DIR = REPO / ".github" / "workflows"

#: 會抓任意第三方套件的安裝/測試指令形狀。不含 `docker build`——那在
#: Docker 自己的建置容器裡跑，不共用 runner 的憑證檔案。
_UNTRUSTED_INSTALL_PATTERNS = (
    re.compile(r"\bnpm (ci|install)\b"),
    re.compile(r"\bpip install\b"),
    re.compile(r"\bplaywright install\b"),
    re.compile(r"\bpytest\b"),
)

_AUTH_USES = re.compile(r"google-github-actions/auth@")

_CHECKED_FILES = ("preview-deploy.yml", "deploy.yml", "staging-deploy.yml")


def _jobs(filename: str) -> dict:
    doc = yaml.safe_load((WF_DIR / filename).read_text(encoding="utf-8"))
    return doc.get("jobs") or {}


def _step_is_untrusted_install(step: dict) -> bool:
    run = step.get("run")
    if not isinstance(run, str):
        return False
    return any(p.search(run) for p in _UNTRUSTED_INSTALL_PATTERNS)


def _step_is_gcp_auth(step: dict) -> bool:
    uses = step.get("uses")
    return isinstance(uses, str) and bool(_AUTH_USES.search(uses))


def _violations_in_job(job: dict) -> list[str]:
    """Steps whose index is AFTER the job's first auth step and look like
    an untrusted install/test. Steps BEFORE auth are fine -- no credential
    exists yet when they run."""
    steps = job.get("steps") or []
    auth_index = next(
        (i for i, s in enumerate(steps) if isinstance(s, dict) and _step_is_gcp_auth(s)),
        None,
    )
    if auth_index is None:
        return []
    violations = []
    for i, s in enumerate(steps):
        if i <= auth_index or not isinstance(s, dict):
            continue
        if _step_is_untrusted_install(s):
            violations.append(s.get("name") or s.get("run", "")[:60])
    return violations


def test_no_untrusted_install_runs_after_gcp_auth_in_the_same_job() -> None:
    offenders: dict[str, list[str]] = {}
    for filename in _CHECKED_FILES:
        for job_name, job in _jobs(filename).items():
            if not isinstance(job, dict):
                continue
            bad = _violations_in_job(job)
            if bad:
                offenders[f"{filename}::{job_name}"] = bad

    assert not offenders, (
        "這些 job 裡，npm ci / pip install / playwright install / pytest "
        "出現在 google-github-actions/auth 之後 —— 等於讓第三方安裝的程式碼"
        f"在握有 GCP 憑證的 runner 上執行（find_01WStrhArZsNRHeb92RWHZRE）：{offenders}"
    )


def test_the_check_actually_flags_the_original_shape() -> None:
    """正向對照：把 e2e-preview-check 的內容手動塞回 deploy-preview 的尾端，
    確認這條鎖真的會紅，不是因為掃法壞掉才看起來乾淨。"""
    job = {
        "steps": [
            {"name": "Checkout", "uses": "actions/checkout@v6"},
            {"name": "Authenticate to Google Cloud", "uses": "google-github-actions/auth@v2"},
            {"name": "Deploy", "run": "gcloud run deploy ..."},
            {
                "name": "E2E",
                "run": "npm ci\nnpx playwright install chromium --with-deps\nnpx playwright test",
            },
        ]
    }
    assert _violations_in_job(job), "掃法壞了 —— 對著已知會違規的形狀卻沒抓到"


def test_install_before_auth_in_the_same_job_is_allowed() -> None:
    """負向對照：deploy.yml / staging-deploy.yml 的 Firebase job 本來就是
    `npm ci` 在 `auth` 之前，同一個 job——這是安全的順序，不該被擋。"""
    job = {
        "steps": [
            {"name": "Checkout", "uses": "actions/checkout@v6"},
            {"name": "Install frontend deps", "run": "npm ci"},
            {"name": "Build frontend", "run": "npm run build"},
            {"name": "Authenticate to Google Cloud", "uses": "google-github-actions/auth@v2"},
            {"name": "Deploy to Firebase", "run": "firebase deploy"},
        ]
    }
    assert not _violations_in_job(job), (
        "安裝在 auth 之前、同一個 job —— 這個順序沒有暴露憑證，不該被這條鎖擋下"
    )


def test_every_checked_file_exists_and_parses() -> None:
    """正向對照：掃法真的在讀這三支檔案，不是悄悄掃到 0 個 job。"""
    total_jobs = sum(len(_jobs(f)) for f in _CHECKED_FILES)
    assert total_jobs >= 5, f"只掃到 {total_jobs} 個 job —— 路徑或 YAML 解析壞了？"
