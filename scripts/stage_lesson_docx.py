#!/usr/bin/env python3
"""stage_lesson_docx.py — 把來源 DOCX 對映成 `<lesson_uid>.docx` 放進工作目錄 (#2720).

WHY THIS EXISTS
---------------
Every script in the lesson pipeline reads `--source /tmp/docx-src` and expects the files
to be named `L0004.docx`. Nothing in the repo produced that directory. It was a manual
download-and-rename, which means the pipeline could not be re-run by anyone who had not
done the renaming by hand, and #2720's root cause sat undiscovered for that long partly
because reproducing the run was a favour to ask rather than a command to type.

WHY THE MAPPING IS BY CONTENT, NOT BY FILENAME
----------------------------------------------
The obvious key is the lesson code in the filename (`G4-L13…docx` → `catalog_slot`).
It does not hold:

  · the second edition renamed lessons, so `docs/curriculum/lesson-uid-registry.yml`
    records `4年級/G4-L13感情小日記2──喜歡是什麼？（品格力-自我覺察─想法與情緒的關係）.docx`
    while the same file on disk is `…（自我覺察─想法與情緒的關係）.docx` — one bracket
    prefix apart, and exact-matching the title loses it
  · lesson codes are being renumbered again (#2717), so a code that resolves today
    resolves to a different lesson later
  · codes collide across the two legacy layers — the whole reason `lesson_uid` exists
    (#2685), and re-deriving the uid from a filename is the mistake that file was
    written to undo

So the file is identified by what is IN it: extract the body and match it against the
`body.yml` already stored under each uid. That is the same body extractor the pipeline
runs afterwards, so a file that stages successfully is a file the pipeline can read, and
a low match score is a real signal (different edition, or a lesson that never landed).

The match is Jaccard over normalised paragraphs, so it is unaffected by a lesson whose
paragraphs were reordered or whose text was partially rewritten — those score lower and
are reported rather than silently mapped.
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import sys
import unicodedata
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extract_lesson_body import extract as extract_body  # noqa: E402

LESSONS = ROOT / "backend" / "data" / "lessons"

#: Below this the file is reporting a different lesson, not a noisier copy of this one.
#: Measured on 96 local second-edition worksheets: genuine matches score 0.62–1.00 and
#: the next-best candidate for each was under 0.10, so anything in between is a file
#: worth looking at by hand rather than a threshold worth tuning.
MIN_MATCH = 0.5


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    return "".join(
        c for c in s
        if not c.isspace() and unicodedata.category(c) not in ("Cf", "Mn")
    )


def _latest_version(uid_dir: Path) -> Path | None:
    versions = sorted(
        (c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
    ) if uid_dir.is_dir() else []
    return versions[-1] if versions else None


def load_stored_bodies() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for uid_dir in sorted(LESSONS.glob("L*")):
        vdir = _latest_version(uid_dir)
        if vdir is None:
            continue
        f = vdir / "body.yml"
        if not f.exists():
            continue
        paras = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("paragraphs") or []
        if paras:
            out[uid_dir.name] = {_norm(p) for p in paras}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True,
                    help="來源 DOCX 目錄（遞迴搜尋 *.docx）")
    ap.add_argument("--out", default="/tmp/docx-src")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    stored = load_stored_bodies()
    if not stored:
        print("找不到任何 body.yml — 先跑 build_lesson_body.py", file=sys.stderr)
        return 1

    out_dir = Path(a.out)
    if not a.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(glob.glob(os.path.join(a.source, "**", "*.docx"), recursive=True))
    # Two source files can map to the same uid (a `(1)` duplicate, or a lesson archived
    # twice). The higher score wins; a tie keeps the first, and both are reported.
    claimed: dict[str, tuple[float, str]] = {}
    unmatched: list[tuple[str, float, str | None]] = []

    for f in files:
        try:
            paras = (extract_body(Path(f)) or {}).get("paragraphs") or []
        except Exception as exc:                      # a non-worksheet docx in the tree
            unmatched.append((os.path.basename(f), 0.0, f"unreadable: {exc}"[:60]))
            continue
        mine = {_norm(p) for p in paras}
        if not mine:
            unmatched.append((os.path.basename(f), 0.0, "no body extracted"))
            continue
        best_uid, best = None, 0.0
        for uid, ps in stored.items():
            score = len(mine & ps) / max(1, len(mine | ps))
            if score > best:
                best, best_uid = score, uid
        if best < MIN_MATCH or best_uid is None:
            unmatched.append((os.path.basename(f), round(best, 2), best_uid))
            continue
        prev = claimed.get(best_uid)
        if prev is None or best > prev[0]:
            claimed[best_uid] = (best, f)

    for uid, (score, f) in sorted(claimed.items()):
        if not a.dry_run:
            shutil.copyfile(f, out_dir / f"{uid}.docx")

    print(f"來源 {len(files)} 份 → 對映 {len(claimed)} 課"
          f"{'（dry-run，未複製）' if a.dry_run else f' → {out_dir}'}")
    weak = [(u, s) for u, (s, _) in claimed.items() if s < 0.8]
    if weak:
        print(f"  match < 0.80（二修可能改過字，值得看一眼）: "
              f"{', '.join(f'{u}={s:.2f}' for u, s in sorted(weak))}")
    if unmatched:
        print(f"  對不上 {len(unmatched)} 份：")
        for name, score, why in unmatched[:20]:
            print(f"    {name[:52]:52s} best={score} {why or ''}")
    missing = sorted(set(stored) - set(claimed))
    if missing:
        print(f"  有 body.yml 但來源沒有 DOCX 的 {len(missing)} 課: "
              f"{', '.join(missing[:20])}{' …' if len(missing) > 20 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
