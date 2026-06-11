#!/usr/bin/env python3
"""Extract a lesson worksheet DOCX into ordered blocks (paragraphs + tables),
preserving table cell merges. Used by the build-spotlight / build-keypoints
project skills (issue #2205).

Why: backend/data/lessons/*.yml is parser-normalized and LOSSY (collapses
nested key-point tables, mangles merged-cell values). This reads the RAW docx.

Usage:
  python3 scripts/extract_docx_blocks.py <path.docx>               # full ordered body (JSON)
  python3 scripts/extract_docx_blocks.py <path.docx> --tables-only # tables w/ cell-level merge info
  python3 scripts/extract_docx_blocks.py <path.docx> --pretty      # human-readable
"""
import sys, json, re
import docx
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

SCAFFOLD_RE = re.compile(r"計時|裁判|還要多加練習|哇嗚|超級厲害|影片連結|我的表現|秒以下|秒以上")


def cell_grid(tc):
    """Return (gridspan, vmerge) for a <w:tc> element."""
    tcPr = tc.find(f"{W}tcPr")
    span, vmerge = 1, None
    if tcPr is not None:
        gs = tcPr.find(f"{W}gridSpan")
        if gs is not None:
            span = int(gs.get(f"{W}val", "1"))
        vm = tcPr.find(f"{W}vMerge")
        if vm is not None:
            vmerge = vm.get(f"{W}val", "continue")  # "restart" or "continue"
    return span, vmerge


def table_cells(tbl):
    """Per-cell records preserving merge info (no flattening)."""
    rows = []
    for ri, row in enumerate(tbl.rows):
        cells = []
        seen = set()
        for ci, cell in enumerate(row.cells):
            tc = cell._tc
            if id(tc) in seen:  # python-docx repeats merged cells; mark dup
                cells.append({"col": ci, "text": cell.text.strip(), "dup": True})
                continue
            seen.add(id(tc))
            span, vmerge = cell_grid(tc)
            cells.append({
                "col": ci,
                "text": cell.text.strip(),
                "gridspan": span,
                "vmerge": vmerge,
                "has_blank": bool(re.search(r"【.*?】", cell.text)),
            })
        rows.append({"row": ri, "cells": cells})
    return {"n_rows": len(tbl.rows), "n_cols": len(tbl.columns), "rows": rows}


def img_count(tbl_or_doc):
    el = tbl_or_doc._element if hasattr(tbl_or_doc, "_element") else tbl_or_doc.element
    blips = el.findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip")
    return len(blips)


def extract(path, tables_only=False):
    d = docx.Document(path)
    out = []
    ti = 0
    for child in d.element.body.iterchildren():
        if isinstance(child, CT_P):
            if tables_only:
                continue
            p = Paragraph(child, d)
            t = p.text.strip()
            if not t:
                continue
            out.append({"kind": "p", "style": p.style.name, "text": t})
        elif isinstance(child, CT_Tbl):
            tbl = Table(child, d)
            flat = " ".join(c.text for r in tbl.rows for c in r.cells)
            is_scaffold = bool(SCAFFOLD_RE.search(flat))
            rec = {"kind": "table", "index": ti, "scaffold": is_scaffold,
                   "images": img_count(tbl), **table_cells(tbl)}
            out.append(rec)
            ti += 1
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    flags = sys.argv[2:]
    data = extract(path, tables_only="--tables-only" in flags)
    if "--pretty" in flags:
        for b in data:
            if b["kind"] == "p":
                print(f"P|{b['style'][:8]}| {b['text'][:90]}")
            else:
                tag = "scaffold" if b["scaffold"] else "CONTENT"
                print(f"T#{b['index']} {b['n_rows']}x{b['n_cols']} [{tag}] img={b['images']}")
                for row in b["rows"]:
                    cells = []
                    for c in row["cells"]:
                        if c.get("dup"):
                            continue
                        mark = "✏️" if c.get("has_blank") else ""
                        cells.append(f"{c['text'][:22]}{mark}")
                    print("   " + " │ ".join(cells))
    else:
        print(json.dumps(data, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
