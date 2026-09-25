"""Preview 的 URL 守衛必須擋空字串，不是只擋 'N/A'。

為什麼
------
`preview-deploy.yml` 用 `$(gcloud ... || echo "N/A")` 取 preview URL，然後下游
用 `!= 'N/A'` 當守衛。那個 fallback 只在 gcloud **非零退出**時觸發；服務存在但
`status.url` 還沒填時 gcloud 是 exit 0 + 印空字串，於是：

    '' != 'N/A'  →  true  →  E2E 照跑，拿到空的 E2E_BACKEND_URL

而 e2e 的 `process.env.X || <staging>` 會把空字串當假值，**靜默回退去打 staging**。
結果是「preview 綠了，但驗的是另一個環境」—— 一個假 PASS。

2026-09-25 PR #3316 真的撞到：backend preview 部署成功（log 裡看得到 env 注入），
`E2E_BACKEND_URL` 卻是空的。是 #3242 那道 preflight 攔下來才沒變成假綠。

這條鎖守兩件事：取值端會把空正規化成 N/A，而且每一道守衛自己也擋空。
兩層都要 —— 只有其中一層時，改動另一層的人不會被任何東西提醒。
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = REPO / ".github" / "workflows" / "preview-deploy.yml"
OUTPUTS = ("frontend_url", "backend_url")


def _text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def test_empty_urls_are_normalised_before_being_written_to_output() -> None:
    """取值端：空字串要在寫進 GITHUB_OUTPUT 之前就變成 N/A。"""
    t = _text()
    for var in ("FRONTEND_URL", "BACKEND_URL"):
        assert re.search(rf'\[ -z "\${var}" \].*{var}="N/A"', t), (
            f'{var} 沒有「空就設成 N/A」的正規化 —— gcloud exit 0 印空字串時，'
            f"守衛會全部失效（見 #3242 / PR #3316）"
        )


def test_every_guard_rejects_empty_not_just_the_literal_NA() -> None:
    """每一道用到 preview URL 的守衛，都要同時擋 'N/A' 與空字串。"""
    t = _text()
    guards = [ln for ln in t.splitlines() if "preview-urls.outputs." in ln and "!=" in ln]

    # 正向對照：抓不到守衛就是這條鎖壞了，不是沒有違規
    assert guards, "在 workflow 裡找不到任何 preview-urls 守衛 —— 這條鎖的比對壞了？"

    for out in OUTPUTS:
        mentioning = [ln for ln in guards if f"outputs.{out}" in ln]
        assert mentioning, f"沒有任何守衛檢查 {out}"
        for ln in mentioning:
            assert f"outputs.{out} != 'N/A'" in ln, f"{out} 的守衛少了 != 'N/A'：{ln.strip()}"
            assert f"outputs.{out} != ''" in ln, (
                f"{out} 的守衛只擋 'N/A' 沒擋空字串 —— 空字串會讓 e2e 靜默回退打 "
                f"staging：{ln.strip()}"
            )


def test_the_urls_are_echoed_so_a_failed_run_says_what_it_saw() -> None:
    """取值後要印出來。沒印的話，下次再壞只能從 e2e 的錯誤往回猜。"""
    assert "preview URLs → frontend=" in _text(), "取到的 preview URL 沒有印進 log"
