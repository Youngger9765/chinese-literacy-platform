#!/usr/bin/env python3
"""LLM-based paragraph segmentation for TTS v2.

Sends each lesson paragraph to Gemini 2.5 Flash with explicit rules:
- hard: brackets must pair within a sentence, no cross-sentence splits
- soft: 15~35 chars preferred, semantic completeness overrides length
- every output sentence carries a `reasoning` field for audit

Usage:
    python3 backend/scripts/llm_segment_paragraph.py --lesson 1
    python3 backend/scripts/llm_segment_paragraph.py --all
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml
from google import genai
from google.genai import types as genai_types

ROOT = Path(__file__).resolve().parents[2]
LESSONS_DIR = ROOT / "backend" / "data" / "lessons"
OUT_DIR = ROOT / "backend" / "data" / "segmentation-v2"
MODEL = "gemini-2.5-flash"
PROJECT = "lingoleap-dev"
LOCATION = "us-central1"

SYSTEM_PROMPT = """你是國小國語文老師，負責把課文段落切成「朗讀練習單位」。

[核心原則]
你輸出的每個 sentence 都是**最終版本**。
不要輸出「應該合併但沒合併」的句子。
判斷要合併就在輸出前合併，不要在 reasoning 寫「與前句合併更自然」但卻獨立輸出。

[硬規則 — 違反 = 錯誤，必須重做]
A. 對話引號「...」、『...』必須在同一句內完整出現，絕不跨句
B. 冒號「說：」接的引述內容與前面的說話者必須在同一句
   例：❌ 她說：「早安。 / ❌ 」客人回道。
       ✅ 她說：「早安。」客人回道。
C. 所有成對符號（）、【】、《》必須配對
D. **每句必須以句末標點結尾**：。！？」』）
   絕不允許以逗號「，」、頓號「、」、分號「；」、冒號「：」結尾
   **允許升級標點**：若原文用逗號「，」或分號「；」連接兩個獨立想法（各自語意完整），
   可在切分處把該標點改成句號「。」。這是朗讀練習所需的合法修改。
   判斷標準：逗號前後能各自獨立成句、語意不依賴對方 → 升級為句號
E. 任何句子字數 < 10 字時，**必須檢查合併可能性**：
   - 能跟前句合併（語意延續、引述、補充） → 合併，不要獨立輸出
   - 能跟後句合併（起始連詞接續） → 合併到下一句
   - 只有段落本身就是這麼短才允許 < 10 字獨立存在

[軟規則 — 判斷基準]
1. 語意完整：這句獨立唸出，國小生能理解在說什麼嗎？
2. 朗讀長度：15~35 字偏好；一口氣唸得完、記得住
3. 長於 45 字：優先在「語意轉折處」拆分（用規則 D 升級標點）
   - 時間／空間／主詞轉換處
   - 「但是」「因為」「所以」「於是」「其實」等轉折連詞前
4. 忽略原文原始句號位置，以語意完整為準重新判斷

[自我檢查 — 輸出前必做]
針對你產生的每一句：
1. 長度 < 10 字？→ 檢查規則 E，決定合併還是保留
2. 結尾不是句末標點？→ 違反規則 D，必須合併到下一句
3. 含未配對引號？→ 違反規則 A，必須跟相鄰句合併

[輸出格式]
JSON 陣列，每項包含：
- idx: 從 0 開始的序號
- text: 切出的句子（保留原文標點，不改字）
- length: text 的字數
- reasoning: 為什麼這樣切（格式：「[長度X字] 語意完整因為... / 已合併原因...」）

reasoning 是強制欄位，會被稽核 — 若 reasoning 提到「應該合併」但卻獨立輸出，視為嚴重錯誤。"""

RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "idx": {"type": "INTEGER"},
            "text": {"type": "STRING"},
            "length": {"type": "INTEGER"},
            "reasoning": {"type": "STRING"},
        },
        "required": ["idx", "text", "length", "reasoning"],
    },
}


def _client() -> genai.Client:
    return genai.Client(vertexai=True, project=PROJECT, location=LOCATION)


def segment_paragraph(client: genai.Client, paragraph: str) -> list[dict]:
    """Call Gemini 2.5 Flash to segment a single paragraph."""
    user_content = f"[段落全文]\n{paragraph}\n\n[任務] 依規則切成朗讀練習單位，輸出 JSON 陣列。"
    response = client.models.generate_content(
        model=MODEL,
        contents=[genai_types.Content(
            role="user",
            parts=[genai_types.Part.from_text(text=user_content)],
        )],
        config=genai_types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=RESPONSE_SCHEMA,
            max_output_tokens=4096,
            temperature=0.2,
            thinking_config=genai_types.ThinkingConfig(thinking_budget=2048),
            automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    raw = response.text
    return json.loads(raw)


def process_lesson(client: genai.Client, lesson_path: Path) -> dict:
    with lesson_path.open(encoding="utf-8") as f:
        lesson = yaml.safe_load(f)

    lid = lesson.get("lesson_number")
    title = lesson.get("title", "")
    paragraphs = lesson.get("paragraphs", [])

    result = {
        "lesson_id": lid,
        "title": title,
        "paragraph_count": len(paragraphs),
        "paragraphs": [],
    }
    for pidx, paragraph in enumerate(paragraphs):
        print(f"  [L{lid:02d} p{pidx}] {len(paragraph)}字 → calling Gemini...", file=sys.stderr)
        sentences = segment_paragraph(client, paragraph)
        result["paragraphs"].append({
            "paragraph_idx": pidx,
            "paragraph_text": paragraph,
            "paragraph_length": len(paragraph),
            "sentences": sentences,
        })
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", type=int, help="Single lesson ID (e.g. 1)")
    ap.add_argument("--all", action="store_true", help="Process all lessons")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client = _client()

    if args.lesson:
        lesson_files = [LESSONS_DIR / f"L{args.lesson:02d}.yml"]
    elif args.all:
        lesson_files = sorted(LESSONS_DIR.glob("L*.yml"))
    else:
        ap.error("Pass --lesson N or --all")

    for lp in lesson_files:
        if not lp.exists():
            print(f"Skip missing: {lp}", file=sys.stderr)
            continue
        print(f"\nProcessing {lp.name}...", file=sys.stderr)
        result = process_lesson(client, lp)
        out = OUT_DIR / f"{lp.stem}.v2.json"
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        total_sentences = sum(len(p["sentences"]) for p in result["paragraphs"])
        print(f"  → {out} ({total_sentences} sentences)", file=sys.stderr)


if __name__ == "__main__":
    main()
