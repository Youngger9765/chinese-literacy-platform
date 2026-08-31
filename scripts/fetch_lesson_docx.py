#!/usr/bin/env python3
"""fetch_lesson_docx.py — 從 Google Drive 抓二修 DOCX 成 `<lesson_uid>.docx` (#2720).

WHY THIS EXISTS
---------------
`docs/curriculum/lesson-uid-registry.yml` declares where the second edition lives:

    source_of_truth: Google Drive 二修教材資料夾
    lessons:
      - lesson_uid: L0004
        drive_path: 4年級/G4-L4….docx

⛔ **file id 不在那份登記簿裡，也不可以放回去。** 它們住在
`private/curriculum-source/_drive-ids.json`（`private/` 已在 .gitignore）。

原因：這個 repo 是 **public**，而那些 id 未認證就下載得到完整 .docx
（2026-08-31 實測：真檔 HTTP 200 / 479,710 bytes，亂編的 id 回 404）。
175 個 id 寫在公開登記簿裡 = 附上一份可直接下載全部原稿的索引。

Every downstream script then reads `/tmp/docx-src/L0004.docx`, and nothing in the repo
turned the first into the second. Re-running the extraction meant asking whoever had done
the download by hand. That is why #2720 sat undiagnosed: reproducing the pipeline was a
favour, not a command.

The registry already carries the file ids, so this is a lookup, not a search — no folder
crawling, no filename matching, no guessing which revision is current. `stage_lesson_docx.py`
remains for the offline case (a local archive of worksheets, matched by content); this is
the online path and the one that gets the authoritative copy.

AUTH
----
Uses the caller's own gcloud credentials, which need the Drive scope — plain
`gcloud auth login` does not include it:

    gcloud auth login --enable-gdrive-access

Without it the token is valid for GCP and rejected by Drive, which returns 403 with
`insufficientPermissions` rather than an auth error, so that case is reported explicitly
below instead of being counted as a missing file.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "docs" / "curriculum" / "lesson-uid-registry.yml"

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
#: A worksheet is a few hundred KB. A response far below this is an error page that
#: happened to arrive with a 200 — Drive does that for some sharing states.
_MIN_BYTES = 20_000


def access_token() -> str:
    try:
        out = subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            capture_output=True, text=True, check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            "取不到 access token。請先執行：\n"
            "    gcloud auth login --enable-gdrive-access\n"
            f"({(exc.stderr or '').strip().splitlines()[:1]})"
        )
    return out.stdout.strip()


def fetch(file_id: str, token: str) -> bytes:
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/docx-src")
    ap.add_argument("--only", help="逗號分隔的 lesson_uid，只抓這幾課")
    ap.add_argument("--force", action="store_true", help="已存在也重抓")
    a = ap.parse_args()

    if not REGISTRY.exists():
        print(f"找不到 registry：{REGISTRY}", file=sys.stderr)
        return 1
    reg = yaml.safe_load(REGISTRY.read_text(encoding="utf-8")) or {}
    lessons = reg.get("lessons") or []
    wanted = set(a.only.split(",")) if a.only else None

    # file id 住在 gitignored 的側檔，不在公開登記簿裡（見檔頭）。
    # ⛔ 缺了要**大聲失敗**：靜默跳過會讓「抓不到原稿」看起來像「這課本來就沒有」。
    ids_path = REPO / "private" / "curriculum-source" / "_drive-ids.json"
    if not ids_path.is_file():
        raise SystemExit(
            f"⛔ 找不到 {ids_path}\n"
            "   Drive file id 刻意不放進這個 public repo（見本檔檔頭）。\n"
            "   跟其他 private/ 內容一樣，從我方的來源同步取得後再跑。")
    DRIVE_IDS = json.loads(ids_path.read_text(encoding="utf-8")).get("ids") or {}
    if not DRIVE_IDS:
        raise SystemExit(f"⛔ {ids_path} 的 ids 是空的 —— 那不是「沒有課」，是側檔壞了。")

    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    token = access_token()

    got = skipped = 0
    problems: list[tuple[str, str]] = []
    for entry in lessons:
        uid = entry.get("lesson_uid")
        fid = DRIVE_IDS.get(uid)
        if not uid or (wanted and uid not in wanted):
            continue
        if not fid:
            problems.append((uid, "private/curriculum-source/_drive-ids.json 裡沒有這一課"))
            continue
        dest = out_dir / f"{uid}.docx"
        if dest.exists() and not a.force:
            skipped += 1
            continue
        try:
            blob = fetch(fid, token)
        except urllib.error.HTTPError as exc:
            body = (exc.read() or b"").decode("utf-8", "replace")
            hint = ""
            if exc.code == 403 and "insufficientPermissions" in body:
                hint = " — token 缺 Drive scope，跑 gcloud auth login --enable-gdrive-access"
            elif exc.code == 404:
                hint = " — 檔案不存在或你的帳號沒有存取權"
            problems.append((uid, f"HTTP {exc.code}{hint}"))
            continue
        except Exception as exc:                                  # network / timeout
            problems.append((uid, f"{type(exc).__name__}: {exc}"[:70]))
            continue
        if len(blob) < _MIN_BYTES or blob[:2] != b"PK":
            # A DOCX is a zip. Anything else with a 200 is an error page.
            problems.append((uid, f"回傳 {len(blob)} bytes，不是 docx"))
            continue
        dest.write_bytes(blob)
        got += 1

    print(f"下載 {got} 課"
          + (f"，已存在跳過 {skipped}" if skipped else "")
          + f" → {out_dir}")
    if problems:
        print(f"  失敗 {len(problems)} 課：")
        for uid, why in problems[:25]:
            print(f"    {uid}: {why}")
    return 1 if problems and got == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
