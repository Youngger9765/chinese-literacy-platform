"""`game_core` — small, independently-reusable building blocks shared across
the student-self-serve game modes (PK, 迷城密室, and any future one shaped
like them: "student picks a lesson or a grade-pool, server resolves it to a
concrete lesson list").

`scope.py` holds code that was verified byte-identical (or functionally
identical, by product decision) across the modes that use it — see
`docs/architecture/game-modules.md` for the audit that found each piece.
It is not a dumping ground for "things that feel shared"; a mode that
needs genuinely different behavior keeps its own copy rather than bending
a shared function with extra flags. PK's and 迷城密室's `resolve_pool_grade`/
`validate_scope`/lesson-loading were verified line-for-line identical
including error strings (issue #3663 round 1). 多人對抗賽/team_arena's
`resolve_pool_grade` was NOT moved here in round 1 — it was missing the
out-of-range grade guard and had different user-facing error copy — but as
of round 3 (#3673, product-authorized: nothing pinned team_arena's own
error text, so the shared copy's text is now used there too) team_arena
IS a third consumer of this exact function, imported the same way PK and
迷城密室 import it.

live_quiz is intentionally NOT a consumer of `scope.py` — it is
teacher-hosted and takes an explicit list of `lesson_uid`s from the
teacher's selection UI, never a `scope_type`/`scope_ref` pair, so it has no
grade-pool-resolution step to share in the first place.

`modes.py` (added issue #3663 round 2) is a different kind of module: a
DECLARED fact sheet (which modes exist, their classroom-gating facts), not
an extraction of previously-duplicated executable logic. Its `FEATURE_DEFAULTS`
dict and the two legacy-usage probe functions ARE literal moves (from the
old `services/pk/classroom_features.py`); the `GameMode` dataclass and the
five `GameMode(...)` entries are new synthesis written to document facts
that were previously only implicit across several files — see that
module's own docstring.
"""
