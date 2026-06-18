#!/usr/bin/env python3
"""Build spotlight QA manifest for admin dashboard."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.curriculum_qa_spotlight import build_spotlight_manifest  # noqa: E402

OUT = ROOT / "backend/data/curriculum_qa/spotlight_manifest.json"


def main() -> int:
    manifest = build_spotlight_manifest()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    s = manifest["summary"]
    print(f"Wrote {OUT}")
    print(f"  lessons={s['total']} pass={s['pass']} fail={s['fail']}")
    return 0 if s["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
