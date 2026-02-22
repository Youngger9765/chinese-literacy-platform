#!/usr/bin/env python3
"""
Direct model comparison: gemini-2.0-flash vs gemini-2.5-flash-preview
Tests the same prompt + schema + input against both models locally.
"""

import json
from google import genai
from google.genai import types as genai_types

client = genai.Client(vertexai=True, project="lingoleap-dev", location="us-central1")

STORY = """玉山是台灣最高的一座山，也是東北亞的第一高峰。它的高度將近四千公尺，山頂在冬天時常會覆蓋著白雪。
玉山擁有豐富的生態環境，可以看到許多特有的植物。保護這片美麗的山林，是我們每一個人的責任。"""

SYSTEM_PROMPT = """你是一位溫暖、鼓勵學生的繁體中文閱讀助教，擅長用蘇格拉底式問答引導學生深入理解課文。

課文標題：神祕的玉山

課文內容（每段前標有段落索引）：
[第0段] 玉山是台灣最高的一座山，也是東北亞的第一高峰。它的高度將近四千公尺，山頂在冬天時常會覆蓋著白雪。
[第1段] 玉山擁有豐富的生態環境，可以看到許多特有的植物。保護這片美麗的山林，是我們每一個人的責任。

你的任務：
1. 評估學生的回答是否展現了對問題的理解
2. 給予簡短、溫暖的回饋（1-2句）
3. 提出下一個蘇格拉底式問題，問題必須緊扣課文的關鍵內容

評估規則：
- understood = true 的條件：學生的回答包含問題要求的**關鍵資訊**，且資訊正確
- understood = false 的條件：回答缺少關鍵資訊、資訊錯誤、太模糊籠統、或敷衍
- 「方向正確但不精確」不算理解。例如：問「玉山的稱號是什麼？」回答「高山」→ false（太籠統，沒有說出「東北亞第一高峰」）
- 學生必須展現他**讀過並理解課文**，而非只是用常識猜測。如果答案可以不看課文就說出來，要特別嚴格判斷
- 數字必須精確：課文說「四千公尺」，回答「400」或「300」→ false（差距太大）
- 數字容許小幅誤差：「將近四千」回答「3952」或「大約四千」→ true
- 人名、地名、專有名詞必須正確，不可張冠李戴
- 如果 understood = false，用不同方式重新問同一層次的問題
- 如果 understood = true，進入下一個層次的問題

偵測敷衍回答：
- 如果學生回答「不知道」「不懂」「隨便」「沒有」等敷衍詞 → understood = false
- 如果學生的回答只有1-2個字且與課文無關 → understood = false

目前階段：factual
學生已理解的問題數：1/5

回饋風格：
- 語氣溫暖、友善，適合小學高年級至國中生
- 只用繁體中文
- 回饋要簡短（1-2句），然後直接問下一個問題
- 問題長度：15-40 個字"""

SCHEMA = {
    "type": "object",
    "properties": {
        "understood": {
            "type": "boolean",
            "description": "Whether the student's answer demonstrates understanding",
        },
        "feedback": {
            "type": "string",
            "description": "Brief feedback in Traditional Chinese",
        },
        "question": {
            "type": "string",
            "description": "Next Socratic question in Traditional Chinese",
        },
        "phase": {
            "type": "string",
            "enum": ["factual", "inferential", "evaluative"],
        },
        "referenced_paragraph": {
            "type": "INTEGER",
            "description": "答錯時段落索引，答對時 null",
            "nullable": True,
        },
    },
    "required": ["understood", "feedback", "question", "phase"],
}

TEST_CASES = [
    ("400",        False, "number 10x off"),
    ("不知道",     False, "lazy answer"),
    ("高山",       False, "too vague"),
    ("玉山在日本", False, "wrong fact"),
    ("大約四千公尺", True, "correct answer"),
    ("將近四千公尺", True, "direct quote"),
]

MODELS = [
    "gemini-2.5-flash",
]


def build_contents(student_answer: str) -> list[genai_types.Content]:
    return [
        genai_types.Content(role="user", parts=[genai_types.Part(text="請開始提問。")]),
        genai_types.Content(role="model", parts=[genai_types.Part(text="課文提到玉山的高度，請問玉山大約有多高呢？")]),
        genai_types.Content(role="user", parts=[genai_types.Part(text=student_answer)]),
    ]


def test_model(model_name: str):
    print(f"\n{'='*50}")
    print(f"  MODEL: {model_name}")
    print(f"{'='*50}")

    passed = 0
    total = len(TEST_CASES)

    for answer, expected, note in TEST_CASES:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=build_contents(answer),
                config=genai_types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=SCHEMA,
                    max_output_tokens=1024,
                    temperature=0.7,
                ),
            )
            raw = response.text
            try:
                result = json.loads(raw)
                actual = result.get("understood")
                ok = actual == expected
                if ok:
                    passed += 1
                icon = "  " if ok else ">>"
                status = "PASS" if ok else "FAIL"
                print(f"  {icon} {status} | '{answer}' → {actual} (expected {expected}) — {note}")
            except json.JSONDecodeError as je:
                print(f"  >> JSON_ERR | '{answer}' — {je}")
                print(f"     RAW: {raw[:300]}")
        except Exception as e:
            print(f"  >> ERROR | '{answer}' → {e}")

    pct = passed / total * 100
    print(f"\n  Result: {passed}/{total} ({pct:.0f}%)\n")


if __name__ == "__main__":
    for model in MODELS:
        test_model(model)
