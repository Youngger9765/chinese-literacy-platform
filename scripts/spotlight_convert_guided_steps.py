#!/usr/bin/env python
"""Convert a lesson's rich legacy strategy_exercise (guided_steps) into the
spotlight_v2 block schema, recovering questions that the DOCX extractor dropped
into a thin guide-only spotlight (#2397).

WHY: 14 catalog lessons have a faithful legacy `strategy_exercise` of type
`guided_steps` carrying 4-13 select/open questions, but their spotlight_v2 only
got guide blocks — so the frontend (which prefers spotlight_v2) renders a
question-less spotlight. The content already exists; this is a deterministic
format conversion (no LLM, no DOCX re-parse).

NOT a blanket migration: run per lesson, eyeball the output, render+judge
faithful, run the regression check, then --rebaseline that lesson.

Usage:
  python scripts/spotlight_convert_guided_steps.py G7-L2 [--write]
    (dry-run prints converted blocks; --write updates the catalog yml)
"""
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services.lesson_loader import get_lesson_by_code  # noqa: E402
from app.services.spotlight_contract import validate_block_structure  # noqa: E402

CATALOG_DIR = REPO_ROOT / "backend" / "data" / "lessons" / "spotlight" / "catalog"


def _opt_text(opt) -> str:
    if isinstance(opt, dict):
        return str(opt.get("text") or opt.get("label") or "")
    return str(opt)


def convert_guided_steps(se: dict) -> list[dict]:
    """guided_steps strategy_exercise -> spotlight_v2 blocks."""
    blocks: list[dict] = []
    instruction = (se.get("instruction") or "").strip()
    if instruction:
        blocks.append({"type": "guide", "text": instruction})

    for step in se.get("steps", []) or []:
        prompt = (step.get("prompt") or "").strip()
        if not prompt:
            continue
        options = [_opt_text(o) for o in (step.get("options") or []) if _opt_text(o).strip()]
        stype = (step.get("type") or "").lower()
        if options and len(options) >= 2 and stype in ("select", "single", "mcq", ""):
            ans_idx = step.get("answer")
            answer_text = ""
            if isinstance(ans_idx, int) and 0 <= ans_idx < len(options):
                answer_text = options[ans_idx]
            elif isinstance(ans_idx, str):
                answer_text = ans_idx
            blocks.append({
                "type": "single",
                "prompt": prompt,
                "options": options,
                "answer": answer_text,
            })
        else:
            # open / free-response step
            blk = {"type": "free_text", "prompt": prompt}
            ans = step.get("answer")
            if isinstance(ans, str) and ans.strip():
                blk["answer"] = ans.strip()
            blocks.append(blk)
    return blocks


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    if not args:
        print("usage: spotlight_convert_guided_steps.py <CODE> [--write]", file=sys.stderr)
        return 2
    code = args[0]
    lesson = get_lesson_by_code(code)
    if not lesson:
        print(f"lesson {code} not found", file=sys.stderr)
        return 2
    # Rebinding guard (#2397): the content_mapping_registry can route a lesson to
    # load a DIFFERENTLY-coded spotlight file (title-anchored). If this lesson's
    # effective source != its own code, then writing <code>.spotlight.yml would
    # (a) NOT affect this lesson and (b) corrupt whatever OTHER lesson consumes
    # <code>.yml. e.g. G8-L14 loads G8-L18's file, while G8-L14.yml is consumed by
    # G8-L11 (蝴蝶蘭) — converting G8-L14 here would put 石虎 questions on 蝴蝶蘭.
    from app.services.content_mapping_registry import get_spotlight_source_code
    from app.services.lesson_code_normalization import normalize_manifest_code
    ncode = normalize_manifest_code(code)
    src = get_spotlight_source_code(ncode, lesson.get("title"))
    if src and normalize_manifest_code(src) != ncode:
        print(f"{code}: loads spotlight from '{src}' (registry rebinding) — writing "
              f"{code}.yml would not affect this lesson and may corrupt the lesson "
              f"that consumes {code}.yml. SKIP.", file=sys.stderr)
        return 2

    se = lesson.get("strategy_exercise")
    if not isinstance(se, dict) or se.get("type") != "guided_steps":
        print(f"{code}: legacy strategy_exercise is not guided_steps (type={se.get('type') if isinstance(se,dict) else type(se).__name__}) — skip", file=sys.stderr)
        return 2

    blocks = convert_guided_steps(se)
    errors = validate_block_structure(blocks)
    nq = sum(1 for b in blocks if b.get("type") in ("single", "multi", "free_text"))
    print(f"=== {code}: converted {len(blocks)} blocks ({nq} questions) ===")
    for i, b in enumerate(blocks):
        t = b.get("type")
        body = b.get("text") or b.get("prompt") or ""
        extra = f" [opts={len(b.get('options',[]))}, ans={b.get('answer','')[:12]!r}]" if t == "single" else ""
        print(f"  [{i:02d}] {t}: {body[:70]}{extra}")
    if errors:
        print("\n❌ VALIDATION ERRORS:")
        for e in errors:
            print(f"   {e}")
        return 1
    print("\n✅ block structure valid")

    if write:
        path = CATALOG_DIR / f"{code}.spotlight.yml"
        existing = {}
        if path.exists():
            existing = yaml.safe_load(path.read_text()) or {}
        sp = existing.get("spotlight", {})
        out = {
            "spotlight": {
                "lesson": code,
                "strategy_name": se.get("strategy_name") or sp.get("strategy_name") or "",
                "strategy_type": sp.get("strategy_type") or "guided_steps",
                "blocks": blocks,
            }
        }
        path.write_text(yaml.safe_dump(out, allow_unicode=True, sort_keys=False))
        print(f"\n📝 wrote {path}")
    else:
        print("\n(dry-run — pass --write to update the catalog yml)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
