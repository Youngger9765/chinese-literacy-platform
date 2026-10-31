#!/usr/bin/env python3
"""閱讀寶貝造型公式的輸入資料（#3780 第三階段，game-design.md §1.3）。

造型 = 劇情類型（由 grade/category/genre 決定，規則在前端
`islandTemplate.storyTypeForLesson`，這裡不重寫規則、只搬原始欄位）
     × 年級色系（grade）
     × 招牌小物（能力家族，取 professor_node primary 節點；沒有節點 → AI00）

來源：docs/design/reading-babies/lesson-indicators.json
產出：frontend/src/data/readingBabyAppearanceInputs.json

可重跑：`python3 scripts/build_reading_baby_appearance_inputs.py`
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "design" / "reading-babies" / "lesson-indicators.json"
TARGET = ROOT / "frontend" / "src" / "data" / "readingBabyAppearanceInputs.json"


def _family(lesson: dict) -> str:
    nodes = lesson.get("professor_node") or []
    if not nodes:
        return "AI00"
    primary = next((n for n in nodes if n.get("primary")), nodes[0])
    return primary["family"]


def build() -> dict:
    doc = json.loads(SOURCE.read_text(encoding="utf-8"))
    lessons = {
        lesson["lesson_uid"]: {
            "grade": lesson.get("grade") or "",
            "category": lesson.get("category") or "",
            "genre": lesson.get("genre") or "",
            "family": _family(lesson),
        }
        for lesson in sorted(doc["lessons"], key=lambda item: item["lesson_uid"])
    }
    return {
        "_meta": {
            "name": "閱讀寶貝造型公式輸入（前端專用）",
            "generated_from": "docs/design/reading-babies/lesson-indicators.json",
            "generated_by": "scripts/build_reading_baby_appearance_inputs.py",
            "rule": "game-design.md §1.3：劇情類型 × 年級 × 招牌小物；劇情類型規則在 islandTemplate.storyTypeForLesson",
        },
        "lessons": lessons,
    }


def main() -> None:
    result = build()
    TARGET.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(result['lessons'])} lessons -> {TARGET}")


if __name__ == "__main__":
    main()
