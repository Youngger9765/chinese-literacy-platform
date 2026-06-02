"""OMO lesson identification prompt builder.

Extracted from omo_identifier.py (#1886) — builds the Gemini structured prompt
for the image-based lesson identification task.  Pure string manipulation;
no I/O or Vertex AI dependency.
"""


def _build_identification_prompt(lessons: list[dict]) -> str:
    """Build the structured Gemini prompt for lesson identification.

    With the full 158-lesson corpus, we list only grade_code + title per entry
    (no story snippet or vocab) to keep prompt size manageable (~1300 tokens).
    Gemini matches by reading the visible title from the worksheet image.
    """
    lesson_list = "\n".join(
        f"  - {l['grade_code']}: \"{l['title']}\""
        for l in lessons
    )
    n = len(lessons)

    return f"""You are an AI reading assistant for a Taiwanese elementary/junior-high school platform.

A student uploaded a photo of a paper worksheet. Your task is to identify which of the following {n} known lessons this worksheet belongs to, by reading visible text in the image.

Known lessons:
{lesson_list}

Instructions:
1. Read all visible text in the image, especially the large title text at the top.
2. Extract the exact title you can read from the image. Put it in "extracted_title".
3. Find the best matching lesson from the known list by comparing the extracted title verbatim.
   IMPORTANT: If the extracted_title matches any known lesson title exactly or near-exactly,
   that candidate MUST have confidence >= 0.9. Do NOT assign low confidence to an exact match.
4. Return AT MOST 3 best-matching candidates, sorted by confidence (highest first).
5. Use confidence 0.0–1.0 where:
   - 0.95+ = extracted_title matches the lesson title exactly (character-for-character)
   - 0.85–0.94 = extracted_title is nearly identical (1-2 char difference)
   - 0.7–0.84 = partial title match
   - 0.4–0.69 = content/theme match without title
   - <0.4 = weak or speculative
6. Keep each `reasoning` to ≤ 15 Chinese characters. Be terse.

Respond ONLY with valid JSON in this exact format (no markdown, no explanation outside JSON):
{{
  "extracted_title": "<title text you could read from the image, or empty string>",
  "candidates": [
    {{
      "lesson_id": <integer from grade_code suffix, e.g. G5-L25 → 25>,
      "grade_code": "<string e.g. G5-L25>",
      "title": "<string matching the known lesson title exactly>",
      "confidence": <float 0.0-1.0>,
      "reasoning": "<≤15 Chinese characters>"
    }}
  ]
}}

If the image is too blurry or no text is readable, return:
{{
  "extracted_title": "",
  "candidates": [],
  "error": "image_unclear"
}}"""
