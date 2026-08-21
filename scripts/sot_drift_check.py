#!/usr/bin/env python3
"""教材 SOT 有沒有被更新 —— 用 MD5 比，不看時間

為什麼需要這支
--------------
教材住在 Google Drive，抽取用的是本機快照。案主一改 Drive，本機就過期了 ——
而**過期不會有任何徵兆**：抽取照跑、逐字門照過（它比對的是本機那份原稿），
產出的 yml 忠實反映一份已經作廢的教材。

2026-08-17 就發生了：6/7/8 年級當天 20:28 被更新，而本機快照停在那之前，
其中 7 年級與 8 年級各有一課**已經抽完了**。

判準用 **MD5** 不用修改時間：Drive 的 modTime 會因為搬檔、改名、權限變更而跳動，
用時間比會一直誤報；內容沒變 MD5 就不會變。

真正有用的輸出不是「3 個資料夾變了」，而是**哪幾課要重抽**。

這支問的是**兩個**問題，只有第一個需要 Drive
--------------------------------------------
    SOT_DRIFT   本機快照 vs Drive         → 要 rclone／網路／folder id，逾時上限 600 秒
    SOT_STALE   已抽的課 vs 本機原稿指紋   → **純本機**，不碰網路

`--offline` 只跑第二個。它答的是「這份**已經 commit** 的抽取結果，還對得上它
宣稱的來源嗎」—— 正是 8/17 那種靜默作廢的形狀，而且答案完全在 repo 與本機
快照裡。因為不用網路也不用憑證，它接得進 `specs/run-ci.sh` 當 push 前的門；
完整那半留給排程與手動。

用法：
    python3 scripts/sot_drift_check.py                 # 完整（要 Drive）
    python3 scripts/sot_drift_check.py --offline       # 只查指紋，不碰網路
    python3 scripts/sot_drift_check.py --json out.json # 另存機器可讀

退出碼：0 = 一致；1 = 有差異、有作廢的課、或什麼都沒掃到
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import unicodedata
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
SOT = REPO / "private/curriculum-source/_SOT"
LESSONS = REPO / "backend/data/lessons"
ENV_KEY = "DRIVE_FOLDER_LINGOLEAP_ERXIU_SOT"


def folder_id() -> str:
    """folder id 走 .env，不寫進 git（見 rules/drive-secrets-policy）。"""
    fid = os.environ.get(ENV_KEY)
    if fid:
        return fid
    for env in (REPO / "private/.env", REPO / ".env", Path.home() / ".config/claude/secrets.env"):
        if not env.is_file():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{ENV_KEY}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        f"⛔ 找不到 {ENV_KEY}。把 folder id 寫進 private/.env（該檔 gitignored）：\n"
        f"   echo '{ENV_KEY}=<folder id>' >> private/.env"
    )


def nfc(s: str) -> str:
    """macOS 的檔名是 NFD、Drive 回 NFC —— 不正規化的話每個中文檔名都會被判成不同檔。"""
    return unicodedata.normalize("NFC", s)


def remote_files(fid: str) -> dict[str, dict]:
    cmd = ["rclone", "lsjson", "gdrive:", "--drive-root-folder-id", fid,
           "--recursive", "--files-only", "--hash"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise SystemExit(f"⛔ 讀不到 Drive：{r.stderr.strip()[:200]}")
    out = {}
    for f in json.loads(r.stdout or "[]"):
        # `~$xxx.docx` 是 Word 開檔時建的鎖檔，不是教材。它們會隨著誰打開過而
        # 出現消失，當成差異看會讓這支門一直亂叫。
        if Path(f["Path"]).name.startswith("~$"):
            continue
        out[nfc(f["Path"])] = {
            "md5": (f.get("Hashes") or {}).get("md5", ""),
            "size": f.get("Size"),
            "mtime": f.get("ModTime", "")[:19],
        }
    return out


def local_files(sot_root: Path | None = None) -> dict[str, dict]:
    root = sot_root or SOT
    out = {}
    if not root.is_dir():
        return out
    for p in root.rglob("*"):
        if not p.is_file() or p.name.startswith(".") or p.name == "STAMP.md":
            continue
        out[nfc(str(p.relative_to(root)))] = {
            "md5": hashlib.md5(p.read_bytes()).hexdigest(),
            "size": p.stat().st_size,
        }
    return out


def extracted_by_drive_path(lessons_root: Path | None = None) -> dict[str, str]:
    """drive_path → lesson_uid，只收**已經抽過**的課（那些才需要重抽）。"""
    root = lessons_root or LESSONS
    done = {p.stem for p in (root / "_extracted").glob("*.yml")}
    out = {}
    for uid in done:
        for v in ("v3", "v2"):
            f = root / uid / v / "lesson.yml"
            if not f.is_file():
                continue
            dp = ((yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("source") or {}).get("drive_path")
            if dp:
                out[nfc(dp)] = uid
                break
    return out


def stale_lessons(local: dict[str, dict], by_path: dict[str, str],
                  seed: set[str] | None = None,
                  lessons_root: Path | None = None) -> set[str]:
    """哪幾課的抽取結果對不上它宣稱的來源。

    ⚠️ 只有這一段是**純本機**的（`--offline` 跑的就是它）。`seed` 給完整模式
    放「Drive 上已經改掉／刪掉的檔對到的課」，離線模式沒有那條線。
    """
    root = lessons_root or LESSONS
    stale = set(seed or ())
    for uid in sorted(set(by_path.values())):
        f = root / uid / "v3/lesson.yml"
        if not f.is_file():
            continue
        src = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("source") or {}
        dp, stamped = nfc(src.get("drive_path") or ""), src.get("docx_md5")
        if not stamped:
            stale.add(uid)          # 沒指紋 = 抽取當時沒通過逐字門，或原稿已經變了
        elif dp in local and f"md5-12:{local[dp]['md5'][:12]}" != stamped:
            stale.add(uid)
    return stale


def run_offline(sot_root: Path | None, lessons_root: Path | None) -> int:
    """只問「已經 commit 的抽取結果，還對得上它宣稱的來源嗎」。

    不碰網路、不需要 Drive 憑證，所以接得進 push 前的門（`specs/run-ci.sh`）。
    看不到的那一半是「Drive 上已經改了但本機還沒同步」—— 那要完整模式才知道。
    """
    lessons = lessons_root or LESSONS
    local = local_files(sot_root)
    by_path = extracted_by_drive_path(lessons)

    if not by_path:
        # ⛔ 一課都沒掃到不是「全部通過」，是「這道門沒在看」。
        #    `curriculum-drift-check.yml` 就是這樣：private/ 在 runner 裡不存在 →
        #    skip → 綠燈，每個碰 lesson 資料的 PR 都拿到一個什麼都沒檢查的 ✅。
        print("⛔ 一課都沒掃到 —— 視為失敗，別讓空跑看起來像成功")
        print("SOT_STALE=UNKNOWN")
        return 1

    stale = stale_lessons(local, by_path, lessons_root=lessons)

    scope = (f"原稿快照 {len(local)} 檔" if local
             else "⚠️ 沒有本機原稿快照 —— 只驗得到「有沒有指紋」，驗不到「指紋對不對」")
    print(f"離線模式：已抽取 {len(set(by_path.values()))} 課 / {scope}")

    if stale:
        print(f"\n🔴 抽取結果與本機原稿對不上、**必須重抽**：{len(stale)} 課")
        for uid in sorted(stale):
            print(f"  {uid}")
        print("\n   下一步：`python3 scripts/sot_drift_check.py` 跑完整版看 Drive 那邊改了什麼，")
        print("   先 `--backup` 留舊版再同步，然後重抽這幾課。")
    else:
        print("✅ 已抽取的課，都對得上它宣稱的來源")

    print(f"\nSOT_STALE={len(stale)}" + (f"  → {' '.join(sorted(stale))}" if stale else ""))
    return 1 if stale else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", type=Path)
    ap.add_argument("--backup", type=Path, metavar="DIR",
                    help="把即將被覆蓋的本機檔先複製到 DIR（同步前跑）")
    ap.add_argument("--offline", action="store_true",
                    help="只查 SOT_STALE（已抽的課 vs 本機原稿指紋），不碰 Drive／網路")
    ap.add_argument("--sot-root", type=Path, default=None, help="改看別的原稿快照（測試用）")
    ap.add_argument("--lessons-root", type=Path, default=None, help="改看別的課樹（測試用）")
    a = ap.parse_args()

    if a.offline:
        return run_offline(a.sot_root, a.lessons_root)

    remote = remote_files(folder_id())
    local = local_files()
    if not remote or not local:
        print("⛔ 有一邊是空的 —— 視為失敗，不要把空比對當成一致")
        return 1

    added = sorted(set(remote) - set(local))
    removed = sorted(set(local) - set(remote))
    changed = sorted(k for k in set(remote) & set(local)
                     if remote[k]["md5"] and remote[k]["md5"] != local[k]["md5"])

    print(f"遠端 {len(remote)} 檔 / 本機 {len(local)} 檔")
    for tag, items in (("Drive 有、本機沒有", added),
                       ("本機有、Drive 沒有", removed),
                       ("內容不一樣", changed)):
        print(f"\n{tag}：{len(items)}")
        for k in items[:12]:
            extra = f"  (Drive {remote[k]['mtime']})" if k in remote else ""
            print(f"  · {k}{extra}")
        if len(items) > 12:
            print(f"  …另外 {len(items) - 12} 筆")

    # 這才是重點：哪幾課的抽取結果作廢了。
    #
    # 兩條線都要看，因為它們抓的是不同時機：
    #   (1) 本機 vs Drive  → 「你手上這份快照過期了」（同步之後這條就沒了）
    #   (2) 抽取時的指紋 vs 現在的原稿 → 「這份抽取結果本身作廢了」（同步之後才看得到）
    # 只看 (1) 的話，同步完訊號就消失，作廢的抽取結果會靜靜留在庫裡。
    by_path = extracted_by_drive_path()
    stale = stale_lessons(local, by_path,
                          seed={by_path[k] for k in changed + removed if k in by_path})

    print(f"\n{'=' * 46}")
    if stale:
        print(f"🔴 抽取結果與現行原稿對不上、**必須重抽**：{len(stale)} 課")
        for uid in sorted(stale):
            print(f"  {uid}")
    else:
        print("✅ 已抽取的課，內容都對得上現行原稿")

    if a.backup and (changed or removed):
        # ⚠️ 同步會覆蓋本機檔，而 SOT 是 gitignored 的快照 —— 覆蓋掉就**沒有舊版可比**了。
        #    2026-08-17：G8-L4 更新後我想確認「改了哪裡」，才發現舊版已經被自己蓋掉，
        #    只能整課重抽。留一份就能直接 diff，知道是改三個字還是改一整節。
        import shutil
        for k in changed + removed:
            src = SOT / k
            if not src.is_file():
                continue
            dst = a.backup / k
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        print(f"\n已備份 {len(changed) + len(removed)} 個即將被覆蓋的檔 → {a.backup}")

    if a.json:
        a.json.write_text(json.dumps(
            {"added": added, "removed": removed, "changed": changed, "stale_lessons": stale},
            ensure_ascii=False, indent=2), encoding="utf-8")

    # ⚠️ 判決要**同時**反映兩個方向，否則就是假綠。
    #
    #    2026-08-18：這裡原本只算 `added/removed/changed`（本機 vs Drive），
    #    於是畫面上印著「🔴 必須重抽：1 課 L0122」，最後一行卻印 `IN_SYNC` ——
    #    而我拿那行寫進 commit 訊息。本檔開頭自己寫著「它問兩個不同的問題，
    #    缺一不可」，判決行卻只問了一個。
    #
    #    兩個方向意思不同，所以verdict 也要分得開：
    #      SOT_DRIFT=DRIFT  → 你手上的原稿過期了（去同步）
    #      SOT_STALE=N      → 那 N 課的抽取結果本身作廢了（去重抽）
    drifted = bool(added or removed or changed)
    print(f"\nSOT_DRIFT={'DRIFT' if drifted else 'IN_SYNC'}")
    print(f"SOT_STALE={len(stale)}" + (f"  → {' '.join(sorted(stale))}" if stale else ""))
    return 1 if (drifted or stale) else 0


if __name__ == "__main__":
    sys.exit(main())
