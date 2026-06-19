"""Render keypoints.yml as HTML for curriculum QA original preview."""

from __future__ import annotations

import html
import re
from typing import Any

_BLANK_RE = re.compile(r"【(.*?)】")


def _escape(text: str) -> str:
    return html.escape(text or "", quote=True)


def _render_blanks(template: str, blanks: list[str] | None) -> str:
    if not template:
        return ""
    parts = _BLANK_RE.split(template)
    out: list[str] = []
    bi = 0
    for i, part in enumerate(parts):
        if i % 2 == 0:
            out.append(_escape(part))
        else:
            hint = (blanks or [])[bi] if bi < len(blanks or []) else ""
            bi += 1
            if hint.strip():
                out.append(f'<span class="blank filled">{_escape(hint)}</span>')
            else:
                out.append('<span class="blank empty">【　　　】</span>')
    return "".join(out)


def render_keypoints_html(kp_schema: dict[str, Any], *, title: str | None = None) -> str:
    """Static HTML table mirroring DOCX keypoints layout (read-only)."""
    data = kp_schema.get("keypoints", kp_schema)
    rows = data.get("rows") or []
    columns = data.get("columns") or ["label", "value"]
    heading = title or data.get("title") or "文章重點表（原文抽取預覽）"

    col_labels = {
        "label": "項目",
        "sub_label": "小項",
        "value": "重點內容",
        "hint": "提示",
        "paragraph": "段落",
    }
    header = "".join(f"<th>{col_labels.get(c, c)}</th>" for c in columns)

    tbody = ""
    for row in rows:
        if row.get("sub_rows"):
            label = _escape(row.get("label", ""))
            first = True
            for sr in row["sub_rows"]:
                cells = []
                if first:
                    cells.append(
                        f'<th rowspan="{len(row["sub_rows"])}" class="section">'
                        f"{label}</th>"
                    )
                    first = False
                if "sub_label" in columns:
                    cells.append(f'<td class="sub">{_escape(sr.get("sub_label", ""))}</td>')
                val = _render_blanks(
                    sr.get("template") or sr.get("value", ""),
                    sr.get("blanks"),
                )
                cells.append(f"<td>{val}</td>")
                if "hint" in columns:
                    cells.append(f"<td>{_escape(sr.get('hint', ''))}</td>")
                if "paragraph" in columns:
                    cells.append(f"<td>{_escape(sr.get('paragraph', ''))}</td>")
                tbody += f"<tr>{''.join(cells)}</tr>\n"
        else:
            label = _escape(row.get("label", ""))
            val = _render_blanks(
                row.get("template") or row.get("value", ""),
                row.get("blanks"),
            )
            cells = [f"<th>{label}</th>"]
            if columns == ["label", "hint", "value"] or (
                "hint" in columns and "sub_label" not in columns
            ):
                cells.append(f"<td>{_escape(row.get('hint', ''))}</td>")
                cells.append(f"<td>{val}</td>")
            else:
                cells.append(f"<td>{val}</td>")
            if "paragraph" in columns:
                cells.append(f"<td>{_escape(row.get('paragraph', ''))}</td>")
            tbody += f"<tr>{''.join(cells)}</tr>\n"

    return f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8"/>
<title>{_escape(heading)}</title>
<style>
  body {{ font-family: "PingFang TC", "Noto Sans TC", sans-serif; margin: 16px; color: #1f2937; }}
  h1 {{ font-size: 1rem; color: #1e40af; margin: 0 0 12px; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 14px; }}
  th, td {{ border: 1px solid #d1d5db; padding: 8px 10px; vertical-align: top; }}
  th {{ background: #f3f4f6; font-weight: 600; }}
  th.section {{ background: #e0e7ff; }}
  td.sub {{ color: #4b5563; }}
  .blank.empty {{ background: #fef3c7; padding: 0 4px; border-radius: 2px; }}
  .blank.filled {{ background: #d1fae5; padding: 0 4px; border-radius: 2px; }}
  .meta {{ font-size: 12px; color: #6b7280; margin-bottom: 8px; }}
</style>
</head>
<body>
<p class="meta">DOCX / keypoints.yml 抽取預覽（非 Word 像素級）</p>
<h1>{_escape(heading)}</h1>
<table>
<thead><tr>{header}</tr></thead>
<tbody>{tbody}</tbody>
</table>
</body>
</html>"""
