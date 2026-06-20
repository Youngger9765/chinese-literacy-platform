#!/usr/bin/env python3
"""
Re-bind null figure.asset fields in catalog spotlight YAML from local asset dirs.

Source assets: private/curriculum-source/_online-schema/assets/<lesson_id>/
Target YAML: backend/data/lessons/spotlight/catalog/<lesson_id>.spotlight.yml
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CATALOG_DIR = ROOT / "backend/data/lessons/spotlight/catalog"
ASSETS_ROOT = ROOT / "private/curriculum-source/_online-schema/assets"
MANIFEST = CATALOG_DIR / "manifest.json"


def assets_from_dir(asset_dir: Path) -> list[dict]:
    assets: list[dict] = []
    for p in sorted(asset_dir.glob("fig*")):
        if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
            assets.append({"filename": p.name, "type": "image"})
    for p in sorted(asset_dir.glob("table*.json")):
        assets.append({"filename": p.name, "type": "data_table"})
    return assets


def rebind_figures(blocks: list[dict], assets: list[dict]) -> tuple[list[dict], int]:
    image_names = [a["filename"] for a in assets if a.get("type") != "data_table"]
    table_names = [a["filename"] for a in assets if a.get("type") == "data_table"]
    img_i = tbl_i = 0
    bound = 0
    for b in blocks:
        if b.get("type") != "figure":
            continue
        if b.get("asset"):
            continue
        referent = b.get("referent") or "image"
        if referent == "table" and tbl_i < len(table_names):
            b["asset"] = table_names[tbl_i]
            tbl_i += 1
            bound += 1
        elif img_i < len(image_names):
            b["asset"] = image_names[img_i]
            img_i += 1
            bound += 1
    return blocks, bound


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    lessons = json.loads(MANIFEST.read_text(encoding="utf-8")).get("lessons") or []
    total_bound = 0
    touched = 0

    for lesson_id in lessons:
        asset_dir = ASSETS_ROOT / lesson_id
        yml_path = CATALOG_DIR / f"{lesson_id}.spotlight.yml"
        if not asset_dir.exists() or not yml_path.exists():
            continue
        assets = assets_from_dir(asset_dir)
        if not assets:
            continue

        data = yaml.safe_load(yml_path.read_text(encoding="utf-8"))
        sp = data.get("spotlight") or {}
        blocks = sp.get("blocks") or []
        blocks, n = rebind_figures(blocks, assets)
        if n == 0:
            continue
        touched += 1
        total_bound += n
        if not dry_run:
            sp["blocks"] = blocks
            data["spotlight"] = sp
            yml_path.write_text(
                yaml.dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False),
                encoding="utf-8",
            )
        print(f"{'dry ' if dry_run else ''}bind {lesson_id}: +{n} assets")

    print(f"\n{'would bind' if dry_run else 'bound'} {total_bound} figure slots across {touched} lessons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
