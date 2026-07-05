#!/usr/bin/env python3
"""lint_prompt_overfit.py — anti-overfit guard for the AI lesson-extraction route.

The deterministic #2205 pipeline had an overfit lint that scanned *detector code*
for hard-coded lesson ids. The AI route has no detector code — the "detector" is a
prompt (`.claude/skills/ai-lesson-extract/SKILL.md` + any few-shot files). The
equivalent failure is a prompt that *memorizes a specific lesson's answers* so the
model "looks accurate" without actually reading/reasoning.

So this lint fails (exit 1) when a produced lesson's **answer strings** appear
verbatim in the prompt/skill text — that is answer leakage, the real overfit signal.
Lesson *codes* in the prompt are only a soft WARNING (the skill legitimately uses one
code as a URL/naming example).

Usage:
    python3 scripts/lint_prompt_overfit.py
    python3 scripts/lint_prompt_overfit.py --skill <path> --lessons-dir <dir>
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SKILL = REPO / ".claude" / "skills" / "ai-lesson-extract" / "SKILL.md"
DEFAULT_LESSONS = REPO / "backend" / "data" / "lessons" / "_ai_lessons"

LESSON_CODE_RE = re.compile(r"(?:G\d+-L\d+|文-L\d+|WW-L\d+)")
# Ignore trivially-short answers. A short connective/function word (然後/只要/就)
# is legitimately common prose AND may be an answer — matching it is noise, not a
# leak. A DISTINCTIVE answer is >= 4 chars (or we fail on a BULK leak of >= 3
# shorter ones, which signals a pasted answer key rather than coincidence).
MIN_ANSWER_LEN = 2            # collect anything >= 2 …
DISTINCTIVE_LEN = 4          # … but only >= this counts as a hard single-leak
BULK_LEAK_THRESHOLD = 3      # or this many short leaks together = pasted key


def _collect_answer_strings(node: object, out: set[str]) -> None:
    """Recursively gather human-meaningful ANSWER strings from a lesson dict.

    We only treat values under `answer` / `reference_answer` keys as answers.
    Question content (options, prompts, sentence, vocab_bank) is intentionally NOT
    collected — those are allowed to be discussed in the prompt."""
    if isinstance(node, dict):
        for key, val in node.items():
            if key in ("answer", "reference_answer"):
                _emit_answer_value(val, out)
            # keypoints blanks carry their own `answer`; recurse to reach them.
            _collect_answer_strings(val, out)
    elif isinstance(node, list):
        for item in node:
            _collect_answer_strings(item, out)


def _emit_answer_value(val: object, out: set[str]) -> None:
    if isinstance(val, str):
        s = val.strip()
        if len(s) >= MIN_ANSWER_LEN:
            out.add(s)
    elif isinstance(val, list):
        for v in val:
            _emit_answer_value(v, out)
    elif isinstance(val, dict):
        for v in val.values():
            _emit_answer_value(v, out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill", default=str(DEFAULT_SKILL))
    ap.add_argument("--lessons-dir", default=str(DEFAULT_LESSONS))
    args = ap.parse_args()

    skill_path = Path(args.skill)
    if not skill_path.exists():
        print(f"lint_prompt_overfit: skill file not found: {skill_path}")
        return 0  # nothing to lint yet — not a failure

    # Scan the skill file plus any sibling few-shot / example files in its dir.
    prompt_files = [skill_path]
    prompt_files += [
        p
        for p in skill_path.parent.rglob("*")
        if p.is_file() and p != skill_path and p.suffix in (".md", ".txt", ".yml", ".yaml", ".json")
    ]
    prompt_text = "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in prompt_files)

    lessons_dir = Path(args.lessons_dir)
    lesson_files = sorted(lessons_dir.glob("*.lesson.yml")) if lessons_dir.exists() else []

    # Gather every answer string across all produced lessons.
    answers: set[str] = set()
    for lf in lesson_files:
        try:
            data = yaml.safe_load(lf.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"lint_prompt_overfit: WARN could not parse {lf.name}: {e}")
            continue
        _collect_answer_strings(data, answers)

    # Which produced answers appear verbatim in the prompt?
    leaks = sorted(a for a in answers if a in prompt_text)
    distinctive = [a for a in leaks if len(a) >= DISTINCTIVE_LEN]
    short = [a for a in leaks if len(a) < DISTINCTIVE_LEN]
    # SOFT WARN: specific lesson codes present in the prompt.
    codes = sorted(set(LESSON_CODE_RE.findall(prompt_text)))

    print(f"lint_prompt_overfit: scanned {len(prompt_files)} prompt file(s), "
          f"{len(lesson_files)} lesson(s), {len(answers)} answer string(s).")
    if codes:
        print(f"  (soft) lesson codes referenced in prompt (OK as examples): {codes}")
    if short:
        print(f"  (soft) short/common answer words also present as prose (ignored): {short}")

    # HARD FAIL: a distinctive answer leaked, OR a bulk of short ones (pasted key).
    hard = distinctive if distinctive else (short if len(short) >= BULK_LEAK_THRESHOLD else [])
    if hard:
        print("\n✗ OVERFIT LEAK — these produced answers appear verbatim in the prompt:")
        for a in hard:
            print(f"    - {a!r}")
        print("\nThe prompt must teach HOW to judge, not memorize a lesson's answers.")
        print("Move any answer-specific text out of the skill/few-shot files.")
        return 1

    print("✓ ADAPTER_OVERFIT_PASS — no distinctive answer strings leak into the prompt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
