#!/usr/bin/env python3
"""extract_lesson_sections.py — the remaining worksheet sections (#2683).

The pipeline emitted two of the worksheet's nine sections (聚光燈, 重點表), and a third
was added for the body text. This covers four more — 語詞定義, 語詞應用, 閱讀理解,
知識補給站 — the material behind the learning steps that currently render empty.

EVERY SECTION CARRIES ITS OWN CHECK
-----------------------------------
Extracting wrongly is worse than not extracting: a student would be shown another
lesson's questions, or an answer that is not among the options. So each section is
verified before it is written, and the plan for how was written first —
`docs/qa/2026-08-16-remaining-sections-qa-plan.md`.

Checks are ranked by what they can actually catch:

  A — cross-validation against a DIFFERENT section of the same document. The two were
      authored separately, so a boundary error breaks the agreement. Only this kind
      catches "extracted the wrong lesson's content".
  B — a structural invariant inside the section (the answer letter is among the
      options; every option word belongs to this lesson).
  C — presence. Catches "extracted nothing", nothing more.

A section whose only check is C is written with `needs_human_review: true` rather than
presented as verified. 知識補給站 is the one such case — a video title has no
machine-checkable relationship to the lesson text.

課程簡介 is deliberately absent: the DOCX has no such section, and using the first body
paragraph would turn "introduction" into "the lesson, again".
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extract_lesson_body import _paragraphs, normalise  # noqa: E402

# Section headings in document order. A heading appears 2-3 times (index column,
# running header, body), so positions are taken as first-occurrence.
SECTION_ORDER = [
    "讀全文", "念順順", "語詞我最棒", "語詞應用",
    "文章重點表", "閱讀聚光燈", "閱讀理解", "詞語複習", "知識補給站",
]

_VOCAB_DEF = re.compile(r"^[(（]\s*(\d+)\s*[)）]\s*(.+?)\s*[：:]\s*(.+)$")
_OPTION = re.compile(r"^([A-Z])\s*[.、．]\s*(.+)$")
_CLOZE = re.compile(r"^[(（]\s*(\d+)\s*[)）](.*?)[(（]\s*([A-Z])\s*[)）](.*)$")

# Not anchored at ^: Word merges the section heading into the same <w:p> as the first
# question, so the section's first line reads 「七閱讀理解（ A ）1. 下列⋯」. An anchored
# pattern silently lost that question — one in five, per lesson.
_MCQ_STEM = re.compile(r"[（(]\s*([A-Z])\s*[）)]\s*(\d+)\s*[.、．]\s*(.+)")
# Some questions print all four options on one line.
# Two or more options printed on one line. The lookahead required TWO spaces before
# the next letter; L0018 separates them with one, so option A failed to match at all,
# fell through to the single-option pattern, and swallowed 「B.其中一個重要部分」 as
# part of its own text — leaving the answer B with no option and the question withheld.
# One space is enough, provided the letter is followed by an option delimiter.
_INLINE_OPTIONS = re.compile(r"([A-Z])\s*[.、．]\s*([^A-Z\n]{1,40}?)(?=\s+[A-Z]\s*[.、．]|$)")
# A wholly parenthesised line standing where an option should be: in the TEACHER
# edition the correct option is overwritten by the answer rationale.
_RATIONALE = re.compile(r"^[（(].+[）)]$")

_VIDEO = re.compile(r"^(\d+)\s*[.、．]\s*(.+)$")
_DURATION = re.compile(r"片長[：:]\s*[(（]?(\d+):(\d{2})")
_SOURCE = re.compile(r"來源[：:]\s*(.+)")


def section_bounds(paras: list[str]) -> dict[str, tuple[int, int]]:
    """First index of each section heading → (start, end-of-section)."""
    pos: dict[str, int] = {}
    for i, t in enumerate(paras):
        for name in SECTION_ORDER:
            if name not in pos and (t == name or t.endswith(name)):
                pos[name] = i
    ordered = sorted(pos.items(), key=lambda kv: kv[1])
    out = {}
    for n, (name, start) in enumerate(ordered):
        end = ordered[n + 1][1] if n + 1 < len(ordered) else len(paras)
        out[name] = (start, end)
    return out


def _slice(paras: list[str], bounds, name: str) -> list[str]:
    if name not in bounds:
        return []
    a, b = bounds[name]
    return [t for t in paras[a:b] if t]


# ── 三 語詞我最棒 ───────────────────────────────────────────────────────────

def extract_vocab_definitions(paras, bounds, lesson_vocab: list[str]) -> dict:
    rows = []
    for t in _slice(paras, bounds, "語詞我最棒"):
        m = _VOCAB_DEF.match(t)
        if m:
            rows.append({"index": int(m.group(1)),
                         "word": m.group(2).strip(),
                         "definition": m.group(3).strip()})
    if not rows:
        return {"items": [], "check": {"verdict": "empty"}}

    # A: every word defined here must be one of THIS lesson's words, which the
    # worksheet lists separately under 本課語詞. A definition list lifted from another
    # lesson fails this; that is the failure worth gating on.
    #
    # The gate used to run the other way — 本課語詞 must all be defined — and it was
    # measuring the worksheet's design rather than the extraction's correctness. The
    # 語詞我最棒 section does not define every word in the bank, by design, so the
    # ratio sat at 0.91 with 36 lessons below the line and their definitions perfectly
    # correct. Defined-belongs-to-lesson sits at 0.98 with 3 below. Both directions are
    # recorded; only this one decides.
    want = {normalise(w) for w in lesson_vocab}
    got = [normalise(r["word"]) for r in rows]
    belongs = (sum(1 for g in got if any(g in w or w in g for w in want)) / len(got)
               if got and want else None)
    covered = (sum(1 for w in want if any(g in w or w in g for g in got)) / len(want)
               if want else None)

    no_def = [r["word"] for r in rows if not r["definition"]]
    indices = [r["index"] for r in rows]
    contiguous = indices == list(range(1, len(indices) + 1))

    verdict = "ok"
    if belongs is not None and belongs < 0.8:
        verdict = "mismatch"
    elif no_def or not contiguous:
        verdict = "weak"
    return {
        "items": rows,
        "check": {
            "defined_words_belong_to_lesson": round(belongs, 2) if belongs is not None else None,
            # Recorded, not gated: how much of the word bank carries a definition.
            "vocabulary_bank_covered": round(covered, 2) if covered is not None else None,
            "missing_definitions": no_def,
            "indices_contiguous": contiguous,
            "verdict": verdict,
        },
    }


# ── 四 語詞應用 ─────────────────────────────────────────────────────────────

def extract_vocab_application(paras, bounds, lesson_vocab: list[str]) -> dict:
    options, questions = {}, []
    for t in _slice(paras, bounds, "語詞應用"):
        m = _OPTION.match(t)
        if m and len(m.group(2)) <= 12:
            options[m.group(1)] = m.group(2).strip()
            continue
        q = _CLOZE.match(t)
        if q:
            questions.append({
                "index": int(q.group(1)),
                "text": (q.group(2) + "（　）" + q.group(4)).strip(),
                "answer": q.group(3),
            })
    if not (options and questions):
        return {"options": {}, "questions": [], "check": {"verdict": "empty"}}

    want = {normalise(w) for w in lesson_vocab}
    foreign = [v for v in options.values() if want and normalise(v) not in want]  # A
    dangling = [q["index"] for q in questions if q["answer"] not in options]      # B

    verdict = "ok"
    if dangling or (want and len(foreign) > len(options) * 0.2):
        verdict = "mismatch"
    return {
        "options": options,
        "questions": questions,
        "check": {
            "options_not_in_lesson_vocabulary": foreign,
            "answers_without_option": dangling,
            "verdict": verdict,
        },
    }


# ── 七 閱讀理解 ─────────────────────────────────────────────────────────────

def extract_comprehension(paras, bounds, body_text: str) -> dict:
    """Multiple choice, from the TEACHER edition — which has two shapes a naive
    reader gets wrong.

    The correct option is often overwritten by the answer rationale: where a student
    sheet reads B followed by a distractor, the teacher sheet has a parenthesised
    explanation in its place. The letter is gone. Reading that as a missing option
    marked 138 of 175 lessons broken when the extraction was right. Such a line is
    attached as the answer's option with `is_rationale` set, so a renderer can tell
    it from a real distractor.

    And some questions print all four options on one line.
    """
    questions: list[dict] = []
    current: Optional[dict] = None
    seen: set[str] = set()

    for t in _slice(paras, bounds, "閱讀理解"):
        stem = _MCQ_STEM.search(t)
        if stem:
            if current:
                questions.append(current)
            current = {"index": int(stem.group(2)), "answer": stem.group(1),
                       "stem": stem.group(3).strip(), "options": {}, "rationale": None}
            seen.clear()
            continue
        if current is None:
            continue
        key = normalise(t)                 # Word repeats lines when a table repeats
        if key in seen:
            continue
        seen.add(key)

        inline = _INLINE_OPTIONS.findall(t)
        if len(inline) >= 2:
            for letter, text in inline:
                current["options"][letter] = text.strip()
            continue
        one = _OPTION.match(t)
        if one:
            current["options"][one.group(1)] = one.group(2).strip()
            continue
        # An unlabelled line sitting among the options is the rationale that replaced
        # the correct one. Sometimes it is parenthesised, sometimes not — L0007's
        # reads as a plain sentence — so what identifies it is its POSITION (inside a
        # question, not matching an option pattern) plus prose length, not brackets.
        if current["rationale"] is None and len(t) >= 12:
            current["rationale"] = t.strip("（()）").strip()

    if current:
        questions.append(current)
    if not questions:
        return {"questions": [], "check": {"verdict": "empty"}}

    for q in questions:
        if q["answer"] not in q["options"] and q["rationale"]:
            q["options"][q["answer"]] = q["rationale"]
            q["is_rationale"] = True

    dangling = [q["index"] for q in questions if q["answer"] not in q["options"]]
    thin = [q["index"] for q in questions if len(q["options"]) < 3]

    # A: does each question mention anything from its own lesson?
    #
    # NOT "what fraction of the stem appears in the text" — a stem is mostly question
    # language, which by nature is absent from the passage. Scoring that ratio put 102
    # lessons at ~0.0 whose questions were plainly about the right lesson (L0009 asks
    # about the hunter and the dog, both in its first paragraph). So this is a
    # per-question floor: at least one 2-gram of the stem occurs in the body. The
    # verdict then looks at the SHARE of questions that ground, because a wholly
    # generic stem legitimately grounds nowhere.
    hay = normalise(body_text)

    def grounds(stem: str) -> bool:
        flat = normalise(stem)
        return any(flat[i:i + 2] in hay for i in range(len(flat) - 1))

    grounded = (
        sum(1 for q in questions if grounds(q["stem"])) / len(questions)
        if body_text else None
    )

    # What gates, and what does not.
    #
    # `dangling` gates: an answer letter with no option is a broken question whichever
    # lesson it came from, and it is the shape the teacher-edition overwrite produces
    # when the rationale is not recovered.
    #
    # Grounding does NOT gate, and the 0.5 threshold it used to carry was removing
    # correct work. Comprehension stems are largely question language — 「下列選項何者
    #使用正確？」, 「這個故事主要想告訴讀者什麼道理？」 — and a worksheet whose five
    # questions are all phrased that way grounds nowhere while being entirely about its
    # own lesson (L0017 and L0021, both checked by hand). Across 166 lessons the measure
    # never falls below 0.3, so a threshold above that removes correct lessons and one
    # below it fires never; either way it is not discriminating and should not decide.
    #
    # That leaves comprehension without a working A-check. Two candidates were measured
    # and rejected rather than assumed:
    #   · quoted spans in the stem appearing in the body — 97 of 164 quotes do not,
    #     because worksheets paraphrase and quote from other sections
    #   · a 4-gram floor — 24 lessons score zero with correct extractions, same cause
    # So the section is written with `grounding_is_not_a_gate` recorded, and its checks
    # are structural. Saying so is better than a threshold that looks like verification.
    verdict = "ok"
    if dangling:
        verdict = "mismatch"
    elif thin:
        verdict = "weak"
    return {
        "questions": questions,
        "check": {
            "answers_without_option": dangling,
            "questions_with_few_options": thin,
            "questions_grounded_in_body": round(grounded, 2) if grounded is not None else None,
            "answers_recovered_from_rationale": sum(1 for q in questions if q.get("is_rationale")),
            "verdict": verdict,
        },
    }


# ── 九 知識補給站 ───────────────────────────────────────────────────────────

def extract_resources(paras, bounds) -> dict:
    items: list[dict] = []
    for t in _slice(paras, bounds, "知識補給站"):
        m = _VIDEO.match(t)
        if m and len(m.group(2)) > 6:
            items.append({"index": int(m.group(1)), "title": m.group(2).strip()})
            continue
        if not items:
            continue
        d = _DURATION.search(t)
        if d:
            items[-1]["duration_seconds"] = int(d.group(1)) * 60 + int(d.group(2))
            continue
        s = _SOURCE.search(t)
        if s:
            items[-1]["source"] = s.group(1).strip()
    if not items:
        return {"items": [], "check": {"verdict": "empty"}}

    # Keep only the run of strictly increasing indices that starts the section. A
    # numbered line is not evidence of a video, and 知識補給站 sits last in the
    # document, so when its bounds run long every numbered list after it is swept in:
    # L0029 collected 24 「videos」, of which 3 were videos and the rest were exercise
    # items whose numbering restarted at 1. An index that does not advance is a
    # different list.
    kept = []
    for it in items:
        if kept and it["index"] <= kept[-1]["index"]:
            break
        kept.append(it)
    items = kept

    # A count agreement, which is a check rather than a claim: the worksheet lists the
    # videos and the master spreadsheet holds their URLs, written separately. Where the
    # two counts match, the section is corroborated; where they do not, one source is
    # stale and this says so instead of implying the pairing was verified. Titles still
    # have no machine-checkable relation to the lesson, so this never rises above B.
    return {
        "items": items,
        "check": {"verdict": "unverified", "needs_human_review": True,
                  "video_count": len(items)},
    }


def extract_all(docx: Path, lesson_vocab: list[str], body_text: str) -> dict:
    paras = _paragraphs(docx)
    bounds = section_bounds(paras)
    return {
        "vocab_definitions": extract_vocab_definitions(paras, bounds, lesson_vocab),
        "vocab_application": extract_vocab_application(paras, bounds, lesson_vocab),
        "comprehension": extract_comprehension(paras, bounds, body_text),
        "resources": extract_resources(paras, bounds),
    }


def main() -> int:
    from extract_lesson_body import extract as extract_body, extract_vocabulary

    ap = argparse.ArgumentParser()
    ap.add_argument("docx", nargs="+")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    tally: dict[str, dict[str, int]] = {}
    for f in a.docx:
        path = Path(f)
        paras = _paragraphs(path)
        body = extract_body(path)
        result = extract_all(
            path,
            extract_vocabulary(paras, body.get("paragraphs") or []),
            "".join(body.get("paragraphs") or []),
        )
        if not a.quiet:
            print(f"  {path.stem}")
        for name, data in result.items():
            v = data["check"]["verdict"]
            tally.setdefault(name, {}).setdefault(v, 0)
            tally[name][v] += 1
            if not a.quiet:
                n = len(data.get("items") or data.get("questions") or [])
                print(f"     {name:20s} {v:11s} {n} 筆")

    print()
    for name, counts in tally.items():
        print(f"  {name:20s} {dict(sorted(counts.items()))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
