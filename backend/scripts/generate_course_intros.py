"""Generate `lesson_intro.course_intro` for lessons via Vertex AI Gemini (#1598).

Problem: existing `lesson_intro.text` is strategy explanation (e.g. "圖文題就是
文字帶著插圖的題目..."), not a course introduction. Young 5/8 walkthrough:
「我看完這個，我不知道課文在講什麼」.

This script generates a 150–250 character neutral course intro from `story_text`,
saved to `lesson_intro.course_intro` (alongside legacy `lesson_intro.text` which
the frontend re-purposes for the 學習策略 hint section).

Usage:
  python scripts/generate_course_intros.py --dry-run               # preview only
  python scripts/generate_course_intros.py --confirm                # all empty
  python scripts/generate_course_intros.py --confirm --only G7-L29  # one lesson
  python scripts/generate_course_intros.py --confirm --force        # overwrite
"""

import argparse
import logging
import pathlib
import sys
from datetime import date

import yaml
from google import genai
from google.genai import types as genai_types

BACKEND_DIR = pathlib.Path(__file__).parent.parent
PARSED_DIR = BACKEND_DIR / "data" / "lessons" / "_parsed_2026-05-01"
TARGET_LESSONS = ["G6-L22", "G6-L23", "G6-L24", "G6-L25", "G7-L28", "G7-L29", "G7-L30"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是國小高年級到國中國語文教材的編輯。
要為一篇課文寫「課文簡介」，給學生在開始閱讀前快速理解這篇文章在講什麼。

要求：
1. 150–250 個中文字（必須），不要超過 250 字
2. 中性、客觀，告訴讀者「這篇文章主題是什麼、討論哪些重點」
3. 不要暴雷：不要直接告訴讀者文章的結論、答案、主角結局
4. 不要寫成「閱讀策略說明」（例：不要寫「這一課用 XX 策略」）
5. 不要寫成「學習目標」（例：不要寫「你會學到 XX」）
6. 純文字，不要 markdown 標記、不要分段標題
7. 用親切但不過度的口吻，國小高年級到國中閱讀程度

只回覆「課文簡介」本身，不要任何前後綴。"""


def build_user_prompt(title: str, story_text: str) -> str:
    return f"課文標題：{title}\n\n課文全文：\n{story_text}\n\n請依照規則撰寫這篇課文的「課文簡介」。"


def gen_intro(client: genai.Client, title: str, story_text: str) -> str:
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=build_user_prompt(title, story_text),
        config=genai_types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.4,
            max_output_tokens=600,
            thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return (response.text or "").strip()


def process_one(client: genai.Client, yml_path: pathlib.Path, force: bool, dry_run: bool) -> str:
    with yml_path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    lesson_intro = data.get("lesson_intro") or {}
    if lesson_intro.get("course_intro") and not force:
        return "SKIP (course_intro already exists, use --force to overwrite)"

    story_text = data.get("story_text") or "\n".join(data.get("paragraphs") or [])
    title = data.get("title", "")
    if not story_text:
        return "SKIP (no story_text)"

    if dry_run:
        return f"WOULD-GEN ({len(story_text)} chars story, title='{title}')"

    intro = gen_intro(client, title, story_text)
    if not intro:
        return "FAIL (empty response)"

    lesson_intro["course_intro"] = intro
    lesson_intro["course_intro_source"] = f"ai-generated-{date.today().isoformat()}"
    data["lesson_intro"] = lesson_intro

    with yml_path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, width=1000)

    return f"OK ({len(intro)} chars)"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show plan without calling AI")
    parser.add_argument("--confirm", action="store_true", help="actually call Vertex AI and write YAML")
    parser.add_argument("--only", help="single lesson code, e.g. G7-L29")
    parser.add_argument("--force", action="store_true", help="overwrite existing course_intro")
    args = parser.parse_args()

    if not args.dry_run and not args.confirm:
        parser.error("must pass --dry-run or --confirm")

    lessons = [args.only] if args.only else TARGET_LESSONS
    client = genai.Client(vertexai=True, project="lingoleap-dev", location="us-central1") if args.confirm else None

    for code in lessons:
        yml_path = PARSED_DIR / f"{code}.yml"
        if not yml_path.exists():
            logger.warning("%s: file not found", code)
            continue
        try:
            result = process_one(client, yml_path, args.force, args.dry_run)
            logger.info("%s: %s", code, result)
        except Exception as e:
            logger.error("%s: ERROR %s", code, e)


if __name__ == "__main__":
    sys.exit(main())
