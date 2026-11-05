#!/usr/bin/env python3
"""179 課的 108 課綱三層（學習表現／學習內容／核心素養）→ 群島分群要用的精簡對照檔。

讀 `docs/design/reading-babies/lesson-indicators.json`（1.6MB，教授節點＋AI 逐課推論，
草稿未經老師審核），只抽三個欄位的「代碼」給前端分群用，寫到
`frontend/src/pages/student/archipelago/data/lessonCurriculum.json`（精簡，不是整份塞進前端）：

  - performanceCode  ← lesson.primary_indicator.code         （學習表現，如 "5-Ⅳ-4"）
  - contentPrefix    ← lesson.learning_contents[0].code 的字母前綴（學習內容大類，如 "Ad"）
  - competencyCode   ← lesson.core_competencies[0].general_item（核心素養，如 "A2"）

這三層怎麼合併成「不會有群少於 4 座島」的分群，邏輯**不**在這支腳本裡——那是顯示層的
決定（见 `archipelagoClusters.ts` 的 PERFORMANCE_KEY_BY_CODE 等合併表），這支只負責忠實
抽取 lesson-indicators.json 已經算好的代碼，不做任何分群判斷。

用法：
  python3 build_archipelago_curriculum.py            # 寫 lessonCurriculum.json
  python3 build_archipelago_curriculum.py --check     # 只印統計，不寫檔
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path
from datetime import datetime, timezone

SKILL_DIR = Path(__file__).resolve().parent.parent
REPO = SKILL_DIR.parent.parent.parent
LESSON_JSON = REPO / "docs/design/reading-babies/lesson-indicators.json"
OUT_JSON = REPO / "frontend/src/pages/student/archipelago/data/lessonCurriculum.json"
SOURCE_REL = "docs/design/reading-babies/lesson-indicators.json"

PREFIX_RE = re.compile(r"^([A-Za-z]+)")


def extract_codes(lesson: dict) -> dict:
    """純函式：從一課的原始欄位抽出三層代碼。缺哪個欄位就是 None（由呼叫端決定
    要不要當成錯誤），不假裝補一個值。"""
    performance_code = (lesson.get("primary_indicator") or {}).get("code")

    learning_contents = lesson.get("learning_contents") or []
    content_code = learning_contents[0].get("code") if learning_contents else None
    content_prefix = None
    if content_code:
        m = PREFIX_RE.match(content_code)
        content_prefix = m.group(1) if m else content_code

    core_competencies = lesson.get("core_competencies") or []
    competency_code = core_competencies[0].get("general_item") if core_competencies else None

    return {
        "performanceCode": performance_code,
        "contentPrefix": content_prefix,
        "competencyCode": competency_code,
    }


def build(lesson_json_path: Path) -> tuple[dict, list[str]]:
    """回傳 (byStoryId dict, 缺任一代碼的 story_id 清單)。"""
    with open(lesson_json_path, encoding="utf-8") as f:
        data = json.load(f)
    lessons = data["lessons"]

    by_story_id: dict[str, dict] = {}
    missing: list[str] = []
    for lesson in lessons:
        story_id = str(lesson["story_id"])
        codes = extract_codes(lesson)
        if not all(codes.values()):
            missing.append(story_id)
        by_story_id[story_id] = codes

    # 穩定輸出：依 story_id 數值排序，重跑結果位元組相同。
    sorted_by_story_id = {k: by_story_id[k] for k in sorted(by_story_id, key=int)}
    return sorted_by_story_id, missing


def print_stats(by_story_id: dict) -> None:
    perf = collections.Counter(v["performanceCode"] for v in by_story_id.values())
    content = collections.Counter(v["contentPrefix"] for v in by_story_id.values())
    comp = collections.Counter(v["competencyCode"] for v in by_story_id.values())

    print(f"總課數：{len(by_story_id)}")
    print(f"\n學習表現（{len(perf)} 個代碼）：")
    for code, n in perf.most_common():
        flag = " ⚠️ <4 需併群" if n < 4 else ""
        print(f"  {code}: {n}{flag}")
    print(f"\n學習內容（{len(content)} 個前綴）：")
    for prefix, n in content.most_common():
        flag = " ⚠️ <4 需併群" if n < 4 else ""
        print(f"  {prefix}: {n}{flag}")
    print(f"\n核心素養（{len(comp)} 項）：")
    for item, n in comp.most_common():
        flag = " ⚠️ <4 需併群" if n < 4 else ""
        print(f"  {item}: {n}{flag}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="只印統計，不寫檔")
    parser.add_argument("--lesson-json", type=Path, default=LESSON_JSON)
    parser.add_argument("--out", type=Path, default=OUT_JSON)
    args = parser.parse_args()

    if not args.lesson_json.exists():
        print(f"❌ 找不到來源檔：{args.lesson_json}", file=sys.stderr)
        return 1

    by_story_id, missing = build(args.lesson_json)

    if missing:
        print(f"⚠️ {len(missing)} 課缺三層代碼之一：{missing}", file=sys.stderr)

    print_stats(by_story_id)

    if args.check:
        return 0

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": SOURCE_REL,
        "status": "ai_draft_unreviewed",
        "note": "課綱分類為 AI 草稿，待老師審核（見 .claude/skills/lesson-curriculum-mapping/SKILL.md）",
        "totalLessons": len(by_story_id),
        "byStoryId": by_story_id,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
        f.write("\n")
    print(f"\n✅ 寫入 {args.out}（{len(by_story_id)} 課）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
