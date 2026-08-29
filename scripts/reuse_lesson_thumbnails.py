#!/usr/bin/env python3
"""reuse_lesson_thumbnails.py — carry the first edition's cover images over (#2683).

170 covers were generated in 2026-05 (Gemini wrote the prompt, Imagen rendered it) and
are still in `gs://lingoleap-assets/stories/thumbnails/<code>.webp`. The second edition
serves none, so every library card renders as a broken image.

WHY NOT MATCH ON THE LESSON CODE
--------------------------------
Because the codes were renumbered, and matching on them produces a picture of the wrong
lesson. Measured, not assumed: first-edition `G4-L10.webp` is a bus interior — that
lesson was about giving up a seat — while second-edition G4-L10 is 《十秒的背後》, about
a sprinter. This is the same defect that put another lesson's passage into 重點朗讀.

So the join is on the TITLE. The registry keeps the first edition's 165 code↔title
pairs under `retired`, which gives: second-edition title → first-edition title →
first-edition code → image. Titles are compared with punctuation and width folded away,
since those drift between editions.

Verified by looking at the images, not just the counts: 《誤會》 resolves to a crowded
bus with an elderly man standing — which is that lesson — and 《美好的一天》 to the
bus interior that the code-based join had wrongly given to the sprinter.

105 of 175 lessons match. The remaining 70 are 33 lessons whose first-edition twin was
never given a cover and 37 that are new this edition; they need generating, which is
blocked on Imagen access in this project.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

BUCKET = "lingoleap-assets"
PREFIX = "stories/thumbnails"
LESSONS = ROOT / "backend" / "data" / "lessons"
REGISTRY = ROOT / "docs" / "curriculum" / "lesson-uid-registry.yml"

_PUNCT = "「」『』（）(),，。.？?！!：:；;、－-—～~　 "


def norm_title(t: str | None) -> str:
    t = unicodedata.normalize("NFKC", t or "")
    return "".join(c for c in t if c not in _PUNCT)


def unpad(code: str | None) -> str:
    """G4-L02 → G4-L2. The bucket stores unpadded codes."""
    m = re.match(r"^(G\d+|文|體[^-]*)-L0*(\d+)$", code or "")
    return f"{m[1]}-L{int(m[2])}" if m else (code or "")


def _token() -> str:
    import google.auth
    import google.auth.transport.requests as tr

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(tr.Request())
    return creds.token


def _get(url: str, token: str) -> bytes:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    return urllib.request.urlopen(req, timeout=60).read()


def available(token: str) -> set[str]:
    url = (f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o"
           f"?prefix={PREFIX}&maxResults=500&fields=items(name)")
    items = json.loads(_get(url, token)).get("items", [])
    return {i["name"].split("/")[-1].removesuffix(".webp") for i in items}


def main() -> int:
    import yaml

    from app.services.lesson_loader import get_all_lessons

    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    token = _token()
    have = available(token)
    reg = yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))

    first_edition: dict[str, str] = {}
    for row in reg.get("retired") or []:
        if row.get("code") and row.get("title"):
            first_edition.setdefault(norm_title(row["title"]), unpad(row["code"]))

    reused = no_image = new_lesson = 0
    for lesson in get_all_lessons():
        uid = lesson["lesson_uid"]
        key = norm_title(lesson["title"])
        code = first_edition.get(key)
        if not code:
            new_lesson += 1
            continue
        if code not in have:
            no_image += 1
            continue

        vdirs = sorted((c for c in (LESSONS / uid).iterdir()
                        if c.is_dir() and c.name.startswith("v")), key=lambda c: c.name)
        if not vdirs:
            continue
        assets = vdirs[-1] / "assets"
        out = assets / "thumbnail.webp"

        if not a.dry_run:
            assets.mkdir(parents=True, exist_ok=True)
            # 文-L4 / 體-L2 are real lesson codes, so the object name must be
            # percent-encoded — an un-encoded CJK path raises UnicodeEncodeError
            # inside http.client rather than failing as a request.
            obj = urllib.parse.quote(f"{PREFIX}/{code}.webp", safe="")
            url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{obj}?alt=media"
            data = _get(url, token)
            # A missing object comes back as a 62-byte text body, not a 404 — writing it
            # would leave a file that looks like an image and is not one.
            if not data.startswith(b"RIFF"):
                no_image += 1
                continue
            out.write_bytes(data)
            # Record where it came from: this image was made for a different lesson
            # code, and the only thing tying it here is the title.
            (assets / "thumbnail.source.json").write_text(
                json.dumps({
                    "reused_from_first_edition": True,
                    "first_edition_code": code,
                    "matched_on": "title",
                    "note": "課號在二修重編過，照課號接會接到別課的圖（#2683）",
                }, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        reused += 1

    print(f"  沿用 {reused} 課")
    print(f"  一修沒生過圖 {no_image} 課 · 二修新課 {new_lesson} 課 → 待生成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
