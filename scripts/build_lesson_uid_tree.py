#!/usr/bin/env python3
"""build_lesson_uid_tree.py — Phase 2 of the second-edition re-ink (#2687).

Runs the existing extraction pipeline and lands its output in the uid tree:

    backend/data/lessons/<lesson_uid>/<version_id>/
        lesson.yml        identity + properties
        spotlight.yml
        keypoints.yml
        assets/

WHY a separate driver instead of editing build_lesson_schema.py
---------------------------------------------------------------
`process_lesson()` writes three hard-coded flat paths
(`{out}/{code}.spotlight.yml`, `{out}/{code}.keypoints.yml`, `{out}/assets/{code}/`)
inside a 2,400-line module that 20+ scripts and tests already depend on.
Rewriting those paths in place would put every existing consumer at risk for no
gain — the extraction logic itself is unchanged and already proven on the second
edition (72/72 `build_ok`). So this driver calls the pipeline unmodified, into a
scratch dir, and re-homes the artefacts under the uid. Additive, reversible, and
it leaves the flat layout working for anything still reading it during the
Phase 3 dual-path window.

The uid comes from the registry and nowhere else — never from a filename or a
lesson code. That is the whole point of Phase 1.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY = REPO_ROOT / "docs" / "curriculum" / "lesson-uid-registry.yml"
LESSONS_ROOT = REPO_ROOT / "backend" / "data" / "lessons"
PIPELINE = REPO_ROOT / "scripts" / "build_lesson_schema.py"

DEFAULT_VERSION = "v2"  # second edition


def load_registry() -> list[dict]:
    reg = yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))
    return reg["lessons"]


def build_one(entry: dict, docx: Path, version: str, python: str) -> dict:
    """Run the pipeline for one lesson and re-home its output under the uid."""
    uid = entry["lesson_uid"]
    code = entry["catalog_slot"] or uid
    dest = LESSONS_ROOT / uid / version
    result = {"lesson_uid": uid, "catalog_slot": code, "ok": False,
              "spotlight": False, "keypoints": False, "assets": 0, "error": None}

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        proc = subprocess.run(
            [python, str(PIPELINE), code, str(docx), "--output-dir", str(tmp_path)],
            capture_output=True, text=True, timeout=300,
        )
        if proc.returncode != 0:
            result["error"] = (proc.stderr or proc.stdout).strip().splitlines()[-1:] or ["unknown"]
            result["error"] = result["error"][0][:200]
            return result

        # the pipeline names its output by the *resolved* code, which may be
        # normalised (G4-L02 → G4-L2), so glob rather than assume.
        sp = next(tmp_path.glob("*.spotlight.yml"), None)
        kp = next(tmp_path.glob("*.keypoints.yml"), None)
        assets_src = next((p for p in (tmp_path / "assets").glob("*") if p.is_dir()), None)

        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True, exist_ok=True)

        if sp:
            shutil.copy2(sp, dest / "spotlight.yml")
            result["spotlight"] = True
        if kp:
            shutil.copy2(kp, dest / "keypoints.yml")
            result["keypoints"] = True
        if assets_src:
            shutil.copytree(assets_src, dest / "assets")
            result["assets"] = len(list((dest / "assets").iterdir()))

        # identity file — the only place uid/version/slot are asserted together
        (dest / "lesson.yml").write_text(
            yaml.dump({
                "lesson_uid": uid,
                "version_id": version,
                "title": entry["title"],
                "catalog_slot": entry["catalog_slot"],
                "source": {
                    "drive_file_id": entry["drive_file_id"],
                    "drive_path": entry["drive_path"],
                },
            }, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        result["ok"] = True
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-root", required=True,
                    help="本機的 Drive 教材根目錄（含 4年級/ 5年級/ …）")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 課（0 = 全部）")
    ap.add_argument("--uid", action="append", help="只跑指定 uid，可重複")
    ap.add_argument("--version", default=DEFAULT_VERSION)
    ap.add_argument("--python", default=sys.executable)
    a = ap.parse_args()

    src = Path(a.source_root)
    entries = load_registry()
    if a.uid:
        entries = [e for e in entries if e["lesson_uid"] in set(a.uid)]
    if a.limit:
        entries = entries[: a.limit]

    ok = fail = missing = 0
    rows = []
    for e in entries:
        docx = src / e["drive_path"]
        if not docx.exists():
            missing += 1
            rows.append((e["lesson_uid"], e["catalog_slot"], "MISSING_DOCX", ""))
            continue
        r = build_one(e, docx, a.version, a.python)
        if r["ok"]:
            ok += 1
            rows.append((r["lesson_uid"], r["catalog_slot"], "ok",
                         f"sp={'Y' if r['spotlight'] else '-'} kp={'Y' if r['keypoints'] else '-'} assets={r['assets']}"))
        else:
            fail += 1
            rows.append((r["lesson_uid"], r["catalog_slot"], "FAIL", r["error"] or ""))

    for uid, code, st, note in rows:
        mark = "  ✅" if st == "ok" else "  ❌"
        print(f"{mark} {uid} {code:10s} {st:12s} {note}")
    print(f"\n  ok={ok} fail={fail} missing_docx={missing} / {len(entries)}")
    return 0 if fail == 0 and missing == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
