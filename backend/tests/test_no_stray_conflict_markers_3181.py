"""版控衝突標記不可以留在追蹤中的檔案裡（#3181）。

## 為什麼

`.claude/skills/extract-vocab-definitions/SKILL.md` 在 `origin/staging` 上帶著
`<<<<<<< Updated upstream`（第 284 行）與 `=======`（**檔案最後一行**），
沒有 `>>>>>>>` —— 是有人 `git stash pop` 撞到衝突、清掉對方那半、忘了刪標記。

⭐ **這不只是難看。** `.claude/skills/**` 是「下一個人拿來當規格讀」的東西，
`pytest.yml` 的 paths-filter 還特地把它列進去，理由自己寫著：

> skill 是「下一個人拿來當規格讀」的東西。2026-08-30 就是 code 改了、skill 沒改 ——
> 分家的後果不是報錯，是下一個人照文件把 code 改回去。

一份夾著衝突標記的規格，讀的人不知道哪一段才算數。而**沒有任何測試會因為它而紅** ——
它就這樣待著，直到有人為了別的事掃全庫才撞見。

## 為什麼不用 grep 當 pre-commit

pre-commit 只看 staged 的檔。這個標記是**已經合進主線**的，pre-commit 早就錯過它了。
要抓「已經在樹上」的殘骸，得掃整棵樹。
"""
import pathlib
import subprocess

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]

# 開頭就是這些的行才算 —— 文章裡提到 `<<<<<<<` 不會頂到行首
MARKERS = ("<<<<<<< ", ">>>>>>> ")
EQUALS = "======="

TEXT_SUFFIXES = {".md", ".py", ".ts", ".tsx", ".js", ".mjs", ".cjs",
                 ".json", ".yml", ".yaml", ".sh", ".css", ".html"}

# 刻意含範例的檔 —— 每一筆都要寫清楚為什麼
ALLOWLIST = {
    # 給實習生的 Git 教學，正文就是在教衝突長什麼樣。
    # ⚠️ 有兩份：`frontend/public/` 那份是 SOT（staging 的儀表板從那裡讀），
    #    `docs/` 那份是已棄用的鏡像。兩份都要列，否則這條鎖會對著教材紅。
    #    （鏡像哪天清掉，下面 test_allowlist_entries_still_exist 會紅提醒移除。）
    "frontend/public/intern-training/courses/tier1-git-basics.md",
    "docs/intern-training/courses/tier1-git-basics.md",
}


def _tracked_text_files():
    out = subprocess.run(
        ["git", "-C", str(REPO), "ls-files", "-z"],
        capture_output=True, text=True, check=True,
    ).stdout
    for rel in out.split("\0"):
        if not rel:
            continue
        if pathlib.Path(rel).suffix not in TEXT_SUFFIXES:
            continue
        if rel in ALLOWLIST:
            continue
        yield rel


def _markers_in(rel: str):
    p = REPO / rel
    try:
        text = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    hits = []
    for i, line in enumerate(text.split("\n"), 1):
        if line.startswith(MARKERS):
            hits.append((i, line[:40]))
        elif line.rstrip() == EQUALS:
            # 單獨的 ======= 在 markdown 裡是合法的標題底線，
            # 所以只有在同一個檔案也有 <<<<<<< 時才算
            hits.append((i, "======="))
    return hits


def test_no_tracked_file_carries_conflict_markers():
    """⭐ 追蹤中的文字檔不可以含 git 衝突標記。"""
    offenders = {}
    for rel in _tracked_text_files():
        hits = _markers_in(rel)
        # 只有 ======= 不算（markdown 的 setext 標題底線）
        if any(h[1].startswith(MARKERS) for h in hits):
            offenders[rel] = hits
    assert not offenders, (
        "這些追蹤中的檔案留著版控衝突標記 —— 讀的人不知道哪一段才算數：\n"
        + "\n".join(f"  {f}: {hits}" for f, hits in offenders.items())
    )


def test_the_scan_can_actually_find_markers(tmp_path):
    """正向對照：證明這個掃法真的抓得到。

    少了它，掃法若因為副檔名清單、編碼或 `git ls-files` 出錯而掃到 0 個檔，
    上面那條會恆綠 —— 那是「檢查了等於沒檢查」。
    """
    files = list(_tracked_text_files())
    assert len(files) > 500, (
        f"只掃到 {len(files)} 個檔 —— 掃法壞了（副檔名清單？git ls-files？），"
        f" 上面那條斷言在這種狀態下恆綠"
    )

    probe = tmp_path / "probe.md"
    probe.write_text("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n", encoding="utf-8")
    # 直接驗判斷邏輯，不依賴 REPO 路徑
    lines = probe.read_text(encoding="utf-8").split("\n")
    found = [l for l in lines if l.startswith(MARKERS)]
    assert len(found) == 2, f"對一個明顯有標記的檔只抓到 {found} —— 判斷式壞了"


def test_allowlist_entries_still_exist():
    """白名單裡的檔案若被刪或改名，要紅 —— 免得白名單默默變成空話。"""
    for rel in ALLOWLIST:
        assert (REPO / rel).exists(), (
            f"白名單列著 {rel} 但檔案不在了 —— 請把它從 ALLOWLIST 移除，"
            f" 不要留一條永遠不會命中的例外"
        )
