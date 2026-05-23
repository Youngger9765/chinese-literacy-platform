"""OMO scoring utilities — pure-Python answer comparison and anti-fabrication.

Extracted from omo_grader.py (issue #1879).

Responsibilities:
  - _LOW_CONFIDENCE_THRESHOLD: module-level constant (0.7); answers below this
    are coerced to empty and flagged for teacher review (#1715)
  - _score_answer: pure-Python comparison of student OCR output vs correct answer
  - _validate_student_answer: anti-fabrication guard — coerces answers not in
    allowed_values to empty string (#1712)

No I/O, no LLM calls — safe to unit-test without mocking.
"""

# #1715: answers with self-reported confidence below this threshold are coerced
# to empty + flagged for teacher review. Chosen generic (not tuned to specific
# PDFs/handwriting/devices) so it generalizes across student worksheets.
_LOW_CONFIDENCE_THRESHOLD = 0.7


def _score_answer(student: str, correct: str, qtype: str) -> float:
    """Compare student OCR output against YAML correct_answer. Pure Python — no LLM.

    Rules:
    - Empty student → 0.0 (could not OCR / blank)
    - Exact match (after strip + lowercase for letters) → 1.0
    - MC: letter comparison case-insensitive
    - Fill-blank: exact string match required (educational rigor)
    - Otherwise → 0.0
    """
    s = (student or "").strip()
    c = (correct or "").strip()
    if not s:
        return 0.0
    if qtype == "multiple_choice":
        return 1.0 if s.upper() == c.upper() else 0.0
    return 1.0 if s == c else 0.0


def _validate_student_answer(student: str, question: dict) -> tuple[str, bool]:
    """Coerce fabricated student_answer to empty (#1712 fix).

    A valid answer is either:
    - Empty string (Gemini saw nothing / wasn't sure)
    - A value in `question['allowed_values']` (case-insensitive for letters,
      exact match for words; also accepts a letter that resolves to a vocab
      word in the lettered list — Gemini sometimes returns the word instead).

    Anything else (e.g. 「良好」when allowed = {A,B,C,D,E,F,G,""}) is treated
    as fabrication: coerce to "" and signal coercion happened.

    Returns:
        (sanitized_answer, was_fabricated)
    """
    s = (student or "").strip()
    if not s:
        return "", False
    allowed = question.get("allowed_values") or []
    mode = question.get("mode", "free_form")
    if mode == "lettered":
        # Accept the letter itself
        if len(s) == 1 and s.upper() in [a.upper() for a in allowed]:
            return s.upper(), False
        return "", True
    # free_form: exact word match (case-sensitive — Chinese characters)
    if s in allowed:
        return s, False
    return "", True
