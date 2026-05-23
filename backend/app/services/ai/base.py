"""AI base utilities — retry constants, JSON repair, shared config.

NO google.genai imports in this module. Pure Python only.
Provider-specific clients live in gemini_client.py.
"""

import json
import logging

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds
GEMINI_TIMEOUT = 30  # seconds

CONTENT_FILTER_FRIENDLY_MSG = "老師小幫手暫時無法回答這個問題，請試試其他問法"


def _repair_json(raw: str) -> str | None:
    """Attempt basic JSON repair on a potentially truncated/malformed string.

    Strategy:
    1. Strip markdown code fences (```json ... ```)
    2. Walk forward tracking bracket depth and string state, recording every
       position where the outermost bracket closes (depth == 0).
    3. If the outermost bracket never closes (truncated mid-content):
       a. If still inside a string at the end (common MAX_TOKENS case where a
          `reasoning` value is cut mid-word), close the string first with `"`,
          then find the last close bracket outside that closed string.
       b. Truncate at the last close bracket, strip trailing commas, then append
          the closing brackets needed to balance the open bracket stack.

    Returns the repaired JSON string if successful, None otherwise.
    """
    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        # Remove opening fence (```json or ```)
        text = text[text.find("\n") + 1:] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[: text.rfind("```")]
    text = text.strip()

    if not text:
        return None

    # Must start with a JSON container
    if not text.startswith("{") and not text.startswith("["):
        return None

    # Walk forward tracking brackets and string state.
    # Build a stack of open brackets and record positions where depth returns to 0.
    last_balanced_pos = -1
    last_outer_close_pos = -1  # last pos of any `}` or `]` outside a string
    in_string = False
    escape_next = False
    bracket_stack: list[str] = []

    for i, ch in enumerate(text):
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ("{", "["):
            bracket_stack.append(ch)
        elif ch in ("}", "]"):
            if bracket_stack:
                bracket_stack.pop()
            if not bracket_stack:
                last_balanced_pos = i
            # Record last close bracket outside a string regardless of depth
            last_outer_close_pos = i

    # Case 1: JSON was complete — return the complete portion
    if last_balanced_pos != -1:
        return text[: last_balanced_pos + 1]

    # Case 2: Truncated — handle unclosed string first (MAX_TOKENS mid-value cut)
    # If we ended inside a string, append `"` to close it, then re-scan for the
    # last safe close bracket.  This is the dominant failure mode for OMO
    # identifier where Gemini cuts the `reasoning` field mid-word.
    working = text
    if in_string:
        working = working + '"'
        # Re-scan to find last outer close bracket in the string-closed version
        last_outer_close_pos = -1
        _in_string = False
        _escape_next = False
        for i, ch in enumerate(working):
            if _escape_next:
                _escape_next = False
                continue
            if ch == "\\" and _in_string:
                _escape_next = True
                continue
            if ch == '"':
                _in_string = not _in_string
                continue
            if _in_string:
                continue
            if ch in ("}", "]"):
                last_outer_close_pos = i

    # Case 2b: still no close bracket (truncated before any `}` or `]`).
    # This happens when Gemini cuts mid-key-name inside the first candidate.
    # Strategy: strip back to the last complete value before the truncation point
    # by finding the last comma that is outside a string and outside any nested
    # brackets, then inject the minimum closing brackets.
    if last_outer_close_pos == -1:
        # Walk working text to find last comma at top-level of innermost object
        last_comma_pos = -1
        _in_string = False
        _escape_next = False
        _stack: list[str] = []
        for i, ch in enumerate(working):
            if _escape_next:
                _escape_next = False
                continue
            if ch == "\\" and _in_string:
                _escape_next = True
                continue
            if ch == '"':
                _in_string = not _in_string
                continue
            if _in_string:
                continue
            if ch in ("{", "["):
                _stack.append(ch)
            elif ch in ("}", "]"):
                if _stack:
                    _stack.pop()
            elif ch == "," and _stack:
                last_comma_pos = i

        if last_comma_pos == -1:
            return None

        # Truncate at last comma, strip trailing whitespace
        stripped = working[:last_comma_pos].rstrip()

        # Rebuild bracket stack for this stripped version
        _in_string = False
        _escape_next = False
        close_stack2: list[str] = []
        for ch in stripped:
            if _escape_next:
                _escape_next = False
                continue
            if ch == "\\" and _in_string:
                _escape_next = True
                continue
            if ch == '"':
                _in_string = not _in_string
                continue
            if _in_string:
                continue
            if ch in ("{", "["):
                close_stack2.append(ch)
            elif ch in ("}", "]"):
                if close_stack2:
                    close_stack2.pop()

        closing2 = ""
        for opener in reversed(close_stack2):
            closing2 += "}" if opener == "{" else "]"

        candidate2 = stripped + closing2
        try:
            parsed2 = json.loads(candidate2)
            # Only accept if we got at least an empty candidates array
            if isinstance(parsed2, dict) and "candidates" in parsed2:
                return candidate2
        except (json.JSONDecodeError, ValueError):
            pass
        return None

    truncated = working[: last_outer_close_pos + 1].rstrip().rstrip(",").rstrip()

    # Rebuild bracket stack for the truncated portion to know what to close
    _in_string = False
    _escape_next = False
    close_stack: list[str] = []

    for ch in truncated:
        if _escape_next:
            _escape_next = False
            continue
        if ch == "\\" and _in_string:
            _escape_next = True
            continue
        if ch == '"':
            _in_string = not _in_string
            continue
        if _in_string:
            continue
        if ch in ("{", "["):
            close_stack.append(ch)
        elif ch in ("}", "]"):
            if close_stack:
                close_stack.pop()

    # Append the matching closing brackets in reverse
    closing = ""
    for opener in reversed(close_stack):
        closing += "}" if opener == "{" else "]"

    candidate = truncated + closing
    try:
        json.loads(candidate)
        return candidate
    except (json.JSONDecodeError, ValueError):
        pass

    return None
