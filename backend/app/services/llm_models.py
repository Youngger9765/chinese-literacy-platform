"""Central per-task LLM model config.

Each task has its own (model, location) tuple chosen by A/B test.
See: docs/ai/llm-model-ab-2026-05.md

Decision rules (Issue #1734 — 2026-05-20):
  - gemini-flash-lite-latest @ global  →  all text/JSON generation tasks + OMO identifier
      Quality parity (3/3 complete) + 29-49% faster + 22-46% cheaper vs 2.5-flash
  - gemini-2.5-flash @ us-central1    →  OMO grader only (vision/spatial reasoning)
      Lettered circle accuracy 5/5 vs 1/5 (spatial reasoning gap)

OMO grader is LOCKED on gemini-2.5-flash per Issue #1730 — DO NOT change.
OMO identifier: moved to gemini-flash-lite-latest per Issue #1729 A/B (15/16 accuracy parity).
"""

from __future__ import annotations


# Model + location tuples per task.
# Key format: task name string used at call sites.
TASK_MODELS: dict[str, tuple[str, str]] = {
    # ── Chat / Question generation tasks ─────────────────────────────────────
    # Tested: 3/3 complete, -36% latency vs 2.5-flash
    "socratic_question": ("gemini-flash-lite-latest", "global"),
    # Tested: 3/3 complete JSON, -36% latency vs 2.5-flash
    "socratic_agent_process": ("gemini-flash-lite-latest", "global"),

    # ── Scoring / Evaluation tasks ────────────────────────────────────────────
    # Tested: 3/3 complete JSON (all required fields), -32% latency
    "comprehension_score": ("gemini-flash-lite-latest", "global"),
    # Tested: 3/3 complete JSON, -35% latency, correct is_correct logic
    "sentence_validate": ("gemini-flash-lite-latest", "global"),

    # ── Generation tasks ──────────────────────────────────────────────────────
    # Tested: 3/3 complete (≥3 MCQ with correct_index), -31% latency
    "exit_ticket_generate": ("gemini-flash-lite-latest", "global"),
    # Tested: 3/3 complete (2 sentences each), -31% latency
    "example_sentences": ("gemini-flash-lite-latest", "global"),
    # Tested: 3/3 complete (≥3 rows), -29% latency
    "story_structure": ("gemini-flash-lite-latest", "global"),
    # Tested: 3/3 complete (all 5 required fields), -49% latency
    "reading_analysis": ("gemini-flash-lite-latest", "global"),

    # ── Support tasks ─────────────────────────────────────────────────────────
    # Not A/B tested separately — same category as generation tasks, quality parity confirmed
    "teacher_comment": ("gemini-flash-lite-latest", "global"),

    # ── Vision / Multimodal tasks ─────────────────────────────────────────────
    # Per #1729 A/B (5/18): flash-lite-latest at global = 15/16 accuracy parity with 2.5-flash
    # Location: global (uses _get_client() default — no region-specific routing needed)
    "omo_identifier": ("gemini-flash-lite-latest", "global"),
    # LOCKED per #1730: lettered circle accuracy 5/5 vs 1/5, non-negotiable
    "omo_grader": ("gemini-2.5-flash", "us-central1"),
}


def get_model_for_task(task: str) -> tuple[str, str]:
    """Return (model_name, location) for the given task.

    Args:
        task: Task name key — must exist in TASK_MODELS.

    Returns:
        Tuple of (model_name, vertex_location).

    Raises:
        KeyError: If task is not registered. Add new tasks to TASK_MODELS.

    Example:
        model, location = get_model_for_task("socratic_question")
        client = genai.Client(vertexai=True, project="lingoleap-dev", location=location)
        response = client.models.generate_content(model=model, ...)
    """
    if task not in TASK_MODELS:
        raise KeyError(
            f"Unknown LLM task: {task!r}. "
            f"Register it in TASK_MODELS in backend/app/services/llm_models.py. "
            f"Known tasks: {sorted(TASK_MODELS.keys())}"
        )
    return TASK_MODELS[task]
