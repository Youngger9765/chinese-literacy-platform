"""
AI API calls — all AI model interactions are centralised here.

Rules (from CLAUDE.md):
  - ALL AI API calls must live in this file only.
  - The frontend never calls AI APIs directly.
  - Used for: Socratic comprehension Q&A (Step 3), exit-ticket
    generation and grading (Step 6).
  - STT/TTS use browser-native APIs and are NOT routed through here.
"""

import json

from google import genai
from google.genai import types as genai_types

from ..config import settings


def _get_client() -> genai.Client:
    """Return a Gemini client via Vertex AI (uses Cloud Run service account)."""
    return genai.Client(vertexai=True, project="lingoleap-dev", location="asia-east1")


async def generate_structured_response(
    system_prompt: str,
    contents: list[genai_types.Content],
    response_schema: dict,
    max_tokens: int = 256,
    temperature: float = 0.7,
) -> dict:
    """Call Gemini with JSON mode, return parsed dict.

    Uses response_mime_type="application/json" and response_schema
    to get structured JSON output from Gemini.
    """
    client = _get_client()
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=contents,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            response_schema=response_schema,
            max_output_tokens=max_tokens,
            temperature=temperature,
        ),
    )
    return json.loads(response.text)


# Deprecated: use SocraticAgent.process_answer() for new code.
# Kept for backward compatibility with POST /comprehension/question.
async def generate_socratic_question(
    story_title: str,
    story_text: str,
    conversation: list[dict],
) -> str:
    """
    Generate a Socratic follow-up question based on the story and conversation
    history. Returns a warm, encouraging question in Traditional Chinese.

    Args:
        story_title: Title of the story being discussed.
        story_text: Full text of the story (paragraphs joined with newlines).
        conversation: List of {"role": "ai"|"student", "text": str} dicts,
                      ordered oldest-first. Empty for the first question.

    Returns:
        A single Socratic question as a string.
    """
    system_prompt = f"""你是一位溫暖、鼓勵學生的繁體中文閱讀助教，擅長用蘇格拉底式問答引導學生思考課文。

課文標題：{story_title}

課文內容：
{story_text}

請根據課文內容和對話歷史，提出一個有意義的問題。

規則：
- 每次只問一個問題
- 問題由淺入深：
  * 第一題：事實性（誰、什麼、在哪裡、發生什麼事）
  * 第二題：推論性（為什麼、怎麼會這樣、有什麼影響）
  * 第三題：評估性（你覺得、如果是你、這個故事告訴我們什麼）
- 語氣溫暖、友善，適合小學高年級至國中生
- 只用繁體中文
- 直接輸出問題本身，不要加「好問題！」「你說得對！」等前綴
- 問題長度：15–40 個字"""

    # Build Gemini contents — roles are "user" and "model"
    # Seed with a fixed user message so the conversation always starts with "user"
    contents: list[genai_types.Content] = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text="請開始提問。")],
        )
    ]

    for turn in conversation:
        role = "model" if turn["role"] == "ai" else "user"
        contents.append(
            genai_types.Content(
                role=role,
                parts=[genai_types.Part(text=turn["text"])],
            )
        )

    # Ensure the last content is from "user" so Gemini responds as "model"
    if contents[-1].role == "model":
        contents.append(
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text="請繼續提問。")],
            )
        )

    client = _get_client()
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=contents,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=128,
            temperature=0.7,
        ),
    )
    return response.text.strip()


async def generate_exit_ticket(text: str) -> list[dict]:
    """
    Generate exit-ticket questions for a story text.
    Returns a list of question dicts: [{"question": str, "type": str}, ...]

    Stub: returns placeholder questions until implemented (Step 6).
    """
    # TODO: implement with Gemini API (Step 6)
    return [
        {"question": "這篇文章的主角是誰？", "type": "short_answer"},
        {"question": "作者想要告訴我們什麼道理？", "type": "short_answer"},
    ]


async def grade_exit_ticket(question: str, student_answer: str, reference_text: str) -> dict:
    """
    Grade a student's exit-ticket answer.
    Returns {"score": int, "feedback": str} with score 0–100.

    Stub: returns placeholder until implemented (Step 6).
    """
    # TODO: implement with Gemini API (Step 6)
    return {"score": 0, "feedback": "批改功能尚未實作"}
