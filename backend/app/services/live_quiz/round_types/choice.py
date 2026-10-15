"""The ``choice`` round type — single-answer A-D multiple choice.

Today's only round type. Wraps the question-source adapters (comprehension /
vocab_definitions / vocab_application / zhuyin) registered in
``live_quiz/sources/__init__.py``: it does not know how any of them build a
question, only that each one returns ``QuizItem`` objects.
"""
from __future__ import annotations

import random

from ..sources import SOURCE_ADAPTERS
from ..sources.base import QuizItem

NAME = "choice"

# PRD §4 老師端選題: 每題秒數 20/30/45/60.
ALLOWED_SECONDS = (20, 30, 45, 60)
DEFAULT_SECONDS = 30
# UI/UX review 2026-10-15 #2: "reading phase" — stem shown alone before the
# answer window opens. 0 means no delay (the old behaviour).
DEFAULT_READING_SECONDS = 4
_KEYS = ("A", "B", "C", "D")

# Bumped only if the scoring FORMULA below changes — lets a recompute/audit
# tool (external review #2) tell "this answer was scored under an older
# rule" apart from "the stored points are wrong".
SCORING_RULE_VERSION = 1


def _collect_items(lessons: list[dict], source_modules: list[str], rng: random.Random) -> list[QuizItem]:
    """lessons: [{"lesson_uid": ..., "lesson": <load_lesson() dict>}, ...]."""
    pool: list[QuizItem] = []
    for lesson_entry in lessons:
        uid = lesson_entry["lesson_uid"]
        lesson = lesson_entry["lesson"]
        for module in source_modules:
            adapter = SOURCE_ADAPTERS.get(module)
            if adapter is None:
                continue
            pool.extend(adapter(uid, lesson, rng))
    return pool


def _shuffle_display_positions(item: QuizItem, rng: random.Random) -> tuple[list[dict], str]:
    """Re-roll WHICH position each option text sits at, per game.

    External review #1a: an unauthenticated public endpoint
    (``GET /api/stories/{id}``) already exposes a comprehension question's
    source-material answer LETTER. A source adapter's A/B/C/D is that
    source letter — without this shuffle, a round's ``correct_key`` would
    always equal it, so anyone could read the public endpoint's letter and
    use it directly against this game.

    What this actually defends against: that one narrow attack (matching
    the LEAKED LETTER against this game's correct_key). Re-deriving
    ``correct_key`` from a per-game seeded shuffle means the served
    correct_key means "the correct shape is in position C of THIS game",
    not "the source material's answer is C" — so the leaked letter alone
    is useless here.

    What this does NOT defend against (external review #2, 2026-10-15 —
    do not read this as "the leak is handled"): that same public endpoint
    also returns the option TEXTS, not just the letter. A student can read
    the correct option's literal text from the public endpoint and match
    it against whichever on-screen position this game's shuffle happens
    to have put it in — the shuffle changes WHERE the text sits, it
    doesn't hide the text itself, so text-based lookup bypasses this
    entirely. The real fix is #3555 (stop the public lesson API from
    shipping answers in the first place); that is a separate module/PR,
    not this one — do not treat this shuffle as a substitute for it.

    Fixed single-answer-per-key for a given game.seed; a different game
    re-rolls the shuffled seed and gets a different arrangement.

    This is the only place option order is decided for what actually ships
    in the frozen snapshot — an adapter's own option order
    (``QuizItem.options``) never reaches a payload unshuffled.
    """
    pairs = [(o.text, o.key == item.correct_key) for o in item.options]
    rng.shuffle(pairs)
    keys = _KEYS[: len(pairs)]
    options = [{"key": k, "text": text} for k, (text, _is_correct) in zip(keys, pairs)]
    correct_key = next(k for k, (_text, is_correct) in zip(keys, pairs) if is_correct)
    return options, correct_key


def generate_rounds(lessons: list[dict], settings: dict, rng: random.Random) -> tuple[list[dict], bool]:
    """Build frozen round snapshot entries for a brand-new game.

    ``settings`` keys used here: ``source_modules`` (list[str]),
    ``seconds`` (int), ``reading_seconds`` (int), ``question_count_mode``
    ("all" | 10 | 15 | 20), ``shuffle`` (bool, round ORDER — not to be
    confused with the per-item display-position shuffle below, which
    always happens).

    Returns ``(rounds, question_count_fallback)``. UI/UX review 2026-10-15
    #8: if the selected lessons/types produce FEWER items than the
    requested count, use all available items and report the shortfall via
    the second tuple element (the engine persists it onto
    ``game.settings["question_count_fallback"]`` so the create-game
    response and a later host revisit can both show the notice).
    """
    source_modules = settings.get("source_modules") or list(SOURCE_ADAPTERS.keys())
    seconds = settings.get("seconds", DEFAULT_SECONDS)
    reading_seconds = settings.get("reading_seconds", DEFAULT_READING_SECONDS)
    count_mode = settings.get("question_count_mode", "all")

    pool = _collect_items(lessons, source_modules, rng)

    fallback_used = False
    if count_mode != "all":
        n = int(count_mode)
        if n < len(pool):
            pool = rng.sample(pool, n)
        elif n > len(pool):
            fallback_used = True

    if settings.get("shuffle"):
        pool = list(pool)
        rng.shuffle(pool)

    rounds = []
    for i, item in enumerate(pool):
        options, correct_key = _shuffle_display_positions(item, rng)
        payload = item.to_payload(seconds)
        payload["options"] = options
        payload["correct_key"] = correct_key
        payload["scoring_version"] = SCORING_RULE_VERSION
        payload["reading_seconds"] = reading_seconds
        rounds.append({"round_index": i, "round_type": NAME, "payload": payload})
    return rounds, fallback_used


def score_submission(payload: dict, submission: dict, elapsed_ms: int) -> tuple[bool, int]:
    """PRD §4 計分: 答對 500 + 速度加分最多 500（越快越多）；答錯／未答 0.

    Formula (PRD §9 original wording): correct -> 500 +
    round(500 * (1 - elapsed/limit)) clamped 500..1000, else 0.

    Pure function of (payload, submission, elapsed_ms) only — this is what
    makes an answer recomputable from stored data alone (external review
    #2): replay this with the frozen round payload + the stored submission +
    stored elapsed_ms and you get the exact same (is_correct, base_points)
    every time, regardless of when or in what process it runs.
    """
    choice_key = submission.get("choice_key") if isinstance(submission, dict) else None
    correct_key = payload.get("correct_key")
    is_correct = bool(choice_key) and choice_key == correct_key
    if not is_correct:
        return False, 0

    seconds = payload.get("seconds", DEFAULT_SECONDS)
    limit_ms = max(1, int(seconds) * 1000)
    elapsed_clamped = max(0, min(int(elapsed_ms), limit_ms))
    speed_bonus = round(500 * (1 - elapsed_clamped / limit_ms))
    points = 500 + speed_bonus
    points = max(500, min(1000, points))
    return True, points


def player_view(payload: dict, revealed: bool, show_options: bool = True) -> dict:
    """Role-aware, answer-safe payload. ``revealed=False`` omits ``correct_key``
    entirely (not just blanks it) — CTO review: devtools must not see it.

    ``show_options=False`` (UI/UX review #2, the reading phase) ALSO omits
    ``options`` — the server enforces "stem alone for N seconds" rather than
    trusting the client's local countdown, the same fail-closed posture as
    hiding ``correct_key`` pre-reveal.
    """
    view = {
        "item_id": payload.get("item_id"),
        "source_module": payload.get("source_module"),
        "lesson_uid": payload.get("lesson_uid"),
        "lesson_title": payload.get("lesson_title"),
        "stem": payload.get("stem"),
        "seconds": payload.get("seconds"),
        "reading_seconds": payload.get("reading_seconds", DEFAULT_READING_SECONDS),
    }
    if show_options:
        view["options"] = payload.get("options")
    if "extra" in payload:
        # e.g. zhuyin's {"target_index": N} — never the answer itself, safe
        # to show in every phase (UI/UX review #10).
        view["extra"] = payload["extra"]
    if revealed:
        view["correct_key"] = payload.get("correct_key")
    return view
