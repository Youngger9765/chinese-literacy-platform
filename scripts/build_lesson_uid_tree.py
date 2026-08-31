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


#: What this pipeline owns in a lesson's version directory. Everything else there —
#: body.yml, sections.yml, metadata.yml, key_reading.yml, assets/thumbnail.webp — is
#: built by a different extractor from the same DOCX and must survive a re-run here.
MODULES = ("spotlight", "keypoints", "assets", "lesson")


def _clear_module(dest: Path, module: str) -> None:
    """Remove only what `module` owns, so a re-run repairs one thing at a time."""
    if module == "assets":
        # assets/ is shared: the figures come from this pipeline, the cover
        # (thumbnail.webp) from reuse_lesson_thumbnails.py.
        if (dest / "assets").is_dir():
            for f in (dest / "assets").iterdir():
                # The thumbnail is chosen once and not re-derivable from the DOCX, and
                # neither is the record of WHICH figure it came from. Keeping the image
                # but not its provenance deleted 105 `thumbnail.source.json` on the first
                # full rebuild — quietly, because a rebuild that writes 175 lessons looks
                # identical whether or not it took something with it.
                if f.name.startswith("thumbnail."):
                    continue
                shutil.rmtree(f) if f.is_dir() else f.unlink()
    else:
        (dest / f"{module}.yml").unlink(missing_ok=True)


def build_one(entry: dict, docx: Path, version: str, python: str,
              modules: tuple[str, ...] = MODULES) -> dict:
    """Run the pipeline for one lesson and re-home its output under the uid.

    `modules` selects what gets rebuilt. Anything not selected is left exactly as it
    is — including files this pipeline does not produce at all.

    This used to `rmtree(dest)` before writing. That was safe when spotlight, keypoints
    and assets were the only things in the directory; they are not any more, and a
    re-run silently deleted body.yml, sections.yml, metadata.yml and key_reading.yml.
    Reproduced on a copy of L0001: eight files in, an empty directory out. The tree
    still looked populated afterwards because the pipeline immediately wrote three of
    them back.
    """
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

        dest.mkdir(parents=True, exist_ok=True)
        for m in modules:
            _clear_module(dest, m)

        if sp and "spotlight" in modules:
            shutil.copy2(sp, dest / "spotlight.yml")
            result["spotlight"] = True
        if kp and "keypoints" in modules:
            shutil.copy2(kp, dest / "keypoints.yml")
            result["keypoints"] = True
        if assets_src and "assets" in modules:
            shutil.copytree(assets_src, dest / "assets", dirs_exist_ok=True)
            result["assets"] = len(list((dest / "assets").iterdir()))

        # identity file — the only place uid/version/slot are asserted together
        if "lesson" in modules:
            (dest / "lesson.yml").write_text(
                yaml.dump({
                    "lesson_uid": uid,
                    "version_id": version,
                    "title": entry["title"],
                    "catalog_slot": entry["catalog_slot"],
                    # ⛔ 不寫 drive_file_id：這個 repo 是 public，而那個 id 未認證
                    #    就下載得到完整原稿。id 住在 private/curriculum-source/_drive-ids.json。
                    "source": {
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
    ap.add_argument("--module", action="append", choices=MODULES,
                    help="只重建指定 module，可重複（預設全部）。"
                         "其餘檔案（body / sections / metadata / key_reading / 封面）永不觸碰")
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
        r = build_one(e, docx, a.version, a.python, tuple(a.module) if a.module else MODULES)
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
