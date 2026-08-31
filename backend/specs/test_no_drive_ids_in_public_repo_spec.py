"""這個 repo 是 public，所以 Google Drive file id 一個都不准進來（#3011）。

## 為什麼這是洞，不是潔癖

Drive file id **本身就是通行證**：那個資料夾目前是「知道連結的人都能檢視」，
所以拿到 id 就拿得到檔，不需要帳號。2026-08-31 實測：

    真檔 id → HTTP 200 · 479,710 bytes · 合法 .docx（與本機那份同大小）
    亂編 id → HTTP 404 · 1,652 bytes HTML

而 `docs/curriculum/lesson-uid-registry.yml` 原本就列著 **175 個** id ——
等於在公開 repo 附上一份「可以直接下載全部原始學習單」的索引。
那些是老師寫的教材，沒有對外發布過。

## 這道鎖擋得住什麼、擋不住什麼

擋得住：**未來**再有人把 id 寫回 git-tracked 檔。
擋不住：**已經在 git 歷史裡的那 175 個**（歷史刪不掉），
        以及 Drive 那邊的分享設定 —— 只要它還是「知道連結即可檢視」，
        舊 id 就一直有效。那一半是人的動作（Drive 介面改成「限特定人員」），
        腳本做不到，所以這道鎖只是兩半中的一半。

id 現在住在 `private/curriculum-source/_drive-ids.json`（`private/` 在 .gitignore）。
"""
from __future__ import annotations

import re
import subprocess
import pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]

#: Drive file id 是 `1` 開頭的 33 碼 base64url。⛔ **不能只認這個形狀** ——
#: sha512 的片段、網址 slug 都長得一模一樣（實測誤報：package-lock.json 的
#: integrity 雜湊、一篇市場研究裡的 renegadeeducator.com 網址）。
#: 會誤報的門最後會被關掉，所以這裡只認**真的會洩漏**的三種寫法：
#:   ① `drive_file_id: <id>`（登記簿原本的形狀）
#:   ② Drive 網址帶著 id（分享連結貼進文件）
#:   ③ `--drive-root-folder-id <id>`（rclone 指令被貼進腳本或文件）
ID = r"1[A-Za-z0-9_-]{32}"
PATTERNS = {
    "drive_file_id 欄位": re.compile(rf"drive[_-]?file[_-]?id\s*[:=]\s*['\"]?({ID})\b"),
    "Drive 分享連結": re.compile(rf"(?:drive\.google\.com|googleapis\.com/drive)[^\s'\"]*?({ID})\b"),
    "rclone folder id": re.compile(rf"--drive-root-folder-id[=\s]+['\"]?({ID})\b"),
}

#: 這些副檔名之外的不掃（二進位、雜湊紀錄）
TEXTY = (".yml", ".yaml", ".json", ".md", ".py", ".ts", ".tsx", ".sh", ".txt")


def _tracked() -> list[str]:
    out = subprocess.run(["git", "-C", str(REPO), "ls-files"],
                         capture_output=True, text=True, check=True).stdout
    return [f for f in out.splitlines() if f.endswith(TEXTY)]


def _offenders() -> list[str]:
    bad = []
    for rel in _tracked():
        try:
            text = (REPO / rel).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
        for label, rx in PATTERNS.items():
            m = rx.search(text)
            if m:
                line = text[: m.start()].count("\n") + 1
                bad.append(f"{rel}:{line}（{label}）")
                break
    return bad


def test_positive_control_the_scan_reads_real_files():
    """先證明這個掃描抓得到東西 —— 否則「0 命中」什麼都不證明。"""
    files = _tracked()
    assert len(files) >= 500, f"只掃到 {len(files)} 個檔，掃描本身壞了"


def test_it_recognises_every_leak_shape():
    """三種真的會洩漏的寫法都要認得。"""
    real = "1cHrwbQGdQ9VJsup0GcwwP_oLww8PCaDN"
    assert PATTERNS["drive_file_id 欄位"].search(f"drive_file_id: {real}")
    assert PATTERNS["Drive 分享連結"].search(f"https://drive.google.com/file/d/{real}/view")
    assert PATTERNS["rclone folder id"].search(f"rclone lsf gdrive: --drive-root-folder-id {real}")


def test_it_does_not_cry_wolf_on_things_that_merely_look_like_ids():
    """負向對照：會誤報的門最後會被關掉，所以這幾種一定不能叫。

    這三個都是實測踩過的誤報來源。
    """
    assert not any(rx.search(
        '"integrity": "sha512-uOJamYALNhfJ6iolExyQM40yIQwDqYnkKtQ5VCiSe17E33H0aQ"'
    ) for rx in PATTERNS.values())
    assert not any(rx.search(
        "https://renegadeeducator.com/11-alternative-schools-you-didnt-know-about1abcdefghij"
    ) for rx in PATTERNS.values())
    assert not any(rx.search('"sha256": "b72cacf619c8a14b1741b8d7f3d62f97b744b9735b34763b1b"')
                   for rx in PATTERNS.values())


def test_no_drive_file_ids_are_committed():
    bad = _offenders()
    assert not bad, (
        "這些 git-tracked 檔含 Google Drive file id，而這個 repo 是 public：\n"
        + "\n".join(f"  {x}" for x in bad)
        + "\n\nid 放 private/curriculum-source/_drive-ids.json（gitignored），"
          "登記簿只留 lesson_uid / title / catalog_slot / drive_path。"
    )
