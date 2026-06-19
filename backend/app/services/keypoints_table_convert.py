"""Convert keypoints.yml schema to story_structure_table rows (runtime-safe copy)."""

from __future__ import annotations


def fill_template(template: str, blanks: list) -> str:
    """Restore 【 answer 】 placeholders from template + blanks list."""
    text = template or ""
    for blank in blanks:
        if isinstance(blank, dict):
            answer = str(blank.get("answer", "")).strip()
        else:
            answer = str(blank).strip()
        if "__" in text:
            text = text.replace("__", f"【 {answer} 】", 1)
        elif answer:
            text = f"{text}【 {answer} 】"
    return text


def format_label(label: str, paragraph: str | None = None) -> str:
    if not paragraph:
        return label
    return f"{label}\n/（{paragraph}）"


def format_row_label(row: dict) -> str:
    label = row.get("label", "")
    label_blanks = row.get("label_blanks") or []
    if label_blanks:
        label = fill_template(label, label_blanks)
    return format_label(label, row.get("paragraph"))


def keypoints_to_table(kp_schema: dict) -> list[list[str]]:
    """Convert keypoints.yml content to story_structure_table rows."""
    data = kp_schema.get("keypoints", kp_schema)
    columns = data.get("columns") or ["label", "value"]
    rows_out: list[list[str]] = []

    title = data.get("title")
    if title:
        rows_out.append([title])

    for row in data.get("rows") or []:
        label = format_row_label(row)

        if row.get("sub_rows"):
            section = label
            for sub_row in row["sub_rows"]:
                sub_label = sub_row.get("sub_label", "")
                sub_label_blanks = sub_row.get("label_blanks") or []
                if sub_label_blanks:
                    sub_label = fill_template(sub_label, sub_label_blanks)
                value = fill_template(
                    sub_row.get("template") or sub_row.get("value", ""),
                    sub_row.get("blanks") or [],
                )
                if "hint" in columns and "sub_label" not in columns:
                    hint = sub_row.get("hint", "")
                    rows_out.append([section, hint, value])
                else:
                    rows_out.append([section, sub_label, value])
            continue

        value = fill_template(
            row.get("template") or row.get("value", ""),
            row.get("blanks") or [],
        )

        if columns == ["label", "hint", "value"] or (
            "hint" in columns and "sub_label" not in columns
        ):
            hint = row.get("hint", "")
            rows_out.append([label, hint, value])
        else:
            rows_out.append([label, value])

    return rows_out
