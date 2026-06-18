"""Parse fill_blank / checkbox markers from story structure table cells."""

from __future__ import annotations

import re

_BLANK_RE = re.compile(r"【([^】]*)】")
_CIRCLED_NUM_RE = re.compile(r"[①②③④⑤⑥⑦⑧⑨⑩]")


def fill_blanks_in_text(text: str, blanks: list[dict]) -> str:
    """Replace ``__`` placeholders with ``【 answer 】`` using a blanks list."""
    out = text or ""
    for blank in blanks:
        answer = str(blank.get("answer", "")).strip()
        if "__" in out:
            out = out.replace("__", f"【 {answer} 】", 1)
        elif answer:
            out = f"{out}【 {answer} 】"
    return out


def parse_checkbox_options(text: str) -> dict | None:
    """Parse □-marked numbered options (□ = distractor)."""
    if "□" not in text or not _CIRCLED_NUM_RE.search(text):
        return None

    markers = list(_CIRCLED_NUM_RE.finditer(text))
    if not markers:
        return None

    options: list[str] = []
    correct_options: list[int] = []
    for i, match in enumerate(markers):
        start = match.start()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(text)
        chunk = text[start:end].strip()
        prefix = text[max(0, start - 1) : start + 1]
        is_distractor = "□" in prefix or chunk.startswith("□")
        clean = _CIRCLED_NUM_RE.sub("", chunk, count=1).lstrip("□").strip()
        if not clean:
            continue
        idx = len(options)
        options.append(clean)
        if not is_distractor:
            correct_options.append(idx)

    if not options:
        return None
    return {"options": options, "correct_options": correct_options}


def extract_blank_answers(text: str) -> list[str]:
    return [m.group(1).strip() for m in _BLANK_RE.finditer(text)]


def cell_to_structure_fields(label: str, value: str) -> dict:
    """Build a grading-friendly structure row from raw label + value strings."""
    label_s = label.strip()
    value_s = value.strip()

    for source in (value_s, label_s):
        checkbox = parse_checkbox_options(source)
        if checkbox:
            return {
                "label": label_s,
                "value": value_s,
                "interactive_type": "checkbox",
                "options": checkbox["options"],
                "correct_options": checkbox["correct_options"],
            }

    value_fb = bool(_BLANK_RE.search(value_s))
    label_fb = bool(_BLANK_RE.search(label_s))

    if value_fb:
        answers = extract_blank_answers(value_s)
        row: dict = {
            "label": label_s,
            "value": value_s,
            "interactive_type": "fill_blank",
        }
        if answers:
            row["hint"] = answers[0]
        if len(answers) > 1:
            row["blank_hints"] = answers
        return row

    if label_fb:
        answers = extract_blank_answers(label_s)
        row = {
            "label": label_s,
            "value": value_s,
            "interactive_type": "fill_blank",
            "blank_in_label": True,
        }
        if answers:
            row["hint"] = answers[0]
        if len(answers) > 1:
            row["blank_hints"] = answers
        return row

    return {
        "label": label_s,
        "value": value_s,
        "interactive_type": "display",
    }
