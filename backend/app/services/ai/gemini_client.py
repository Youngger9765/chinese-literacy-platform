"""Gemini / Vertex AI client — safety filter, structured response generation.

All google.genai imports are confined to this module.
Provider-agnostic utilities (retry constants, JSON repair) live in base.py.
"""

import asyncio
import json
import logging

from google import genai
from google.genai import types as genai_types

from ..ai_usage_tracker import capture_usage, last_usage
from ..llm_models import get_model_for_task
from .base import (
    CONTENT_FILTER_FRIENDLY_MSG,  # noqa: F401 — re-exported for callers
    GEMINI_TIMEOUT,
    MAX_RETRIES,
    RETRY_BASE_DELAY,
    _repair_json,
)

logger = logging.getLogger(__name__)


class GeminiContentFilterError(Exception):
    """Raised when Gemini refuses a response due to its safety/content filter.

    This is NOT an API error — Gemini returned a valid response, but blocked
    the content. Callers should return a friendly fallback to the student
    instead of a 500 error.
    """


def _check_safety_filter(response) -> None:
    """Inspect a Gemini response and raise GeminiContentFilterError if blocked.

    Checks three signals (in order of reliability):
    1. response.candidates is empty — entire prompt was blocked
    2. candidates[0].finish_reason == SAFETY — output was blocked mid-generation
    3. response.prompt_feedback.block_reason is set — prompt-level block

    Must be called BEFORE accessing response.text, which raises a confusing
    ValueError when the response has no content due to safety filtering.
    """
    # Signal 1: no candidates at all (prompt-level block)
    if not response.candidates:
        block_reason = None
        try:
            block_reason = str(response.prompt_feedback.block_reason)
        except Exception:
            pass
        logger.warning(
            "Gemini content filter: no candidates returned (block_reason=%s)",
            block_reason,
            extra={"event": "gemini_content_filter", "block_reason": block_reason},
        )
        raise GeminiContentFilterError(
            f"Gemini blocked response (no candidates, block_reason={block_reason})"
        )

    # Signal 2: finish_reason == SAFETY
    finish_reason = str(response.candidates[0].finish_reason)
    if "SAFETY" in finish_reason:
        logger.warning(
            "Gemini content filter: finish_reason=SAFETY",
            extra={"event": "gemini_content_filter", "finish_reason": finish_reason},
        )
        raise GeminiContentFilterError(
            f"Gemini blocked response (finish_reason={finish_reason})"
        )

    # Signal 3: prompt_feedback.block_reason set but candidates exist (edge case)
    try:
        block_reason = response.prompt_feedback.block_reason
        if block_reason and str(block_reason) not in ("0", "BLOCK_REASON_UNSPECIFIED", "None"):
            logger.warning(
                "Gemini content filter: prompt_feedback.block_reason=%s",
                block_reason,
                extra={"event": "gemini_content_filter", "block_reason": str(block_reason)},
            )
            raise GeminiContentFilterError(
                f"Gemini blocked response (prompt_feedback.block_reason={block_reason})"
            )
    except GeminiContentFilterError:
        raise
    except Exception:
        # prompt_feedback attribute may not exist on all response types — safe to ignore
        pass


def _get_client() -> genai.Client:
    """Return a Gemini client via Vertex AI (uses Cloud Run service account).

    Uses global location for non-OMO tasks. For task-specific routing use
    _get_client_for_task() which respects TASK_MODELS config.
    """
    return genai.Client(vertexai=True, project="lingoleap-dev", location="global")


def _get_client_for_task(task: str) -> tuple[genai.Client, str]:
    """Return (client, model_name) for a registered task.

    Looks up the (model, location) from llm_models.TASK_MODELS and creates
    the appropriate Vertex AI client for that location.

    Args:
        task: Task name key — must be registered in TASK_MODELS.

    Returns:
        Tuple of (genai.Client, model_name_str).
    """
    model, location = get_model_for_task(task)
    client = genai.Client(vertexai=True, project="lingoleap-dev", location=location)
    return client, model


async def generate_structured_response(
    system_prompt: str,
    contents: list[genai_types.Content],
    response_schema: dict,
    max_tokens: int = 4096,
    temperature: float = 0.7,
    task: str = "comprehension_score",
) -> dict:
    """Call Gemini with JSON mode, return parsed dict.

    Uses response_mime_type="application/json" and response_schema
    to get structured JSON output from Gemini.

    Args:
        task: Task name registered in llm_models.TASK_MODELS. Determines which
              model + location to use. Defaults to "comprehension_score" (flash-lite,
              global) for backward compatibility with untagged callers.

        Notes:
        - Disable thinking for deterministic schema-bound JSON tasks so token
            budget is preserved for visible output (avoids premature MAX_TOKENS).
        - Disable automatic function calling because this helper never passes
            tools and does not need AFC orchestration overhead.
    """
    # Reset usage context var so error paths don't log stale data from
    # a previous request (FAIL-3 review fix).
    last_usage.set(None)

    client, _model = _get_client_for_task(task)
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    client.models.generate_content,
                    model=_model,
                    contents=contents,
                    config=genai_types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        max_output_tokens=max_tokens,
                        temperature=temperature,
                        thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                        automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(
                            disable=True
                        ),
                    ),
                ),
                timeout=GEMINI_TIMEOUT,
            )

            # Check for safety filter BEFORE accessing response.text.
            # When Gemini blocks content, response.text raises a confusing
            # ValueError. We intercept this with a clear, named exception.
            _check_safety_filter(response)

            # Capture token usage metadata for tracking (Issue #874)
            # Estimate prompt char count from system_prompt + contents text parts
            _prompt_chars = len(system_prompt) if system_prompt else 0
            try:
                for c in contents:
                    for p in (c.parts or []):
                        if hasattr(p, "text") and p.text:
                            _prompt_chars += len(p.text)
            except Exception:
                pass
            usage_meta = capture_usage(response, model=_model)
            usage_meta.prompt_char_count = _prompt_chars

            # Extract finish_reason for diagnostics (MAX_TOKENS = truncated output)
            finish_reason = None
            if response.candidates:
                finish_reason = str(response.candidates[0].finish_reason)

            # Log raw response for debugging (truncated to avoid log spam)
            raw_text = response.text if response.text is not None else ""
            logger.debug(
                "Gemini raw response finish_reason=%s length=%d (first 500 chars): %s",
                finish_reason,
                len(raw_text),
                raw_text[:500],
                extra={
                    "event": "gemini_raw_response",
                    "finish_reason": finish_reason,
                    "length": len(raw_text),
                },
            )

            if not raw_text:
                raise ValueError("Gemini returned empty/None response text")

            # When finish_reason is MAX_TOKENS the output was cut mid-stream.
            # Attempt JSON repair immediately before trying json.loads so we
            # can recover partial responses without burning a retry cycle.
            if finish_reason == "FinishReason.MAX_TOKENS":
                logger.warning(
                    "Gemini finish_reason=MAX_TOKENS — output was truncated "
                    "(max_tokens=%d, raw_len=%d). Attempting JSON repair.",
                    max_tokens,
                    len(raw_text),
                    extra={
                        "event": "gemini_max_tokens_truncation",
                        "max_tokens": max_tokens,
                        "raw_len": len(raw_text),
                        "attempt": attempt + 1,
                    },
                )
                repaired = _repair_json(raw_text)
                if repaired is not None:
                    try:
                        result = json.loads(repaired)
                        logger.warning(
                            "JSON repair after MAX_TOKENS succeeded "
                            "(original_len=%d, repaired_len=%d)",
                            len(raw_text),
                            len(repaired),
                            extra={"event": "gemini_json_repair_success"},
                        )
                        return result
                    except json.JSONDecodeError:
                        pass
                # Repair failed — fall through to regular json.loads which
                # will raise and trigger the retry loop.

            try:
                return json.loads(raw_text)
            except json.JSONDecodeError as json_err:
                logger.warning(
                    "JSON parse failed finish_reason=%s (%s), attempting repair. "
                    "Raw (first 200): %s",
                    finish_reason,
                    json_err,
                    raw_text[:200],
                    extra={"event": "gemini_json_repair_attempt", "finish_reason": finish_reason},
                )
                repaired = _repair_json(raw_text)
                if repaired is not None:
                    try:
                        result = json.loads(repaired)
                        logger.warning(
                            "JSON repair succeeded (original_len=%d, repaired_len=%d)",
                            len(raw_text),
                            len(repaired),
                            extra={"event": "gemini_json_repair_success"},
                        )
                        return result
                    except json.JSONDecodeError:
                        pass
                # Repair failed — raise original error so retry logic handles it
                raise json_err

        except GeminiContentFilterError:
            # Safety filter is deterministic — no point retrying.
            # Propagate immediately so callers can return a friendly response.
            raise
        except asyncio.TimeoutError:
            logger.error(
                "Gemini API timeout after %ds",
                GEMINI_TIMEOUT,
                extra={
                    "event": "gemini_timeout",
                    "timeout_seconds": GEMINI_TIMEOUT,
                    "attempt": attempt + 1,
                },
            )
            raise TimeoutError(f"AI response timeout ({GEMINI_TIMEOUT}s)")
        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "Gemini API attempt %d failed: %s. Retrying in %.1fs",
                    attempt + 1,
                    e,
                    delay,
                    extra={
                        "event": "gemini_retry",
                        "attempt": attempt + 1,
                        "error": str(e),
                        "retry_delay_seconds": delay,
                    },
                )
                await asyncio.sleep(delay)
            else:
                logger.error(
                    "Gemini API failed after %d attempts: %s",
                    MAX_RETRIES,
                    e,
                    extra={
                        "event": "gemini_failure",
                        "total_attempts": MAX_RETRIES,
                        "error": str(e),
                    },
                )

    raise last_error
