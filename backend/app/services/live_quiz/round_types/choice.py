"""The ``choice`` round type — single-answer A-D multiple choice.

Today's only round type. Wraps the question-source adapters (comprehension /
vocab_definitions / vocab_application / zhuyin) registered in
``live_quiz/sources/__init__.py``: it does not know how any of them build a
question, only that each one returns ``QuizItem`` objects.
"""
from __future__ import annotations

import random

from .. import reading_pace
from ..sources import SOURCE_ADAPTERS
from ..sources.base import QuizItem, _option_to_dict, warn_skipped_once

NAME = "choice"

# PRD §4 老師端選題: 每題秒數 20/30/45/60.
ALLOWED_SECONDS = (20, 30, 45, 60)
DEFAULT_SECONDS = 30
# issue #3631 P0 #1: kept only as the fallback for the OLD meaning of this
# constant (a single fixed delay) — no caller reads it for that purpose any
# more. `generate_rounds` below now computes `reading_seconds` PER ITEM from
# the item's own stem length via `reading_pace.compute_reading_seconds`
# (teacher picks a 慢/標準/快 preset, not a raw second count). The one
# exception is an explicit `settings["reading_seconds"]` override — PK uses
# this to force `0` (no reading phase at all) for every item regardless of
# length; see `app/services/pk/rounds.py`.
DEFAULT_READING_SECONDS = reading_pace.MIN_READING_SECONDS
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
            # #3610: backstop — an adapter blowing up on ONE lesson's data
            # must not fail the whole pool (that turned every grade-6 PK
            # request into a 500). Skip that lesson×module, log once.
            try:
                pool.extend(adapter(uid, lesson, rng))
            except (ValueError, TypeError, KeyError) as exc:
                warn_skipped_once(f"{module}:{uid}", f"adapter failed: {exc}")
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

    #3621: this used to rebuild each option as a bare ``{"key", "text"}``
    dict by hand, which silently dropped ``QuizOption.image`` — a handful
    of comprehension options are a picture, not text (「下列哪一張圖…」),
    and this rebuild is the one place between the source adapter and the
    frozen payload that could lose that field without anything failing
    loudly. It now goes through the same ``_option_to_dict`` helper
    ``to_payload`` uses, so the two can't drift apart again.
    """
    pairs = [(o, o.key == item.correct_key) for o in item.options]
    rng.shuffle(pairs)
    keys = _KEYS[: len(pairs)]
    options = [{**_option_to_dict(opt), "key": k} for k, (opt, _is_correct) in zip(keys, pairs)]
    correct_key = next(k for k, (_opt, is_correct) in zip(keys, pairs) if is_correct)
    return options, correct_key


def generate_rounds(lessons: list[dict], settings: dict, rng: random.Random) -> tuple[list[dict], bool]:
    """Build frozen round snapshot entries for a brand-new game.

    ``settings`` keys used here: ``source_modules`` (list[str]),
    ``seconds`` (int), ``question_count_mode`` ("all" | 10 | 15 | 20),
    ``shuffle`` (bool, round ORDER — not to be confused with the per-item
    display-position shuffle below, which always happens).

    issue #3631 P0 #1 — reading time, two mutually exclusive settings keys:
      ``reading_seconds`` (int, explicit) — if present, EVERY round gets
        exactly this value regardless of its own stem length. This is the
        escape hatch `app/services/pk/rounds.py` uses to force `0` (no
        reading phase at all); nothing in live_quiz's own public API sets
        this any more, but the mechanism stays so PK (and any future
        internal caller) never has to go through a pace preset.
      ``reading_pace`` (str, "slow"|"standard"|"fast", default "standard")
        — used only when ``reading_seconds`` is absent. Each round's
        reading_seconds is computed from ITS OWN stem length via
        ``reading_pace.compute_reading_seconds`` — a long comprehension
        question and a two-character zhuyin stem in the SAME game get
        different reading windows.

    Returns ``(rounds, question_count_fallback)``. UI/UX review 2026-10-15
    #8: if the selected lessons/types produce FEWER items than the
    requested count, use all available items and report the shortfall via
    the second tuple element (the engine persists it onto
    ``game.settings["question_count_fallback"]`` so the create-game
    response and a later host revisit can both show the notice).
    """
    source_modules = settings.get("source_modules") or list(SOURCE_ADAPTERS.keys())
    seconds = settings.get("seconds", DEFAULT_SECONDS)
    explicit_reading_seconds = settings.get("reading_seconds")
    pace = settings.get("reading_pace", reading_pace.DEFAULT_PACE)
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
        if explicit_reading_seconds is not None:
            payload["reading_seconds"] = int(explicit_reading_seconds)
        else:
            # Critic review note (2026-10-18): this reuses
            # `scorable_char_count`, whose own docstring says it is "NOT
            # fine as a scoring input" — that caveat is about using it to
            # grade a reading, not about counting roughly how many
            # characters a stem has. `reading_pace.compute_reading_seconds`
            # already documents this as an ESTIMATE (no first-party
            # measurement of students' silent recognition speed exists),
            # and the MIN/MAX clamp keeps a bad estimate from ever reaching
            # an absurd value either way.
            payload["reading_seconds"] = reading_pace.compute_reading_seconds(item.stem, pace)
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

    Critic review note (2026-10-18): the ``payload.get("reading_seconds",
    DEFAULT_READING_SECONDS)`` fallback a few lines below is intentionally
    dead in practice — ``generate_rounds`` always sets ``reading_seconds``
    on every payload it builds (explicit override or pace-computed), so
    this only matters for a hand-built payload in a test. It is NOT an
    oversight that ``DEFAULT_READING_SECONDS`` now aliases
    ``reading_pace.MIN_READING_SECONDS`` (2, was the literal ``4`` before
    #3631) — it is just "the lowest sane value" as a safety net, not a
    meaningful default any real caller relies on.
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
        # issue #3631 P0 #2: "看解析" — same gate as correct_key (no point
        # showing a rationale for an answer the caller can't see yet), and
        # omitted (not null) when this question has no explanation text so
        # the frontend can treat "key present" as "there is a button to show".
        if payload.get("explanation"):
            view["explanation"] = payload["explanation"]
    return view
