"""第三方安裝／測試程式碼，不可以在「能拿到 GCP 憑證」的 job 裡執行。

為什麼（2026-11-07 改寫 — 原本的鎖只看步驟順序，漏了 id-token）
----------------------------------------------------------
Claude Security finding `find_01YP72Td7XmwD2J4TU5nTMgd`（critical）/
`find_015p35fzCRJqG7UACGpxSxQp`（high）指出：原本這條鎖只檢查「這個 job
裡有沒有 `google-github-actions/auth` 這個 step、而且安裝步驟排在它後面」。
但 `id-token: write` 是**整個 job 執行期間都存在的環境變數**
（`ACTIONS_ID_TOKEN_REQUEST_URL` / `ACTIONS_ID_TOKEN_REQUEST_TOKEN`），
從 job 第一秒就在，不是等某個 step 跑了 `auth@v2` 之後才出現。只要 job 的
**有效權限**（job 自己宣告的 `permissions:`，沒宣告就繼承 workflow 層級的）
含 `id-token: write`，job 裡任何程式碼——包括 `npm ci` 的 install script、
`vite build` 的 plugin——都能自己跟 GitHub 要一份 OIDC token，直接拿去跟
Google STS 換這個 WIF 服務帳號的存取權杖，完全不需要真的跑過
`auth@v2`。所以：

  1. 把安裝步驟搬到 `auth@v2` 之前（舊修法）——不解決問題，因為
     `id-token: write` 從 job 開始就在，不是 `auth@v2` 跑完才出現
  2. job 裡完全沒有 `auth@v2` 這個 step，但 job 的有效權限仍然是
     `id-token: write`（`preview-deploy.yml` 的 `e2e-preview-check` 和
     `detect-changes` 曾經就是這樣，兩個都沒叫 auth，但 workflow 層級的
     `permissions:` 有 `id-token: write`，兩個 job 都自動繼承）——一樣中

這次改寫把判斷依據換成「**這個 job 的有效權限，含不含 id-token: write；
或者這個 job 本身有沒有呼叫 auth@v2**」，兩者有一個成立，這個 job 裡就不准
出現任何第三方安裝/測試步驟，不管順序。

有效權限的計算（GitHub Actions 的真實語意）：job 自己宣告了
`permissions:` → 用那份，**完全取代**（不是合併）workflow 層級的那份；
job 沒宣告 → 原封不動繼承 workflow 層級的。

修法（2026-11-07，同一個 PR）：`deploy.yml` / `staging-deploy.yml` 的
`deploy-frontend-firebase` 拆成兩個 job——`build-frontend-firebase`
（只有 `contents: read`，跑 `npm ci` + `vite build`，上傳 `frontend/dist`
當 artifact）和 `deploy-frontend-firebase`（下載 artifact、認證、跑
pin 死版本的 Firebase CLI，裡面沒有任何「照 lockfile 抓任意套件」的步驟）。
`preview-deploy.yml` 的 `detect-changes` / `e2e-preview-check` 都明確宣告
`permissions: {contents: read}`，不再繼承 workflow 層級的 `id-token`。
三個檔案的 workflow 層級 `permissions:` 都拿掉了 `id-token: write`，只留
在真的會呼叫 `auth@v2` 的 job 自己的 `permissions:` 裡。

這條鎖守的是**結構**（有效權限 + 第三方安裝步驟，不管順序），不是這一次
的修法本身——日後誰把兩者重新擠進同一個 job，這裡會紅。
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

#: 真的會呼叫 auth@v2、因此必須自己宣告 id-token: write 的 job（正向對照
#: 用——證明這條鎖真的在讀目前的三個檔案，不是悄悄掃到空內容）。
_EXPECTED_AUTH_JOBS = {
    "deploy.yml": {"deploy-backend", "deploy-frontend", "deploy-frontend-firebase", "cleanup-images"},
    "staging-deploy.yml": {
        "deploy-backend",
        "deploy-frontend",
        "deploy-frontend-firebase",
        "smoke-test",
        "cleanup-images",
    },
    "preview-deploy.yml": {"deploy-preview"},
}


def _doc(filename: str) -> dict:
    return yaml.safe_load((WF_DIR / filename).read_text(encoding="utf-8"))


def _jobs(filename: str) -> dict:
    return _doc(filename).get("jobs") or {}


#: The one deliberate exception: `.github/firebase-cli` is a pinned,
#: reviewed dependency (exact version + full-tree integrity hashes in its
#: committed package-lock.json, installed with --ignore-scripts -- see
#: that directory's package.json for the full rationale). A new upstream
#: firebase-tools release can't change what this installs without a
#: reviewed repository change, which is exactly the property the untrusted
#: frontend `npm ci` (arbitrary, frequently-updated third-party deps,
#: lockfile resolved against whatever the registry serves) does NOT have.
#: Fix criteria for find_01GSz5fbgsPuuK3ieTGopD8B bullet 2 only bars an
#: UNPINNED range install from a credentialed job, not every install.
def _step_is_pinned_firebase_cli_install(step: dict) -> bool:
    run = step.get("run")
    if not isinstance(run, str):
        return False
    return (
        step.get("working-directory") == ".github/firebase-cli"
        and bool(re.search(r"\bnpm ci\b", run))
        and "--ignore-scripts" in run
    )


def _step_is_untrusted_install(step: dict) -> bool:
    if _step_is_pinned_firebase_cli_install(step):
        return False
    run = step.get("run")
    if not isinstance(run, str):
        return False
    return any(p.search(run) for p in _UNTRUSTED_INSTALL_PATTERNS)


def _step_is_gcp_auth(step: dict) -> bool:
    uses = step.get("uses")
    return isinstance(uses, str) and bool(_AUTH_USES.search(uses))


def _job_calls_gcp_auth(job: dict) -> bool:
    steps = job.get("steps") or []
    return any(isinstance(s, dict) and _step_is_gcp_auth(s) for s in steps)


def _effective_permissions(workflow_permissions: dict | None, job: dict) -> dict:
    """GitHub Actions semantics: a job-level `permissions:` block REPLACES
    the workflow-level one for that job -- it is never merged. A job with
    no `permissions:` key of its own inherits the workflow-level block
    unchanged (or the repository default if the workflow has none, which
    none of the three checked files do -- out of scope here)."""
    job_permissions = job.get("permissions")
    if isinstance(job_permissions, dict):
        return job_permissions
    return workflow_permissions or {}


def _job_has_id_token_write(workflow_permissions: dict | None, job: dict) -> bool:
    return _effective_permissions(workflow_permissions, job).get("id-token") == "write"


def _violations_in_job(workflow_permissions: dict | None, job: dict) -> list[str]:
    """Every untrusted-install-shaped step in this job, if the job's
    EFFECTIVE permissions include id-token: write, or it calls
    google-github-actions/auth@v2 at all -- regardless of step order.
    A job with neither is free to run any install it wants; it never had
    (and under this design can never gain) a GCP credential or an OIDC
    minting capability."""
    if not (_job_has_id_token_write(workflow_permissions, job) or _job_calls_gcp_auth(job)):
        return []
    steps = job.get("steps") or []
    return [
        s.get("name") or s.get("run", "")[:60]
        for s in steps
        if isinstance(s, dict) and _step_is_untrusted_install(s)
    ]


def test_no_untrusted_install_shares_a_job_with_gcp_credentials() -> None:
    offenders: dict[str, list[str]] = {}
    for filename in _CHECKED_FILES:
        doc = _doc(filename)
        workflow_permissions = doc.get("permissions")
        for job_name, job in (doc.get("jobs") or {}).items():
            if not isinstance(job, dict):
                continue
            bad = _violations_in_job(workflow_permissions, job)
            if bad:
                offenders[f"{filename}::{job_name}"] = bad

    assert not offenders, (
        "這些 job 的有效權限含 id-token: write（或呼叫了 auth@v2），裡面卻還有"
        "npm ci / pip install / playwright install / pytest —— 第三方安裝的程式碼"
        "可以自己跟 GitHub 要 OIDC token 換 GCP 存取權杖，不需要真的跑過 auth"
        f"（find_01YP72Td7XmwD2J4TU5nTMgd / find_015p35fzCRJqG7UACGpxSxQp）：{offenders}"
    )


def test_the_check_flags_an_untrusted_install_that_shares_a_job_with_auth() -> None:
    """正向對照：job 裡同時有 auth@v2 跟 npm ci（不管順序），這條鎖要紅。"""
    job_install_after_auth = {
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
    assert _violations_in_job({}, job_install_after_auth), (
        "掃法壞了 —— install 在 auth 之後、同一個 job，卻沒抓到"
    )

    job_install_before_auth = {
        "steps": [
            {"name": "Checkout", "uses": "actions/checkout@v6"},
            {"name": "Install frontend deps", "run": "npm ci"},
            {"name": "Build frontend", "run": "npm run build"},
            {"name": "Authenticate to Google Cloud", "uses": "google-github-actions/auth@v2"},
            {"name": "Deploy to Firebase", "run": "firebase deploy"},
        ]
    }
    assert _violations_in_job({}, job_install_before_auth), (
        "掃法壞了 —— 這是 2026-11-05 以前 deploy-frontend-firebase 的真實形狀"
        "（install 在 auth 之前，同一個 job）：順序不該影響結果，這裡本來就該紅，"
        "這次改寫就是為了讓它紅"
    )


def test_the_pinned_firebase_cli_exemption_is_narrow() -> None:
    """_step_is_pinned_firebase_cli_install 的兩個條件都要成立才算豁免——
    少一個就該回到「這是個未釘死的第三方安裝」的預設判定。"""
    missing_ignore_scripts = {
        "working-directory": ".github/firebase-cli",
        "run": "npm ci",
    }
    assert _step_is_untrusted_install(missing_ignore_scripts), (
        "少了 --ignore-scripts 還被豁免 —— 豁免條件漏了一半"
    )

    wrong_directory = {
        "working-directory": "frontend",
        "run": "npm ci --ignore-scripts",
    }
    assert _step_is_untrusted_install(wrong_directory), (
        "working-directory 不是 .github/firebase-cli 卻被豁免 —— "
        "任何人都能在 frontend/ 加 --ignore-scripts 繞過這條鎖"
    )

    the_real_exemption = {
        "working-directory": ".github/firebase-cli",
        "run": "npm ci --ignore-scripts",
    }
    assert not _step_is_untrusted_install(the_real_exemption), (
        "真正符合豁免條件的那個 step（跟 deploy.yml / staging-deploy.yml 裡 "
        "'Install pinned Firebase CLI' 一模一樣的形狀）卻被擋 —— 豁免沒生效"
    )


def test_the_check_flags_a_job_with_inherited_id_token_and_no_auth_step() -> None:
    """正向對照：job 完全沒叫 auth@v2，但 workflow 層級給了 id-token: write
    而這個 job 自己沒有覆寫 —— 這就是 find_015p35fzCRJqG7UACGpxSxQp 的原形
    （e2e-preview-check 曾經就是這樣）。舊版的鎖（只看 auth 的位置）對這個
    形狀完全視而不見，因為它根本沒有 auth step 可以當基準點。"""
    workflow_permissions = {"contents": "read", "id-token": "write"}
    job_no_auth_no_own_permissions = {
        "steps": [
            {"name": "Checkout", "uses": "actions/checkout@v6"},
            {"name": "E2E", "run": "npm ci\nnpx playwright install chromium --with-deps\nnpx playwright test"},
        ]
    }
    assert _violations_in_job(workflow_permissions, job_no_auth_no_own_permissions), (
        "掃法壞了 —— job 沒有自己的 permissions、也沒呼叫 auth，但繼承了 "
        "workflow 層級的 id-token: write，裡面卻還有 npm ci，這必須被抓到"
    )


def test_a_job_with_its_own_permissions_block_does_not_inherit_id_token() -> None:
    """負向對照：workflow 層級給了 id-token: write，但這個 job 自己宣告了
    不含 id-token 的 permissions —— GitHub Actions 的語意是「取代」不是
    「合併」，所以這個 job 真的沒有 id-token，不該被擋。這是
    build-frontend-firebase / e2e-preview-check 修好之後的真實形狀。"""
    workflow_permissions = {"contents": "read", "id-token": "write"}
    job_with_scoped_down_permissions = {
        "permissions": {"contents": "read"},
        "steps": [
            {"name": "Checkout", "uses": "actions/checkout@v6"},
            {"name": "Install frontend deps", "run": "npm ci"},
            {"name": "Build", "run": "npm run build"},
        ],
    }
    assert not _violations_in_job(workflow_permissions, job_with_scoped_down_permissions), (
        "job 自己宣告的 permissions（不含 id-token）應該完全取代 workflow 層級的，"
        "而不是跟它合併——這裡誤判代表 _effective_permissions 把兩者合併了"
    )


def test_every_checked_file_exists_and_parses() -> None:
    """正向對照：掃法真的在讀這三支檔案，不是悄悄掃到 0 個 job。"""
    total_jobs = sum(len(_jobs(f)) for f in _CHECKED_FILES)
    assert total_jobs >= 5, f"只掃到 {total_jobs} 個 job —— 路徑或 YAML 解析壞了？"


def test_every_job_that_calls_auth_declares_its_own_id_token() -> None:
    """正向對照：每一個真的會呼叫 auth@v2 的 job，都要自己宣告
    `permissions: {id-token: write}`——不能只靠繼承 workflow 層級的（那條
    路已經被拿掉了，workflow 層級不再有 id-token）。也確認
    _EXPECTED_AUTH_JOBS 這張清單本身沒有過時：真的有呼叫 auth 的 job，
    一個都不能漏列。"""
    for filename, expected_names in _EXPECTED_AUTH_JOBS.items():
        jobs = _jobs(filename)
        actual_auth_job_names = {
            name for name, job in jobs.items() if isinstance(job, dict) and _job_calls_gcp_auth(job)
        }
        assert actual_auth_job_names == expected_names, (
            f"{filename}: 實際呼叫 auth@v2 的 job 清單變了——"
            f"預期 {expected_names}，實際 {actual_auth_job_names}。"
            "更新 _EXPECTED_AUTH_JOBS 或檢查是不是漏加/多加了 auth 呼叫"
        )
        for name in expected_names:
            job_permissions = jobs[name].get("permissions")
            assert isinstance(job_permissions, dict) and job_permissions.get("id-token") == "write", (
                f"{filename}::{name} 呼叫了 auth@v2，卻沒有自己宣告 "
                "permissions: {id-token: write} —— workflow 層級已經不給了，"
                "少了這個宣告這個 job 會在認證那一步直接失敗"
            )


def test_workflow_level_permissions_no_longer_grant_id_token() -> None:
    """正向對照：三個檔案的 workflow 層級都不再有 id-token: write —— 這是
    這次修法的核心，少了它，上面所有「job 沒宣告就該是 none」的推論都不成立。"""
    for filename in _CHECKED_FILES:
        workflow_permissions = _doc(filename).get("permissions") or {}
        assert workflow_permissions.get("id-token") != "write", (
            f"{filename} 的 workflow 層級 permissions 還有 id-token: write —— "
            "這樣每一個沒有自己宣告 permissions 的 job 都會繼承它"
        )
