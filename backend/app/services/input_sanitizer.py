"""
Prompt injection sanitizer for AI inputs.

Sanitizes user-provided text before it reaches Gemini AI calls
to prevent prompt injection attacks. Uses fast regex-based detection
(no AI calls for detection).

Issue #270: Prompt Injection 防護 — AI 批改輸入淨化
"""

import re
import logging

logger = logging.getLogger(__name__)

# Maximum allowed input length (prevent token stuffing)
MAX_INPUT_LENGTH = 2000

# Patterns that indicate prompt injection attempts
INJECTION_PATTERNS = [
    # English patterns
    r"ignore\s+(previous|above|all)(\s+\w+)*\s+(instructions?|prompts?|rules?)",
    r"you\s+are\s+now\s+",
    r"forget\s+(everything|all|previous)",
    r"system\s*:\s*",
    r"<\s*system\s*>",
    r"```\s*system",
    r"act\s+as\s+",
    r"pretend\s+(you|to\s+be)",
    r"new\s+instructions?\s*:",
    r"override\s+(previous|all)",
    r"disregard\s+(previous|above|all)",
    # Chinese equivalents
    r"忽略(之前|以上|所有)(的)?(指令|規則|提示)",
    r"你現在是",
    r"假裝(你是|成為)",
    r"新的指令",
    r"覆蓋(之前|所有)",
]

# Pre-compile patterns for performance
_COMPILED_PATTERNS = [
    re.compile(pattern, re.IGNORECASE) for pattern in INJECTION_PATTERNS
]


def sanitize_ai_input(text: str, user_id: str | None = None) -> tuple[str, bool]:
    """
    Sanitize user input before sending to AI.

    Args:
        text: Raw user input text.
        user_id: Optional user identifier for logging.

    Returns:
        Tuple of (sanitized_text, was_modified).
        was_modified is True if any injection patterns were found or
        the text was truncated.
    """
    if not text:
        return text, False

    was_modified = False
    sanitized = text

    for compiled_pattern in _COMPILED_PATTERNS:
        if compiled_pattern.search(sanitized):
            was_modified = True
            sanitized = compiled_pattern.sub("[已過濾]", sanitized)

    # Strip excessive whitespace/special chars that could be used for formatting attacks
    stripped = sanitized.strip()
    if stripped != sanitized:
        sanitized = stripped
        # Don't mark as modified for simple whitespace stripping

    # Length limit (prevent token stuffing)
    if len(sanitized) > MAX_INPUT_LENGTH:
        sanitized = sanitized[:MAX_INPUT_LENGTH]
        was_modified = True

    if was_modified:
        _log_injection_attempt(text, user_id)

    return sanitized, was_modified


def is_safe_input(text: str) -> bool:
    """Quick check if input contains injection attempts."""
    _, was_modified = sanitize_ai_input(text)
    return not was_modified


def _log_injection_attempt(original_text: str, user_id: str | None = None) -> None:
    """Log a detected prompt injection attempt."""
    truncated = original_text[:100]
    if len(original_text) > 100:
        truncated += "..."
    logger.warning(
        "Prompt injection attempt detected%s: %s",
        f" from user {user_id}" if user_id else "",
        truncated,
        extra={
            "event": "prompt_injection_detected",
            "user_id": user_id,
            "original_length": len(original_text),
        },
    )
