#!/usr/bin/env python3
"""
Convert spotlight_raw_text → frontend StrategyExercise.guided_steps JSON via Gemini.

Input:  backend/data/lessons/_reparsed_2026-05-02/{LESSON}.yml (has spotlight_raw_text)
Output: backend/data/lessons/_reparsed_2026-05-02/spotlight_structured/{LESSON}.json

Then runs sanity check:
  - All steps have prompt + type
  - 'select' steps have options + answer in [0, len(options))
  - JSON parseable
  - reasoning field present (for auditability — Young req)

Usage:
    python3 scripts/structure_spotlight_with_gemini.py G6-L22 G7-L28 ...
    python3 scripts/structure_spotlight_with_gemini.py --demo  # 7 demo lessons
"""
from __future__ import annotations
import argparse
import json
import re
import sys
import time
from pathlib import Path

import yaml

REPO = Path("/Users/young/project/chinese-literacy-platform")
INPUT_DIR = REPO / "backend/data/lessons/_reparsed_2026-05-02"
OUTPUT_DIR = INPUT_DIR / "spotlight_structured"

DEMO_LESSONS = ["G6-L22", "G6-L23", "G6-L24", "G6-L25", "G7-L28", "G7-L29", "G7-L30"]

# Frontend StrategyExercise.guided_steps shape (from frontend/src/types.ts):
SCHEMA_DESC = """
{
  "type": "guided_steps",
  "strategy_name": "<策略名稱，如 摘要策略-PSR / 圖文整合>",
  "instruction": "<簡短說明，1-2 句，告訴學生要做什麼>",
  "reasoning": "<你為什麼選這些題目 / 怎麼從原文判斷答案 — 給審稿人看>",
  "steps": [
    {
      "prompt": "<完整題目文字>",
      "type": "select",
      "options": ["選項1", "選項2", "選項3"],
      "answer": 0,
      "reasoning": "<為什麼答案是 X — 給審稿人看>"
    },
    {
      "prompt": "<開放題>",
      "type": "free_text",
      "reasoning": "<說明這題在練什麼>"
    }
  ]
}
"""

PROMPT_TEMPLATE = """你是國文閱讀教材結構化專家。以下是國中小「閱讀聚光燈」策略練習的原文文字。

請把它轉成 frontend 期待的 StrategyExercise JSON 格式。

【原文】
{spotlight_text}

【課文摘要（供你理解 context）】
{story_summary}

【輸出 JSON Schema】
{schema}

【重要規則】
1. 只輸出 JSON，不要 markdown code fence、不要解釋。
2. type 永遠是 "guided_steps"
3. 答案如果原文有用 □ 跟非 □ 區分（沒 □ = 正確），用那個判斷答案
4. 答案如果原文有用 「×」「○」標示，按那個判斷
5. 如果原文有「例一」「例二」「課文練習」，每個例子都當一個 select 題（單選）
6. 「主角是誰」「問題是什麼」「如何解決」「結果」每個都是一個 step
7. 開放題（如「想想看：...」）用 type=free_text
8. options 永遠至少 2 個，且 answer 必須是有效 index (0-indexed)
9. 你必須在 reasoning field 解釋你的判斷依據，這是審稿用，不能省

直接輸出 JSON："""


def load_lesson(code: str) -> dict | None:
    p = INPUT_DIR / f"{code}.yml"
    if not p.exists():
        return None
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def call_gemini(prompt: str) -> str:
    """Call Gemini 2.5 Flash via Vertex AI."""
    from google import genai
    from google.genai import types

    client = genai.Client(vertexai=True, project="lingoleap-dev", location="us-central1")
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.2,
            max_output_tokens=16384,  # G7-L29/L30 圖文整合 spotlight 3000+ chars w/ 19+ steps → bumped from 8192
            response_mime_type="application/json",
        ),
    )
    return response.text


def parse_json(raw: str) -> dict | None:
    """Robust JSON parse with code-fence stripping."""
    text = raw.strip()
    if text.startswith("```"):
        text = text[text.find("\n") + 1:] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[: text.rfind("```")]
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        return None


def sanity_check(data: dict) -> tuple[bool, list[str]]:
    """Validate AI output against expected shape."""
    errors: list[str] = []

    if not isinstance(data, dict):
        return False, ["root not a dict"]

    if data.get("type") != "guided_steps":
        errors.append(f"type != 'guided_steps' (got {data.get('type')})")

    for f in ["strategy_name", "instruction", "steps"]:
        if f not in data:
            errors.append(f"missing field: {f}")

    if "reasoning" not in data:
        errors.append("missing top-level reasoning field")

    steps = data.get("steps", [])
    if not isinstance(steps, list) or len(steps) == 0:
        errors.append("steps empty or not list")
        return False, errors

    for i, s in enumerate(steps):
        if "prompt" not in s:
            errors.append(f"step[{i}] missing prompt")
        if "type" not in s:
            errors.append(f"step[{i}] missing type")
        if s.get("type") == "select":
            opts = s.get("options", [])
            if not isinstance(opts, list) or len(opts) < 2:
                errors.append(f"step[{i}] select needs >=2 options (got {len(opts)})")
            ans = s.get("answer")
            if not isinstance(ans, int):
                errors.append(f"step[{i}] answer not int (got {ans!r})")
            elif not (0 <= ans < len(opts)):
                errors.append(f"step[{i}] answer={ans} out of range [0,{len(opts)})")
        if "reasoning" not in s:
            errors.append(f"step[{i}] missing reasoning field")

    return len(errors) == 0, errors


def structure_lesson(code: str) -> dict:
    """Convert one lesson's spotlight to structured JSON. Returns audit record."""
    lesson = load_lesson(code)
    if not lesson:
        return {"code": code, "status": "ERROR", "error": "yml not found"}

    spotlight = lesson.get("spotlight_raw_text", "") or ""
    if len(spotlight) < 100:
        return {
            "code": code,
            "status": "SKIP",
            "error": f"spotlight_raw_text too short ({len(spotlight)} chars)",
        }

    story_summary = (lesson.get("story_text") or "")[:500]

    prompt = PROMPT_TEMPLATE.format(
        spotlight_text=spotlight[:6000],  # cap to avoid token blowup
        story_summary=story_summary,
        schema=SCHEMA_DESC,
    )

    t0 = time.time()
    try:
        raw = call_gemini(prompt)
    except Exception as e:
        return {"code": code, "status": "ERROR", "error": f"gemini call failed: {e}"}
    elapsed = time.time() - t0

    parsed = parse_json(raw)
    if parsed is None:
        return {
            "code": code,
            "status": "ERROR",
            "error": "gemini output not valid JSON",
            "raw_preview": raw[:200],
            "elapsed_s": round(elapsed, 1),
        }

    ok, errors = sanity_check(parsed)
    out_path = OUTPUT_DIR / f"{code}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return {
        "code": code,
        "status": "OK" if ok else "FLAG",
        "errors": errors,
        "step_count": len(parsed.get("steps", [])),
        "select_count": sum(1 for s in parsed.get("steps", []) if s.get("type") == "select"),
        "free_text_count": sum(1 for s in parsed.get("steps", []) if s.get("type") == "free_text"),
        "elapsed_s": round(elapsed, 1),
        "out_path": str(out_path.relative_to(REPO)),
    }


def write_review_table(records: list[dict]) -> Path:
    """Build markdown side-by-side review table for human audit."""
    lines = [
        "# 閱讀聚光燈 結構化結果 — 7 課 demo 對照",
        "",
        "**檢查重點**：每課展開 JSON，跟原文比對是否：題目正確、選項齊全、答案對、reasoning 合理。",
        "",
        "## 摘要表",
        "",
        "| 課 | 狀態 | 步驟數 | select | free_text | 秒 | 警告 |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for r in records:
        warn = "; ".join(r.get("errors", [])) or ""
        lines.append(
            f"| {r['code']} | {r['status']} | {r.get('step_count','?')} | "
            f"{r.get('select_count','?')} | {r.get('free_text_count','?')} | "
            f"{r.get('elapsed_s','?')} | {warn[:80]} |"
        )

    lines.append("")
    lines.append("## 各課對照")
    lines.append("")

    for r in records:
        if r["status"] == "ERROR":
            continue
        code = r["code"]
        out_path = OUTPUT_DIR / f"{code}.json"
        if not out_path.exists():
            continue
        data = json.loads(out_path.read_text(encoding="utf-8"))
        spotlight = (load_lesson(code) or {}).get("spotlight_raw_text", "")

        lines.append(f"### {code}")
        lines.append("")
        lines.append(f"**策略**: {data.get('strategy_name','?')}")
        lines.append(f"**說明**: {data.get('instruction','?')}")
        lines.append(f"**AI reasoning**: {data.get('reasoning','—')}")
        lines.append("")
        lines.append("<details><summary>原文 spotlight (前 1000 字)</summary>")
        lines.append("")
        lines.append("```")
        lines.append(spotlight[:1000])
        lines.append("```")
        lines.append("</details>")
        lines.append("")
        lines.append("**結構化步驟**：")
        lines.append("")
        for i, s in enumerate(data.get("steps", []), 1):
            lines.append(f"#### 步驟 {i} ({s.get('type','?')})")
            lines.append(f"**Q**: {s.get('prompt','')}")
            if s.get("type") == "select":
                opts = s.get("options", [])
                ans_idx = s.get("answer", -1)
                for j, o in enumerate(opts):
                    marker = "✅" if j == ans_idx else "  "
                    lines.append(f"- {marker} {chr(65+j)}. {o}")
            lines.append(f"**Reasoning**: {s.get('reasoning','—')}")
            lines.append("")

    out = OUTPUT_DIR / "_REVIEW.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lessons", nargs="*", help="Lesson codes")
    ap.add_argument("--demo", action="store_true", help="Run 7 demo lessons")
    args = ap.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    targets = DEMO_LESSONS if args.demo else args.lessons
    if not targets:
        print("Usage: structure_spotlight_with_gemini.py [--demo|<lesson>...]")
        sys.exit(1)

    print(f"Processing {len(targets)} lessons → {OUTPUT_DIR}")
    records = []
    for code in targets:
        print(f"  {code}...", end=" ", flush=True)
        r = structure_lesson(code)
        records.append(r)
        print(f"{r['status']} ({r.get('step_count','?')} steps, {r.get('elapsed_s','?')}s)")
        if r.get("errors"):
            for e in r["errors"][:3]:
                print(f"      ⚠ {e}")

    review = write_review_table(records)
    print()
    print(f"✓ {sum(1 for r in records if r['status']=='OK')} OK")
    print(f"⚠ {sum(1 for r in records if r['status']=='FLAG')} FLAG (need review)")
    print(f"✗ {sum(1 for r in records if r['status']=='ERROR')} ERROR")
    print()
    print(f"Review: {review}")


if __name__ == "__main__":
    main()
