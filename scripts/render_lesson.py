#!/usr/bin/env python3
"""
render_lesson.py  —  issue #2205 experiment
Renders a lesson schema (spotlight.yml + keypoints.yml + assets/) into a
self-contained HTML file for visual validation and demo purposes.

Usage:
    python3 scripts/render_lesson.py <lesson_id> [--output PATH] [--open]

Output:
    private/curriculum-source/_online-schema/<lesson_id>.html  (default)

Block types rendered:
  guide         — instruction / pedagogical context text box
  passage       — indented grey passage (lesson text or supplementary)
  single/multi  — clickable MCQ (answer highlighted)
  free_text     — input-like box with prompt
  fill_table    — redirects to keypoints table rendering
  figure        — image (PNG/JPEG) or data table (JSON)
  highlight     — highlightable text area
  self_check    — checkbox checklist
  keypoints     — structured fill-in table from keypoints.yml
"""
import sys, os, json, base64, re, argparse
from pathlib import Path
import yaml

SCHEMA_DIR = Path("private/curriculum-source/_online-schema")
ASSETS_BASE = SCHEMA_DIR / "assets"

# ── HTML template ─────────────────────────────────────────────────────────────

HTML_HEADER = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  /* === Base === */
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
    background: #f8f8f6;
    color: #222;
    font-size: 15px;
    line-height: 1.7;
    padding: 24px 16px;
  }}
  .page {{
    max-width: 820px;
    margin: 0 auto;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.08);
    padding: 32px 40px;
  }}

  /* === Header === */
  .lesson-header {{
    border-bottom: 3px solid #2563eb;
    padding-bottom: 16px;
    margin-bottom: 28px;
  }}
  .lesson-id {{ color: #2563eb; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; }}
  .lesson-title {{ font-size: 22px; font-weight: 700; margin: 6px 0 4px; color: #111; }}
  .strategy-badge {{
    display: inline-block;
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    border-radius: 12px;
    padding: 2px 12px;
    font-size: 12px;
    font-weight: 500;
  }}

  /* === Block containers === */
  .block {{ margin: 14px 0; }}

  /* === Guide block === */
  .block-guide {{
    background: #fffbeb;
    border-left: 4px solid #f59e0b;
    padding: 10px 16px;
    border-radius: 0 6px 6px 0;
    color: #374151;
    font-size: 14px;
    white-space: pre-wrap;
  }}
  .block-guide.section-heading {{
    background: #f0f9ff;
    border-left-color: #0ea5e9;
    font-weight: 600;
    font-size: 15px;
    color: #0c4a6e;
  }}

  /* === Passage block === */
  .block-passage {{
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 12px 16px;
    margin: 14px 0;
  }}
  .passage-label {{
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }}
  .block-passage .para {{ margin: 4px 0; color: #374151; }}

  /* === Single/Multi choice === */
  .block-mcq {{
    background: #fafafa;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 14px 16px;
    margin: 14px 0;
  }}
  .mcq-prompt {{ font-weight: 500; margin-bottom: 10px; color: #111; }}
  .mcq-option {{
    padding: 6px 12px;
    margin: 4px 0;
    border-radius: 5px;
    cursor: default;
    font-size: 14px;
    border: 1px solid transparent;
  }}
  .mcq-option.is-answer {{
    background: #dcfce7;
    border-color: #86efac;
    color: #14532d;
    font-weight: 600;
  }}
  .mcq-option:not(.is-answer) {{
    background: #f9fafb;
    color: #4b5563;
    border-color: #e5e7eb;
  }}
  .mcq-option:not(.is-answer)::before {{ content: "□ "; color: #9ca3af; }}

  /* === Free text block === */
  .block-free-text {{
    margin: 12px 0;
    padding: 10px 14px;
    background: #fafafa;
    border: 1.5px dashed #d1d5db;
    border-radius: 6px;
  }}
  .free-text-prompt {{ font-size: 14px; color: #374151; margin-bottom: 6px; }}
  .free-text-input {{
    width: 100%;
    min-height: 36px;
    border: none;
    border-bottom: 1.5px solid #d1d5db;
    background: transparent;
    font-size: 14px;
    color: #374151;
    outline: none;
    padding: 2px 0;
  }}

  /* === Self check === */
  .block-self-check {{
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    padding: 14px 18px;
    margin: 14px 0;
  }}
  .self-check-title {{
    font-weight: 700;
    color: #166534;
    margin-bottom: 10px;
    font-size: 14px;
  }}
  .self-check-item {{
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 6px 0;
    font-size: 14px;
    color: #166534;
  }}
  .self-check-box {{
    width: 16px;
    height: 16px;
    border: 2px solid #86efac;
    border-radius: 3px;
    flex-shrink: 0;
    margin-top: 2px;
  }}

  /* === Figure blocks === */
  .block-figure {{
    margin: 18px 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }}
  .figure-caption {{
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 6px;
    font-style: italic;
  }}
  .figure-img {{
    max-width: 100%;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07);
  }}

  /* === Figure + text side-by-side (for per-practice figures) === */
  .figure-practice-pair {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    align-items: start;
    margin: 16px 0;
    padding: 16px;
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 8px;
  }}
  .figure-practice-pair .block-figure {{ margin: 0; }}
  .figure-practice-pair .practice-content {{ min-width: 0; }}

  /* === Data table (表一/表二) === */
  .block-data-table {{
    margin: 16px 0;
    overflow-x: auto;
  }}
  .data-table-caption {{
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 6px;
    font-weight: 600;
  }}
  .data-table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }}
  .data-table th, .data-table td {{
    border: 1px solid #d1d5db;
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
  }}
  .data-table th {{
    background: #e0f2fe;
    font-weight: 600;
    color: #0c4a6e;
  }}
  .data-table tr:nth-child(even) td {{ background: #f9fafb; }}
  .data-table td:empty {{ background: #f3f4f6; }}

  /* === Keypoints table === */
  .section-keypoints {{
    margin-top: 40px;
    padding-top: 24px;
    border-top: 2px solid #e5e7eb;
  }}
  .keypoints-title {{
    font-size: 17px;
    font-weight: 700;
    color: #1e40af;
    margin-bottom: 18px;
  }}
  .kp-table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }}
  .kp-table th, .kp-table td {{
    border: 1px solid #bfdbfe;
    padding: 8px 12px;
    vertical-align: top;
  }}
  .kp-table th {{
    background: #dbeafe;
    font-weight: 600;
    color: #1e40af;
    width: 120px;
  }}
  .kp-table td {{ background: #fff; color: #374151; }}
  .blank-slot {{
    display: inline-block;
    min-width: 60px;
    border-bottom: 1.5px solid #2563eb;
    color: #1d4ed8;
    font-weight: 600;
    padding: 0 4px;
  }}
  .nested-label {{ font-weight: 600; color: #1e40af; }}
  .sub-row-label {{ color: #4b5563; font-size: 12px; }}

  /* === Block separator === */
  .block-sep {{
    border: none;
    border-top: 1px solid #f3f4f6;
    margin: 8px 0;
  }}

  /* === Responsive === */
  @media (max-width: 640px) {{
    .page {{ padding: 20px 16px; }}
    .figure-practice-pair {{ grid-template-columns: 1fr; }}
  }}
</style>
</head>
<body>
<div class="page">
"""

HTML_FOOTER = """
</div>
</body>
</html>
"""


# ── Helpers ────────────────────────────────────────────────────────────────────

def img_to_data_uri(path: Path) -> str:
    """Encode image as base64 data URI."""
    ext = path.suffix.lower().lstrip(".")
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "gif": "image/gif", "webp": "image/webp"}.get(ext, "image/png")
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{data}"


def escape_html(text: str) -> str:
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def render_blanks(template: str, blanks: list) -> str:
    """Replace __ in template with filled answer spans."""
    if not blanks:
        return escape_html(template)
    result = escape_html(template)
    for blank in blanks:
        ans = blank.get("answer") or "___"
        # Replace first __ occurrence
        result = result.replace("__", f'<span class="blank-slot">{escape_html(ans)}</span>', 1)
    return result


# ── Block renderers ────────────────────────────────────────────────────────────

def render_guide(block: dict) -> str:
    text = block.get("text", "")
    # Detect section headings: 練習N, 步驟, 統整
    is_heading = bool(re.match(r"^(練習[一二三四五六]|步驟[❶❷❸❹①②③④]|統整)", text))
    cls = "block-guide section-heading" if is_heading else "block-guide"
    return f'<div class="block {cls}">{escape_html(text)}</div>\n'


def render_passage(block: dict) -> str:
    source = block.get("source", "")
    label = {"lesson_text": "課文節錄", "supplementary": "補充文本", "unknown": "文本"}.get(source, "文本")
    paras = block.get("paragraphs", [])
    inner = "\n".join(f'<p class="para">{escape_html(p)}</p>' for p in paras)
    return (f'<div class="block block-passage">'
            f'<div class="passage-label">{label}</div>'
            f'{inner}</div>\n')


def render_mcq(block: dict) -> str:
    prompt = escape_html(block.get("prompt", ""))
    options = block.get("options") or []
    answer = block.get("answer")
    options_html = ""
    for opt in options:
        cls = "mcq-option is-answer" if opt == answer else "mcq-option"
        options_html += f'<div class="{cls}">{escape_html(opt)}</div>\n'
    if not options and answer:
        options_html = f'<div class="mcq-option is-answer">{escape_html(answer)}</div>\n'
    return (f'<div class="block block-mcq">'
            f'<div class="mcq-prompt">{prompt}</div>'
            f'{options_html}</div>\n')


def render_free_text(block: dict) -> str:
    prompt = escape_html(block.get("prompt", ""))
    return (f'<div class="block block-free-text">'
            f'<div class="free-text-prompt">{prompt}</div>'
            f'<div class="free-text-input"></div>'
            f'</div>\n')


def render_self_check(block: dict) -> str:
    items = block.get("items", [])
    items_html = "".join(
        f'<div class="self-check-item">'
        f'<div class="self-check-box"></div>'
        f'<span>{escape_html(item)}</span>'
        f'</div>\n'
        for item in items
    )
    return (f'<div class="block block-self-check">'
            f'<div class="self-check-title">自我檢核</div>'
            f'{items_html}</div>\n')


def render_figure_image(asset_path: Path, caption: str = "") -> str:
    if not asset_path.exists():
        return f'<div class="block-figure"><div class="figure-caption">[圖片未找到: {asset_path.name}]</div></div>\n'
    uri = img_to_data_uri(asset_path)
    cap_html = f'<div class="figure-caption">{escape_html(caption)}</div>' if caption else ""
    return (f'<div class="block block-figure">'
            f'{cap_html}'
            f'<img class="figure-img" src="{uri}" alt="{escape_html(caption)}">'
            f'</div>\n')


def render_figure_table(asset_path: Path, caption: str = "") -> str:
    if not asset_path.exists():
        return f'<div class="block-data-table"><div class="data-table-caption">[表格未找到: {asset_path.name}]</div></div>\n'
    with open(asset_path, encoding="utf-8") as f:
        data = json.load(f)
    rows = data.get("rows", [])
    notes = data.get("notes", [])
    cap_html = f'<div class="data-table-caption">{escape_html(caption)}</div>' if caption else ""

    # Determine header row (first row) and data rows
    html_rows = ""
    for ri, row in enumerate(rows):
        cells = []
        for ci, cell in enumerate(row):
            if cell is None:
                cells.append("<td></td>")
            elif ri == 0:
                cells.append(f"<th>{escape_html(str(cell))}</th>")
            else:
                cells.append(f"<td>{escape_html(str(cell))}</td>")
        tag = "tr"
        html_rows += f"<{tag}>{''.join(cells)}</{tag}>\n"

    notes_html = ""
    if notes:
        notes_html = "<div style='font-size:11px;color:#6b7280;margin-top:4px;'>" + "<br>".join(escape_html(n) for n in notes) + "</div>"

    return (f'<div class="block block-data-table">'
            f'{cap_html}'
            f'<table class="data-table">{html_rows}</table>'
            f'{notes_html}'
            f'</div>\n')


def render_figure_block(block: dict, lesson_id: str) -> str:
    asset_name = block.get("asset") or ""
    referent = block.get("referent", "image")
    bind = block.get("bind_paragraph", "")
    caption = bind if bind else asset_name

    # Path-traversal guard: asset_name comes from the generated schema, but never
    # trust it — reject separators/NUL/absolute paths and require the resolved
    # path to stay inside ASSETS_BASE/<lesson_id>.
    base = (ASSETS_BASE / lesson_id).resolve()
    bad = (
        not asset_name
        or "\x00" in asset_name
        or "/" in asset_name
        or "\\" in asset_name
        or os.path.isabs(asset_name)
    )
    candidate = (base / asset_name).resolve() if not bad else None
    if bad or not str(candidate).startswith(str(base) + os.sep):
        return (
            '<div class="block-figure"><div class="figure-caption">'
            f'[invalid asset: {escape_html(asset_name)}]</div></div>'
        )
    asset_path = candidate

    if referent == "table" or (asset_name and asset_name.endswith(".json")):
        return render_figure_table(asset_path, caption)
    else:
        return render_figure_image(asset_path, caption)


def render_fill_table(block: dict, keypoints_schema: dict) -> str:
    """Render fill_table block by embedding the keypoints table."""
    if not keypoints_schema:
        return '<div class="block block-guide">[重點填表 — 尚無 keypoints 資料]</div>\n'
    return render_keypoints_section(keypoints_schema, inline=True)


def render_keypoints_section(kp: dict, inline: bool = False) -> str:
    """Render full keypoints table (either as section or inline fill_table)."""
    data = kp.get("keypoints", kp)
    structure = data.get("structure", "flat")
    rows = data.get("rows", [])
    title = data.get("title", "文章重點表")
    columns = data.get("columns", ["label", "value"])

    # Build header row
    col_labels = {
        "label": "項目", "sub_label": "小項", "value": "重點內容",
        "hint": "提示", "paragraph": "段落位置"
    }
    header_cells = "".join(
        f'<th>{col_labels.get(c, escape_html(str(c)))}</th>' for c in columns
    )

    tbody = ""
    for row in rows:
        if "sub_rows" in row:
            # Nested row
            sub_rows = row["sub_rows"]
            label = escape_html(row.get("label", ""))
            first = True
            for sr in sub_rows:
                sl = escape_html(sr.get("sub_label", ""))
                val = render_blanks(sr.get("template", sr.get("value", "")), sr.get("blanks", []))
                para = escape_html(sr.get("paragraph", ""))
                row_cells = ""
                if first:
                    row_cells += f'<th rowspan="{len(sub_rows)}" style="vertical-align:middle;">{label}</th>'
                    first = False
                row_cells += f'<td class="sub-row-label">{sl}</td>'
                row_cells += f'<td>{val}</td>'
                if "paragraph" in columns:
                    row_cells += f'<td>{para}</td>'
                tbody += f"<tr>{row_cells}</tr>\n"
        else:
            label = escape_html(row.get("label", ""))
            val = render_blanks(row.get("template", row.get("value", "")), row.get("blanks", []))
            para = escape_html(row.get("paragraph", ""))
            hint = escape_html(row.get("hint", ""))
            row_cells = f'<th>{label}</th><td>{val}</td>'
            if "hint" in columns:
                row_cells = f'<th>{label}</th><td>{hint}</td><td>{val}</td>'
            elif "paragraph" in columns:
                row_cells += f'<td>{para}</td>'
            tbody += f"<tr>{row_cells}</tr>\n"

    table_html = (f'<table class="kp-table">'
                  f'<thead><tr>{header_cells}</tr></thead>'
                  f'<tbody>{tbody}</tbody>'
                  f'</table>')

    if inline:
        return (f'<div class="block" style="margin:14px 0;">'
                f'<div style="font-size:13px;color:#1e40af;font-weight:600;margin-bottom:8px;">'
                f'文章重點表 / 填寫區</div>'
                f'{table_html}</div>\n')
    else:
        return (f'<div class="section-keypoints">'
                f'<div class="keypoints-title">文章重點表</div>'
                f'{table_html}</div>\n')


# ── Main render pipeline ───────────────────────────────────────────────────────

def render_blocks(blocks: list, lesson_id: str, keypoints_schema: dict) -> str:
    html = ""
    for block in blocks:
        btype = block.get("type", "")
        if btype == "guide":
            html += render_guide(block)
        elif btype == "passage":
            html += render_passage(block)
        elif btype in ("single", "multi"):
            html += render_mcq(block)
        elif btype == "free_text":
            html += render_free_text(block)
        elif btype == "self_check":
            html += render_self_check(block)
        elif btype == "figure":
            html += render_figure_block(block, lesson_id)
        elif btype == "fill_table":
            html += render_fill_table(block, keypoints_schema)
        elif btype == "highlight":
            # Simple highlight block: show as free_text for now
            html += render_free_text({"prompt": block.get("text", "（可標記文字區）")})
        elif btype == "match":
            # Trait-match table
            html += render_match_table(block)
        # skip unknown / internal types
    return html


def render_match_table(block: dict) -> str:
    col_left = escape_html(block.get("col_left", "左"))
    col_right = escape_html(block.get("col_right", "右"))
    rows = block.get("rows", [])
    tbody = "".join(
        f'<tr><td>{escape_html(r.get("left",""))}</td>'
        f'<td>{escape_html(r.get("right",""))}</td></tr>\n'
        for r in rows
    )
    return (f'<div class="block block-data-table">'
            f'<table class="data-table">'
            f'<thead><tr><th>{col_left}</th><th>{col_right}</th></tr></thead>'
            f'<tbody>{tbody}</tbody></table></div>\n')


def render_lesson(lesson_id: str, output_path: Path):
    sp_path = SCHEMA_DIR / f"{lesson_id}.spotlight.yml"
    kp_path = SCHEMA_DIR / f"{lesson_id}.keypoints.yml"

    if not sp_path.exists():
        print(f"ERROR: spotlight schema not found: {sp_path}", file=sys.stderr)
        sys.exit(1)

    with open(sp_path, encoding="utf-8") as f:
        sp = yaml.safe_load(f)

    kp_schema = None
    if kp_path.exists():
        with open(kp_path, encoding="utf-8") as f:
            kp_schema = yaml.safe_load(f)

    spotlight = sp.get("spotlight", {})
    blocks = spotlight.get("blocks", [])
    strategy_name = spotlight.get("strategy_name", "")
    strategy_type = spotlight.get("strategy_type", "")
    lesson_title = f"{lesson_id} — {strategy_name}" if strategy_name else lesson_id

    # HTML header
    html = HTML_HEADER.format(title=lesson_title)

    # Lesson header card
    html += (f'<div class="lesson-header">'
             f'<div class="lesson-id">{escape_html(lesson_id)}</div>'
             f'<div class="lesson-title">{escape_html(strategy_name)}</div>'
             f'<span class="strategy-badge">{escape_html(strategy_type)}</span>'
             f'</div>\n')

    # Render all spotlight blocks
    html += render_blocks(blocks, lesson_id, kp_schema)

    # Keypoints section (if exists and not already inlined via fill_table)
    has_fill_table = any(b.get("type") == "fill_table" for b in blocks)
    if kp_schema and not has_fill_table:
        html += render_keypoints_section(kp_schema)

    html += HTML_FOOTER

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"[render] Written to {output_path}")
    print(f"  Blocks: {len(blocks)}")
    block_types = {}
    for b in blocks:
        bt = b.get("type", "?")
        block_types[bt] = block_types.get(bt, 0) + 1
    for bt, cnt in sorted(block_types.items()):
        print(f"    {bt}: {cnt}")
    if kp_schema:
        rows = kp_schema.get("keypoints", {}).get("rows", [])
        print(f"  Keypoints rows: {len(rows)}")
    else:
        print(f"  Keypoints: none")
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Render lesson schema to self-contained HTML"
    )
    parser.add_argument("lesson_id", help="Lesson ID e.g. G7-L29")
    parser.add_argument("--output", "-o", help="Output HTML path (default: schema dir)")
    parser.add_argument("--open", action="store_true", help="Open in browser after render")
    args = parser.parse_args()

    lesson_id = args.lesson_id
    output_path = Path(args.output) if args.output else (
        SCHEMA_DIR / f"{lesson_id}.html"
    )

    out = render_lesson(lesson_id, output_path)

    if args.open:
        import subprocess, platform
        if platform.system() == "Darwin":
            subprocess.run(["open", str(out)])
        elif platform.system() == "Linux":
            subprocess.run(["xdg-open", str(out)])


if __name__ == "__main__":
    main()
