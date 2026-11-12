"""Junyi 資安基線規則 20 — 所有第三方 GitHub Action 必須釘在 40 碼 commit SHA。

為什麼：`uses: actions/checkout@v4` 這種浮動 tag 參照，maintainer 隨時可以把
`v4` 指到任何新 commit（甚至被供應鏈攻擊接管帳號後指到惡意 commit），而我們
的 workflow 會在下一次 run 不知不覺跑到那段新程式碼 —— 還握著 GCP 服務帳號
憑證 / repo 寫入權杖。釘死 40 碼 SHA 讓「這次 CI 到底跑了誰的程式碼」變成
commit 歷史裡白紙黑字的事，不是浮動指標。

這支鎖掃描 `.github/workflows/*.yml` 的每一個 `jobs.<job>.steps[].uses` 與
`jobs.<job>.uses`（reusable workflow call），只放行兩種形式：
  1. 本地 action（`./...`）—— 住在同一顆 repo，checkout 時就鎖死在同一個
     commit，不需要另外釘 SHA。
  2. `owner/repo@<40 碼 hex>`（可選接 `# vX.Y.Z` 版本註解）。

`uses: owner/repo@v4`、`uses: owner/repo@main`、`uses: owner/repo@latest`
一律判為未釘選，測試失敗並列出違規的 `檔案:行號`。
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS_DIR = ROOT / ".github" / "workflows"

# 40 個 hex 字元的 full commit SHA。
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def _workflow_files() -> list[Path]:
    files = sorted(WORKFLOWS_DIR.glob("*.yml")) + sorted(WORKFLOWS_DIR.glob("*.yaml"))
    assert files, f"沒在 {WORKFLOWS_DIR} 找到任何 workflow — 檢查路徑有沒有跑錯"
    return files


def _iter_uses_refs(path: Path):
    """yield (ref_string, context_label) for every `uses:` in one workflow file."""
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    jobs = (doc or {}).get("jobs") or {}
    for job_name, job in jobs.items():
        if not isinstance(job, dict):
            continue
        # Reusable workflow call: `jobs.<job>.uses: owner/repo/.github/workflows/x.yml@ref`
        job_uses = job.get("uses")
        if isinstance(job_uses, str):
            yield job_uses, f"jobs.{job_name}.uses"
        steps = job.get("steps") or []
        for i, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            step_uses = step.get("uses")
            if isinstance(step_uses, str):
                name = step.get("name", f"step[{i}]")
                yield step_uses, f"jobs.{job_name}.steps[{i}] ({name})"


def _is_pinned_or_local(ref: str) -> bool:
    if ref.startswith("./") or ref.startswith("docker://"):
        return True
    if "@" not in ref:
        return False
    _, _, version = ref.rpartition("@")
    return bool(_SHA_RE.match(version))


def test_at_least_one_workflow_file_is_scanned():
    """正向對照 — 少了這條，下面兩個斷言可能是在空集合上通過。"""
    files = _workflow_files()
    assert len(files) >= 10, f"只找到 {len(files)} 個 workflow 檔 — 掃描範圍可能錯了"


def test_the_scanner_actually_catches_an_unpinned_ref():
    """Mutation guard — 證明 `_is_pinned_or_local` 真的會把浮動 tag 判為未釘選，
    不是一個永遠回 True 的裝飾品。"""
    assert _is_pinned_or_local("./local-action") is True
    assert _is_pinned_or_local("owner/repo@" + "a" * 40) is True
    assert _is_pinned_or_local("owner/repo@" + "a" * 39) is False  # 少一碼
    assert _is_pinned_or_local("owner/repo@v4") is False
    assert _is_pinned_or_local("owner/repo@main") is False
    assert _is_pinned_or_local("owner/repo@latest") is False


def test_every_third_party_action_is_pinned_to_a_full_commit_sha():
    violations: list[str] = []
    for path in _workflow_files():
        for ref, context in _iter_uses_refs(path):
            if not _is_pinned_or_local(ref):
                violations.append(f"{path.relative_to(ROOT)}: {context} -> {ref!r}")

    assert not violations, (
        "以下第三方 GitHub Action 沒有釘在 40 碼 commit SHA（Junyi 資安基線 rule 20）:\n  "
        + "\n  ".join(violations)
        + "\n\n修法：`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`"
        "（annotated tag 要再 dereference 一次拿 commit sha）解出 40 碼 SHA，"
        "改成 `uses: owner/repo@<sha> # <原本的 tag/version>`。"
    )
