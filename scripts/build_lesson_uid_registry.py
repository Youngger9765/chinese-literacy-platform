#!/usr/bin/env python3
"""build_lesson_uid_registry.py — Phase 1 of the second-edition re-ink (#2685).

Assigns a permanent `lesson_uid` to every lesson and maps the existing online
catalogue onto it.

WHY this exists
---------------
The loader currently has no reliable "which lesson is this" key. Titles collide
(10 groups / 20 lessons after normalisation) and normalised lesson codes collide
even harder (13 groups / 26 lessons), because Layer-1 (`L*.yml`, 57 lessons,
hand-built 2026-02) and Layer-2 (`_parsed_2026-05-01/`, 152 files) were glued
together with a title-based enrich instead of retiring Layer-1. A title that
differs by one punctuation mark ("「拳」力出擊" vs "拳力出擊") breaks the enrich
and leaves the Layer-1 row an empty shell.

`lesson_uid` is allocated HERE and only here. It must never be derived from a
filename or a lesson code — that is exactly the mistake this file exists to undo.

Outputs
-------
  docs/curriculum/lesson-uid-registry.yml   the registry
  docs/curriculum/lesson-uid-ambiguous.md   rows a human must look at

Gate
----
`--check` runs the 8 machine checks from the PRD and exits non-zero on failure.
Human review is only required for the rows surfaced by check 7, not all 175.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY = REPO_ROOT / "docs" / "curriculum" / "lesson-uid-registry.yml"
AMBIGUOUS = REPO_ROOT / "docs" / "curriculum" / "lesson-uid-ambiguous.md"

UID_RE = re.compile(r"^L\d{4}$")
# Filename → code. Handles G4-L12, G9-L4, 文-L2, 體-L3, and the SL / a-suffix forms.
CODE_RE = re.compile(r"^(?P<code>(?:G\d+|文|體[^-]*)-S?L\d+[a-z]?)")


# ---------------------------------------------------------------------------
# normalisation
# ---------------------------------------------------------------------------

_PUNCT = "「」『』（）()，,。.？?！!：:；;、－-—～~　 　"


def norm_title(t: str | None) -> str:
    """Strip everything that drifts between editions: punctuation, width, marks."""
    t = unicodedata.normalize("NFKC", t or "")
    return "".join(
        c for c in t
        if unicodedata.category(c) not in ("Cf", "Mn", "Zs") and c not in _PUNCT
    )


def norm_code(code: str | None) -> str:
    """G4-L01 / G4-L1 → G4-L1 ; keeps a trailing a/b suffix."""
    if not code:
        return ""
    m = re.match(r"^(?P<g>G\d+|文|體[^-]*)-S?L0*(?P<n>\d+)(?P<s>[a-z]?)$",
                 unicodedata.normalize("NFKC", code).strip())
    if not m:
        return unicodedata.normalize("NFKC", code).strip()
    return f"{m['g']}-L{int(m['n'])}{m['s']}"


def parse_drive_name(name: str) -> tuple[str, str]:
    """'G5-L11救援大隊的好幫手（用表格整理訊息-比較兩個對象）.docx' → (G5-L11, 救援大隊的好幫手)"""
    stem = name[:-5] if name.endswith(".docx") else name
    m = CODE_RE.match(stem)
    code = m.group("code") if m else ""
    rest = stem[len(code):] if code else stem
    # the strategy tag lives in the trailing full-width parens — not part of the title
    title = re.sub(r"（.*?）\s*$", "", rest).strip()
    title = re.sub(r"\s*\(\d+\)\s*$", "", title).strip()  # "… (2)" duplicate marker
    return code, title


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

def build(drive: list[dict], online: list[dict]) -> tuple[dict, list[dict]]:
    """Allocate one lesson_uid per *text* from the Drive SOT.

    Drive is the single source of truth. The 165 lessons currently online are
    first-edition data that is being discarded wholesale — the platform has not
    reached a real classroom, there are no student records worth keeping, and no
    QR codes have been distributed. So this build deliberately does **not** try
    to pair new lessons with old story_ids: that mapping would be work spent on
    data that is about to be deleted, and it produced actively wrong pairs
    (e.g. "動物生存的妙招" matched story_id 1011, which is "誤會", purely because
    both happened to sit at code G4-L11 before the renumber).

    Every online lesson is therefore retired. The only thing carried forward is
    the text itself.
    """
    ambiguous: list[dict] = []

    # One uid per FILE. Not per title.
    #
    # Titles repeat across grades, but a repeated title is not the same lesson:
    # 大自然的氣象小幫手 exists as both G4-L12 (摘要策略, Level 4) and G7-L17
    # (自我提問策略1, Level 7) — 62% text similarity, different worksheet, 200
    # paragraphs apart. Same source text, different lesson built on top of it.
    # Merging them by title would collapse two real lessons into one and lose a
    # whole grade's worth of material.
    entries: list[dict] = []
    for i, f in enumerate(sorted(drive, key=lambda x: x["Path"]), start=1):
        code, title = parse_drive_name(f["Name"])
        entries.append({
            "lesson_uid": f"L{i:04d}",
            "title": title,
            "catalog_slot": code,
            "drive_file_id": f.get("ID"),
            "drive_path": f["Path"],
        })
        if not code:
            ambiguous.append({
                "lesson_uid": f"L{i:04d}", "new_code": "", "title": title,
                "drive_path": f["Path"], "reasons": ["檔名解析不出課號"],
                "legacy": [], "reviewed_by": None, "reviewed_at": None, "reason": None,
            })

    retired = [
        {"story_id": r["id"], "code": r.get("grade_code"), "title": r.get("title")}
        for r in online
    ]

    return {
        "version": 1,
        "source_of_truth": "Google Drive 二修教材資料夾",
        "generated_from": {"drive_files": len(drive), "retired_online_lessons": len(online)},
        "lessons": entries,
        "retired": retired,
    }, ambiguous


# ---------------------------------------------------------------------------
# gate — the 8 machine checks
# ---------------------------------------------------------------------------

def gate(reg: dict, amb: list[dict], drive: list[dict], online: list[dict]) -> list[str]:
    fails: list[str] = []
    lessons = reg["lessons"]

    uids = [e["lesson_uid"] for e in lessons]
    # 1 uid unique + fixed format (never-reuse is enforced against the committed
    #   registry in CI; a fresh build has no history to compare against)
    dup = [u for u, n in Counter(uids).items() if n > 1]
    if dup:
        fails.append(f"1. uid 重複: {dup[:5]}")
    bad = [u for u in uids if not UID_RE.match(u)]
    if bad:
        fails.append(f"1. uid 格式錯: {bad[:5]}")

    # 2 every Drive file has exactly one registry row
    if len(lessons) != len(drive):
        fails.append(f"2. registry {len(lessons)} != Drive {len(drive)}")
    paths = Counter(e["drive_path"] for e in lessons)
    d = [p for p, n in paths.items() if n > 1]
    if d:
        fails.append(f"2. drive_path 重複: {d[:3]}")

    # 3 drive_file_id present
    noid = [e["lesson_uid"] for e in lessons if not e.get("drive_file_id")]
    if noid:
        fails.append(f"3. 缺 drive_file_id: {len(noid)} 筆 {noid[:5]}")

    # 4 every online lesson is accounted for — all retired, none silently dropped
    retired_ids = {r["story_id"] for r in reg["retired"]}
    all_online = {r["id"] for r in online}
    if retired_ids != all_online:
        fails.append(f"4. retire 清單與線上不一致: 缺 {sorted(all_online - retired_ids)[:5]}")

    # 5 (n/a — no legacy mapping is produced; nothing can point at two uids)

    # 6 one catalog_slot must not map to multiple uids
    slot: dict[str, list[str]] = defaultdict(list)
    for e in lessons:
        if e["catalog_slot"]:
            slot[norm_code(e["catalog_slot"])].append(e["lesson_uid"])
    dslot = {k: v for k, v in slot.items() if len(v) > 1}
    if dslot:
        fails.append(f"6. 同一課號對到多個 uid: {list(dslot.items())[:5]}")

    # 7 ambiguous report exists (informational — presence is expected)
    # 8 every ambiguous row reviewed
    # check 8 reads the committed ambiguous report, not the freshly built list —
    # the build has no memory of who reviewed what.
    reviewed: set[str] = set()
    if AMBIGUOUS.exists():
        txt = AMBIGUOUS.read_text(encoding="utf-8")
        for block in txt.split("\n## ")[1:]:
            uid = block.split(" ")[0].strip()
            body = block.split("\n- reviewed_by:")
            if len(body) > 1 and body[1].splitlines()[0].strip():
                reviewed.add(uid)
    unreviewed = [a["lesson_uid"] for a in amb if a["lesson_uid"] not in reviewed]
    if unreviewed:
        fails.append(f"8. {len(unreviewed)} 筆 ambiguous 未經人工 review: {unreviewed[:5]}")

    return fails


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--drive", default="/tmp/p1/drive_docx.json")
    ap.add_argument("--online", default="/tmp/p1/online.json")
    ap.add_argument("--check", action="store_true", help="只跑 gate，不寫檔")
    a = ap.parse_args()

    drive = json.loads(Path(a.drive).read_text(encoding="utf-8"))
    online = json.loads(Path(a.online).read_text(encoding="utf-8"))

    reg, amb = build(drive, online)

    if not a.check:
        REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        REGISTRY.write_text(
            yaml.dump(reg, allow_unicode=True, sort_keys=False, default_flow_style=False),
            encoding="utf-8",
        )
        lines = [
            "# lesson_uid 對照表 — 需人工確認的列",
            "",
            f"> 自動產生。共 {len(amb)} 筆需要看，其餘 {len(reg['lessons']) - len(amb)} 筆已自動對上。",
            "> 每一筆確認後填 `reviewed_by` / `reviewed_at` / `reason`，CI 會檢查。",
            "",
        ]
        for x in amb:
            lines += [
                f"## {x['lesson_uid']} — {x['new_code']} {x['title']}",
                f"- Drive: `{x['drive_path']}`",
                f"- 原因: " + "；".join(x["reasons"]),
                f"- 線上對到: " + (", ".join(
                    f"story_id={m['story_id']}({m['code']})" for m in x["legacy"]) or "無"),
                "- reviewed_by: ", "- reviewed_at: ", "- reason: ", "",
            ]
        AMBIGUOUS.parent.mkdir(parents=True, exist_ok=True)
        AMBIGUOUS.write_text("\n".join(lines), encoding="utf-8")

    fails = gate(reg, amb, drive, online)
    print(f"  registry: {len(reg['lessons'])} 課 | retired: {len(reg['retired'])} | ambiguous: {len(amb)}")
    if fails:
        print("\n  ❌ MAPPING GATE FAIL")
        for f in fails:
            print(f"    - {f}")
        return 1
    print("  ✅ MAPPING GATE PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
