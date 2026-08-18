"""Parse fill_blank / checkbox markers from story structure table cells."""

from __future__ import annotations

import re

_BLANK_RE = re.compile(r"【([^】]*)】")
_PAREN_BLANK_RE = re.compile(r"[（(]\s*([^）)]*?)\s*[）)]")
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
        # chunk 的範圍是「這個圈號到**下一個**圈號」，所以尾巴會吃到下一項的 □。
        # 只 lstrip 會留下它 → 學生看到「積極的面對與復健 □」。
        # ⚠️ 尾巴那個 □ 是下一項的干擾項標記，而下一項是從**原始 text** 讀 prefix
        #    判斷的（見下方 is_distractor），所以在這裡拿掉不影響誰是正解。
        clean = _CIRCLED_NUM_RE.sub("", chunk, count=1).strip(" \u3000□■☑▢").strip()
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


def normalize_paren_blanks_to_brackets(text: str) -> str:
    """Convert （ answer ） / ( answer ) placeholders to 【 answer 】."""
    return _PAREN_BLANK_RE.sub(lambda m: f"【 {m.group(1).strip()} 】", text or "")


def _has_fill_blank_markers(text: str) -> bool:
    return bool(_BLANK_RE.search(text) or _PAREN_BLANK_RE.search(text))


def cell_to_structure_fields(label: str, value: str) -> dict:
    """Build a grading-friendly structure row from raw label + value strings."""
    label_s = normalize_paren_blanks_to_brackets(label.strip())
    value_s = normalize_paren_blanks_to_brackets(value.strip())

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

    value_fb = _has_fill_blank_markers(value_s)
    label_fb = _has_fill_blank_markers(label_s)

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
