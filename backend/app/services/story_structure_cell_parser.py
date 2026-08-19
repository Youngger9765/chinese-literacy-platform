"""Parse fill_blank / checkbox markers from story structure table cells."""

from __future__ import annotations

import re

_BLANK_RE = re.compile(r"【([^】]*)】")
_PAREN_BLANK_RE = re.compile(r"[（(]\s*([^）)]*?)\s*[）)]")
_CIRCLED_NUM_RE = re.compile(r"[①②③④⑤⑥⑦⑧⑨⑩]")

# 一句話裡兩個以上空格、各自配一組選項時，`keypoints_to_structure.py` 的
# `_sentence_with_inline_choices` 會在句子後面接上這種標籤行——
# 「第一個空格：□①贏了 ②輸了」。這裡只認這一行的格式，不動句子本身。
_INLINE_SLOT_LINE_RE = re.compile(r"第[一二三四五六七八九十\d]+個空格[：:]\s*(.+)")

# 學習單把「這題怎麼作答」寫在跟空格同一種括號裡：`（單選，請打勾）`、
# `（多選，請打勾）`。checkbox 目前不分單選/多選、一律可複選 —— 指示語寫
# 「單選」的欄位，畫面上照樣能勾出兩個以上（#2776）。
_SINGLE_SELECT_WORDS = ("單選",)
_MULTI_SELECT_WORDS = ("多選", "複選")

# 同一種括號裝了兩種完全不同的東西——答案（【上升】）和作答指示
# （【單選，請打勾】）。任何要「數真空格數」的地方都要先排除指示語，
# 否則指示語本身會被算成一格空格（跟前端 `isInstructionBlank` 同一道理）。
_INSTRUCTION_WORDS = ("單選", "多選", "複選", "勾選", "打勾")


def _count_real_blanks(text: str) -> int:
    return sum(
        1 for m in _BLANK_RE.finditer(text)
        if not any(w in m.group(1) for w in _INSTRUCTION_WORDS)
    )


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
        # chunk 也會吃到下一行開頭的引導字（「第二個空格：」）——
        # 那是**行內選擇**的群組標籤，不是這個選項的內容。
        # 不切的話學生看到的選項是「輸了\n第二個空格：」。
        # 換行之後若還有文字但沒有圈號，那段屬於下一組，不屬於這一項。
        chunk = chunk.split("\n")[0]
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


def parse_inline_choice_groups(text: str) -> list[dict] | None:
    """Parse one "第N個空格：①A ②B" line per sentence blank into its own
    small option set.

    A sentence can carry two or more blanks that each have their own tiny
    choice list (see `keypoints_to_structure._sentence_with_inline_choices`).
    The generic `parse_checkbox_options` scans the WHOLE text for circled
    numbers, so it flattens both groups into one option list and throws the
    sentence away in the process — the student sees four bare checkboxes
    with no idea which two go together, or that a sentence existed at all
    (#2776, L0011 "結果" / L0102 "對網紅實驗的批判", 2 lessons).

    Requires >= 2 matching lines — a single "第一個空格" line with no sibling
    means there is only one blank, which `parse_checkbox_options` already
    handles correctly as an ordinary checkbox.
    """
    groups: list[dict] = []
    for line in text.splitlines():
        m = _INLINE_SLOT_LINE_RE.match(line.strip())
        if not m:
            continue
        parsed = parse_checkbox_options(m.group(1))
        if parsed:
            groups.append(parsed)
    return groups if len(groups) >= 2 else None


def strip_inline_slot_lines(text: str) -> str:
    """Remove the "第N個空格：…" caption lines, keeping the sentence itself.

    Each blank gets its own inline picker rendered right where the blank
    already is (see `StoryStructureTable.tsx` InlineChoiceContent) — repeating
    the same choices as a trailing caption line is redundant once that picker
    exists, and it was what got flattened into one checkbox list before.
    """
    kept = [
        line for line in text.splitlines()
        if not _INLINE_SLOT_LINE_RE.match(line.strip())
    ]
    return "\n".join(kept).strip()


def detect_select_mode(text: str) -> str | None:
    """"單選" → exactly one option may be selected; "多選"/"複選" → several may.

    Returns None when the instruction doesn't say either way (older
    AI-generated rows never did) — the frontend keeps today's unconstrained
    multi-select behavior when this is absent, so leaving it unset is a
    no-op, not a silent downgrade.
    """
    if any(w in text for w in _SINGLE_SELECT_WORDS) and not any(
        w in text for w in _MULTI_SELECT_WORDS
    ):
        return "single"
    if any(w in text for w in _MULTI_SELECT_WORDS):
        return "multi"
    return None


def extract_blank_answers(text: str) -> list[str]:
    return [m.group(1).strip() for m in _BLANK_RE.finditer(text)]


_LIST_ORDINAL_RE = re.compile(r"^\d{1,2}$")


def normalize_paren_blanks_to_brackets(text: str) -> str:
    """Convert （ answer ） / ( answer ) placeholders to 【 answer 】.

    ⚠️ `(1)` / `(2)` section numbering must NOT be swept up here. The teaching
    material uses the same paren style for both "this is a list item" and
    "this is a blank" — a bare 1-2 digit number in parens is always the
    former (a real fill-blank answer is never just "1"). Left unguarded,
    every numbered sub-question ("(1)棉花肺實驗的問題", "(2)煙油食材實驗的問題")
    turned into a phantom pre-filled blank the student never asked for
    (#2776, 25 課 / 93 處 — found while chasing a different bug, fixed here
    because it blocked correctly detecting L0102's inline-choice sentence).
    """
    def _convert(m: re.Match) -> str:
        inner = m.group(1).strip()
        if _LIST_ORDINAL_RE.match(inner):
            return m.group(0)
        return f"【 {inner} 】"

    return _PAREN_BLANK_RE.sub(_convert, text or "")


def _has_fill_blank_markers(text: str) -> bool:
    return bool(_BLANK_RE.search(text) or _PAREN_BLANK_RE.search(text))


def cell_to_structure_fields(label: str, value: str) -> dict:
    """Build a grading-friendly structure row from raw label + value strings."""
    label_s = normalize_paren_blanks_to_brackets(label.strip())
    value_s = normalize_paren_blanks_to_brackets(value.strip())

    # ⚠️ Must run BEFORE the generic checkbox scan below — that scan is
    # global-per-text and would swallow both blanks' option groups into one
    # flat list (see `parse_inline_choice_groups` docstring). Only `value_s`
    # is checked: the sentence carrying the blanks is always the cell value,
    # never the (short) label.
    inline_groups = parse_inline_choice_groups(value_s)
    if inline_groups:
        sentence = strip_inline_slot_lines(value_s)
        if _count_real_blanks(sentence) == len(inline_groups):
            blanks = [
                {
                    "options": g["options"],
                    "correct_option": g["correct_options"][0] if g["correct_options"] else 0,
                }
                for g in inline_groups
            ]
            return {
                "label": label_s,
                "value": sentence,
                "interactive_type": "inline_choice",
                "blanks": blanks,
            }
        # Blank count doesn't line up with group count — our shape
        # assumption doesn't hold for this cell. Fall through to the
        # generic paths rather than guess a wrong pairing.

    for source in (value_s, label_s):
        checkbox = parse_checkbox_options(source)
        if checkbox:
            row: dict = {
                "label": label_s,
                "value": value_s,
                "interactive_type": "checkbox",
                "options": checkbox["options"],
                "correct_options": checkbox["correct_options"],
            }
            select_mode = detect_select_mode(source)
            if select_mode:
                row["select_mode"] = select_mode
            return row

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
