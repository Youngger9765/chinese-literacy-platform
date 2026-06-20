#!/usr/bin/env python3
"""CLI wrapper — re-exports backend spotlight_contract for scripts/."""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services.spotlight_contract import (  # noqa: E402
    DEV7_DIR,
    DEV7_LESSONS,
    TEST15_LESSONS,
    TEST15_GOLD_MANIFEST,
    compare_to_gold,
    eval_spotlight_v2,
    fingerprint_spotlight,
    load_dev7_spotlight,
    load_test15_spotlight,
    load_gold_manifest,
    load_spotlight_yaml,
    validate_block_structure,
)

if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Spotlight v2 dev7 contract eval")
    parser.add_argument("--dev7", action="store_true", help="Eval all dev7 gold fixtures")
    parser.add_argument("--test15", action="store_true", help="Eval all test15 held-out fixtures")
    args = parser.parse_args()

    if not args.dev7 and not args.test15:
        parser.print_help()
        sys.exit(2)


    if args.test15:
        manifest = json.loads(TEST15_GOLD_MANIFEST.read_text(encoding="utf-8"))
        failed = []
        for lesson_id in TEST15_LESSONS:
            sp = load_test15_spotlight(lesson_id)
            ev = eval_spotlight_v2(sp, lesson_id)
            gold_cmp = compare_to_gold(lesson_id, sp, manifest["lessons"][lesson_id])
            ok = ev["pass"] and gold_cmp["match"]
            status = "PASS" if ok else "FAIL"
            print(f"{lesson_id}: {status} guides={ev['guide_count']} blocks={ev['block_count']}")
            if not ok:
                failed.append(lesson_id)
        if failed:
            print(f"\nFAILED: {', '.join(failed)}")
            sys.exit(1)
        print(f"\nAll {len(TEST15_LESSONS)} test15 lessons PASS")
        sys.exit(0)


    manifest = load_gold_manifest()
    failed = []
    for lesson_id in DEV7_LESSONS:
        sp = load_dev7_spotlight(lesson_id)
        ev = eval_spotlight_v2(sp, lesson_id)
        gold_cmp = compare_to_gold(lesson_id, sp, manifest["lessons"][lesson_id])
        ok = ev["pass"] and gold_cmp["match"]
        status = "PASS" if ok else "FAIL"
        print(f"{lesson_id}: {status} guides={ev['guide_count']} blocks={ev['block_count']} singles={ev.get('semantic', {}).get('single_count', '-')}")
        if not ev["pass"]:
            print(f"  eval: {json.dumps(ev, ensure_ascii=False)}")
        if not gold_cmp["match"]:
            print(f"  gold diff: {json.dumps(gold_cmp['diffs'], ensure_ascii=False)}")
        if not ok:
            failed.append(lesson_id)

    if failed:
        print(f"\nFAILED: {', '.join(failed)}")
        sys.exit(1)
    print(f"\nAll {len(DEV7_LESSONS)} dev7 lessons PASS")
    sys.exit(0)
