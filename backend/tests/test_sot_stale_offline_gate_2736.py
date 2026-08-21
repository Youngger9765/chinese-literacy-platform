"""原稿悄悄過期，要有東西會叫。

事故（2026-08-17，已發生過一次）
--------------------------------
案主 20:28 更新了 6/7/8 年級 12 個檔，本機快照停在那之前，其中 G8-L4 **已經抽完**。
抽出來的 yml 忠實反映一份**作廢的教材**，而**九道門全是綠的** —— 因為每一道門
比對的都是本機那份過期原稿。這種過期沒有任何徵兆。

`scripts/sot_drift_check.py` 早就會用 MD5 抓這件事，但它**只有人想到才會被跑**。

為什麼是 `--offline` 而不是整支接進 CI
--------------------------------------
完整那支要 `rclone` 打 Google Drive：要網路、要 Drive 憑證、要 `private/.env` 的
folder id，逾時上限 600 秒。那種東西不能當 push 前的門。

但它問的其實是**兩個**問題，只有第一個需要 Drive：

    SOT_DRIFT  本機快照 vs Drive          → 需要網路，留給排程／手動
    SOT_STALE  已抽的課 vs 本機原稿指紋    → **純本機**，這才是接得進 CI 的那半

第二個問的是「這份已經 commit 的抽取結果，還對得上它宣稱的來源嗎」——
那正是 8/17 那種靜默作廢的形狀，而且答案完全在 repo 與本機快照裡。
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent.parent
GATE = ROOT / "scripts/sot_drift_check.py"
RUN_CI = ROOT / "specs/run-ci.sh"


def _cli(*args: str, no_path: bool = False) -> subprocess.CompletedProcess:
    """跑真 CLI 拿真 exit code。

    `no_path=True` 把 PATH 清空 —— `rclone` 因此絕對找不到。offline 模式若偷偷
    去打 Drive，這裡就會炸；跑得過才證明它真的不碰網路。
    """
    env = {"PATH": ""} if no_path else None
    return subprocess.run([sys.executable, str(GATE), *args],
                          capture_output=True, text=True, env=env)


def _fixture(tmp: Path, *, body: bytes = b"lesson source bytes",
             stamp: str | None = "auto", uid: str = "L9101") -> tuple[Path, Path]:
    """造一組最小的「原稿 + 已抽取的課」，指紋預設是對得上的。"""
    sot, lessons = tmp / "sot", tmp / "lessons"
    rel = "4年級/L9101.docx"
    (sot / "4年級").mkdir(parents=True)
    (sot / rel).write_bytes(body)

    (lessons / "_extracted").mkdir(parents=True)
    (lessons / "_extracted" / f"{uid}.yml").write_text("{}", encoding="utf-8")

    if stamp == "auto":
        stamp = f"md5-12:{hashlib.md5(body).hexdigest()[:12]}"
    source: dict = {"drive_path": rel}
    if stamp is not None:
        source["docx_md5"] = stamp

    (lessons / uid / "v3").mkdir(parents=True)
    (lessons / uid / "v3/lesson.yml").write_text(
        yaml.safe_dump({"source": source}, allow_unicode=True), encoding="utf-8")
    return sot, lessons


def _offline(sot: Path, lessons: Path, **kw) -> subprocess.CompletedProcess:
    return _cli("--offline", "--sot-root", str(sot), "--lessons-root", str(lessons), **kw)


# ── 正向對照：指紋對得上就是綠的，而且真的沒碰網路 ──────────────────────────

def test_offline_mode_is_green_and_touches_no_network(tmp_path):
    sot, lessons = _fixture(tmp_path)
    r = _offline(sot, lessons, no_path=True)
    assert r.returncode == 0, f"指紋對得上卻紅了：\n{r.stdout}{r.stderr}"
    assert "SOT_STALE=0" in r.stdout
    # PATH 是空的還跑得完 ⇒ 沒有去叫 rclone
    assert "rclone" not in r.stderr.lower()


# ── 負向對照：原稿真的變了要抓到 ────────────────────────────────────────────

def test_a_changed_source_makes_the_extraction_stale(tmp_path):
    """這就是 8/17 的形狀：yml 沒動、原稿換了，其他門一概看不到。"""
    sot, lessons = _fixture(tmp_path)
    src = sot / "4年級/L9101.docx"
    src.write_bytes(src.read_bytes() + b" (case owner edited this)")

    r = _offline(sot, lessons, no_path=True)
    assert r.returncode == 1, f"原稿被改了卻放行：\n{r.stdout}"
    assert "SOT_STALE=1" in r.stdout
    assert "L9101" in r.stdout, "只說有一課作廢沒說是哪一課 = 沒人知道要重抽什麼"


def test_a_lesson_without_a_fingerprint_is_stale(tmp_path):
    """沒指紋 = 抽的時候沒過逐字門，或原稿早就變了 —— 兩種都不能當成對得上。

    這一條**不需要本機快照也成立**，是這道門在 CI runner 上唯一還站得住的部分。
    """
    sot, lessons = _fixture(tmp_path, stamp=None)
    r = _offline(sot, lessons, no_path=True)
    assert r.returncode == 1, f"沒有指紋卻放行：\n{r.stdout}"


# ── 空跑不可以看起來像成功 ──────────────────────────────────────────────────

def test_an_empty_scan_fails_instead_of_passing(tmp_path):
    """一課都沒掃到不是「全部通過」，是「這道門沒在看」。

    ⚠️ 這是這一族最容易出的假綠：`curriculum-drift-check.yml` 就是這樣 ——
    private/ 在 runner 裡不存在 → skip → 綠燈，每一個碰 lesson 資料的 PR 都拿到
    一個什麼都沒檢查的 ✅。
    """
    (tmp_path / "sot").mkdir()
    (tmp_path / "lessons" / "_extracted").mkdir(parents=True)
    r = _offline(tmp_path / "sot", tmp_path / "lessons", no_path=True)
    assert r.returncode == 1, f"零課掃描被當成通過：\n{r.stdout}"


# ── 接線本身也要鎖：門存在但沒人跑 = 等於不存在 ─────────────────────────────

def test_the_gate_is_actually_wired_into_run_ci():
    """這一輪的病根就是「門存在、沒人跑」。接線沒鎖住，下一個人刪掉它照樣全綠。"""
    ci = RUN_CI.read_text(encoding="utf-8")
    # ⚠️ 只 grep 檔案內容會被**註解**餵飽：把整行執行拔掉、留下解釋它的那段註解，
    #    斷言照樣綠。所以先把註解行剃掉，只看真的會執行的那幾行。
    live = [ln for ln in ci.splitlines() if not ln.lstrip().startswith("#")]
    runs = [ln for ln in live if "sot_drift_check.py" in ln and "--offline" in ln]
    assert runs, ("run-ci.sh 沒有**執行**這道門（註解提到不算）—— "
                  "那它又是一支只有人想到才會跑的腳本")
    assert "set -euo pipefail" in ci, "沒有 pipefail，gate 失敗會被吞掉"
