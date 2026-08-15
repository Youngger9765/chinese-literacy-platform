"""keypoints_to_structure.py — 重點表 source bridge for the uid tree (#2683).

WHY THIS EXISTS
---------------
The 重點表 step calls ``/stories/{id}/structure``, which serves the teacher-authored
table from ``story["story_structure_table"]`` — a raw list-of-lists produced by the
first edition's ``_parsed_2026-05-01`` parser. Fall through that and the endpoint
asks an LLM to invent a table instead, which is both a cost and a fidelity loss: the
whole point of the extracted table is that it is what the teacher actually wrote.

The second-edition pipeline emits ``keypoints.yml`` per lesson, already parsed into
``{columns, rows[{label, value|sub_rows, blanks}], structure, title}``. So the uid
tree has the content but not the shape the route reads.

Rather than teach the route a second shape (two parsers for one table is how the
first edition's two-layer merge started), this converts the structured form BACK to
the raw list-of-lists and lets ``_format_yaml_structure_table`` stay the single
formatter. It is a lossless direction: the raw form is strictly less structured.

Round-trip rules, mirroring ``_parse_yaml_table_row``:
    title                              → ``[title]``
    {label, value}                     → ``[label, value]``
    {label, sub_rows:[{sub_label, template}]}
                                       → ``[label, sub1, tpl1, sub2, tpl2, …]``
Blanks are rendered back into their cell as ``【answer】``, which is the marker the
route's fill-blank detection looks for.
"""

from __future__ import annotations

import re
from typing import Any, Optional

# The cell marker the route treats as a fill-in blank.
_BLANK_OPEN, _BLANK_CLOSE = "【", "】"

# A cell whose text is only underscores/whitespace is a placeholder for the blank
# that follows it, not content — the raw form carries the answer in the cell itself.
_PLACEHOLDER = set("_＿ 　")

# A gap the teacher wrote: two or more underscores (half- or full-width) in a row.
# One underscore is not a gap — it appears inside ordinary text.
_GAP_RE = re.compile(r"[_＿]{2,}")


def _render_cell(text: Any, blanks: Optional[list]) -> str:
    """One table cell: the authored text with its blanks' answers put back in place.

    "In place" is the whole point. The cell text carries the gaps the teacher wrote
    as runs of underscores — 「需要驚人的__與__」 — and the answers belong inside
    them. Appending instead put every answer at the end of the sentence
    (「需要驚人的__與__。【記憶力】【反應力】」), which reads as the answer key
    printed under the question: the student sees both the gap and what fills it,
    and the gap is no longer answerable.
    """
    s = "" if text is None else str(text)
    answers = [
        str(b.get("answer", "")).strip()
        for b in (blanks or [])
        if isinstance(b, dict) and str(b.get("answer", "")).strip()
    ]
    if not answers:
        return s

    def wrap(a: str) -> str:
        return f"{_BLANK_OPEN}{a}{_BLANK_CLOSE}"

    # A cell that is nothing but a placeholder IS the blank.
    if not s or set(s) <= _PLACEHOLDER:
        return "".join(wrap(a) for a in answers)

    # Substitute answers into the underscore runs, left to right. Extra gaps keep
    # their underscores (an unanswered gap is a content gap, not something to
    # invent); extra answers append, because dropping one would lose data silently.
    remaining = list(answers)

    def take(_match) -> str:
        return wrap(remaining.pop(0)) if remaining else _match.group(0)

    out = _GAP_RE.sub(take, s)
    return out + "".join(wrap(a) for a in remaining)


def keypoints_to_structure_table(keypoints: Any) -> Optional[list[list[str]]]:
    """Structured keypoints → the raw ``story_structure_table`` list-of-lists.

    Returns None when there is nothing usable, so callers can fall through exactly
    as they did when the field was absent — never an empty table, which would render
    as a stripped-down 重點表 and look like content rather than a gap.
    """
    if not isinstance(keypoints, dict):
        return None
    kp = keypoints.get("keypoints") if "keypoints" in keypoints else keypoints
    if not isinstance(kp, dict):
        return None
    rows_in = kp.get("rows")
    if not isinstance(rows_in, list) or not rows_in:
        return None

    out: list[list[str]] = []
    title = str(kp.get("title") or "").strip()
    if title:
        out.append([title])

    for row in rows_in:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or "").strip()
        subs = row.get("sub_rows")
        if isinstance(subs, list) and subs:
            cells = [label]
            for sub in subs:
                if not isinstance(sub, dict):
                    continue
                cells.append(str(sub.get("sub_label") or "").strip())
                cells.append(_render_cell(sub.get("template"), sub.get("blanks")))
            # `_parse_yaml_table_row` reads a >3-cell row as paired only when the
            # remainder after the label is even. It always is here: cells starts at
            # one (the label) and every accepted sub_row appends exactly two, so the
            # count is invariably odd. A guard for the even case would be unreachable
            # — mutation-checked, it survived every test because nothing can enter it.
            if len(cells) >= 3:
                out.append(cells)
            continue
        out.append([label, _render_cell(row.get("value"), row.get("blanks"))])

    return out or None
