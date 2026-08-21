#!/usr/bin/env python3
"""把總表「4.影片連結」分頁的 YouTube 網址接進 v3 的 `resources.yml`。

取代 `migrate_legacy_video_urls.py`
----------------------------------
先前那支用「課名」去猜一修 catalog 是哪一課，只接得到 14 課，而且接錯過一次
（L0123 掛上了另一課的兩支影片，課名精確吻合、支數也吻合，兩個獨立信號都同意，
還是錯的）。

Young 直接給了權威來源：`自學教材總表0816.xlsx` 的「4.影片連結」分頁，
每列是 適用年級／課次／課名／影片1-4。用 **(年級, 課次)** 對接，
**174 列全部對得到，0 miss** —— 那是這批教材本來就在用的識別方式
（`grade_code` 的 `G4-L10` 就是年級 4 課次 10）。

課名當交叉檢查，不當主鍵
------------------------
121 課課名精確吻合、15 課有小差異（「動物的生存妙招」vs「動物生存的妙招」這種）。
課名不一致時仍然採用（課次是結構性的鍵，比人手打的課名可靠），但會印出來，
因為那也可能是真的對錯課了。

為什麼不是只補「worksheet 有列影片」的那 19 課
--------------------------------------------
因為那個數字本身就是 bug 的一部分。學習單上只有 19 課把影片列成文字，
其餘 120 課只印了 QR code —— 抽取讀不到 QR，所以 `resources.yml` 沒有 videos，
於是「知識補給站」對這 120 課也一樣顯示「這篇課文目前沒有知識補給站影片」。
總表兩邊都涵蓋，所以這支以總表為準，worksheet 有片名時拿來當標題。

用法：
    python3 scripts/migrate_master_sheet_video_urls.py --dry-run
    python3 scripts/migrate_master_sheet_video_urls.py
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "data" / "lessons"
SHEET = REPO / "data" / "curriculum_qa" / "自學教材總表0816.xlsx"
TAB = "4.影片連結"

_PUNCT = re.compile(r"[\s―—–\-－_、，,。．.：:；;！!？?「」『』（）()《》〈〉\"'#＃]")
_GRADE_CODE = re.compile(r"^G(\d+)-L(\d+)")


def norm(t: str) -> str:
    return _PUNCT.sub("", str(t)).lower()


def load_sheet() -> dict[tuple[str, str], tuple[str, list[str]]]:
    import openpyxl

    wb = openpyxl.load_workbook(SHEET, read_only=True, data_only=True)
    out: dict[tuple[str, str], tuple[str, list[str]]] = {}
    for row in wb[TAB].iter_rows(min_row=2, values_only=True):
        _, grade, lesson_no, title, *videos = row
        if grade is None or lesson_no is None:
            continue
        urls = [str(v).strip() for v in videos[:4] if v and str(v).strip().startswith("http")]
        out[(str(grade).strip(), str(int(str(lesson_no).strip())))] = (
            str(title or "").strip(), urls,
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not SHEET.exists():
        raise SystemExit(f"⛔ 找不到總表：{SHEET}")

    sheet = load_sheet()
    if len(sheet) < 100:
        raise SystemExit(f"⛔ 總表只讀到 {len(sheet)} 列，明顯太少 —— 分頁名或格式變了")

    sys.path.insert(0, str(REPO))
    from app.services.lesson_loader import search_lessons  # noqa: E402

    written = skipped = mismatched = 0
    for lesson in search_lessons():
        uid = lesson.get("lesson_uid")
        m = _GRADE_CODE.match(str(lesson.get("grade_code") or ""))
        if not (uid and m):
            skipped += 1
            continue
        key = (m.group(1), str(int(m.group(2))))
        sheet_title, urls = sheet.get(key, ("", []))
        if not urls:
            continue

        f = LESSONS / uid / "v3" / "resources.yml"
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) if f.exists() else None
        doc = doc or {"lesson_uid": uid, "version_id": "v3"}
        res = doc.setdefault("resources", {})
        res.setdefault("section_name", "知識補給站")
        res.setdefault("label", "影片連結")
        videos = res.get("videos") or []

        title_ok = norm(lesson.get("title") or "") == norm(sheet_title)
        if not title_ok:
            mismatched += 1
            print(f"  ⚠️ {uid} {key} 課名不符：課程「{lesson.get('title')}」 vs 總表「{sheet_title}」")

        # 學習單有列片名就沿用；沒有就只有網址（畫面顯示「影片 N」）。
        merged = []
        for i, url in enumerate(urls):
            existing = videos[i] if i < len(videos) else {}
            merged.append({
                **{k: v for k, v in existing.items() if k not in ("url", "url_source")},
                "index": i + 1,
                "url": url,
                "url_source": f"總表0816「{TAB}」年級{key[0]}課次{key[1]}"
                              + ("" if title_ok else "（⚠️課名與課程不符，仍依課次採用）"),
            })
        res["videos"] = merged
        written += 1
        if not args.dry_run:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(
                yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=200),
                encoding="utf-8",
            )

    print(f"\n  寫入 {written} 課（其中 {mismatched} 課課名不符但依課次採用），跳過 {skipped}"
          + ("　※ dry-run，沒有真的寫入" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
