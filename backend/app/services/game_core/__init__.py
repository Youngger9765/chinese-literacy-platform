"""`game_core` — small, independently-reusable building blocks shared across
the student-self-serve game modes (PK, 迷城密室, and any future one shaped
like them: "student picks a lesson or a grade-pool, server resolves it to a
concrete lesson list").

This package holds ONLY code that was verified byte-identical (or
functionally identical) across at least two modes before being moved here
— see `docs/architecture/game-modules.md` for the audit that found each
piece. It is not a dumping ground for "things that feel shared"; a mode
that needs slightly different behavior keeps its own copy rather than
bending a shared function with extra flags (PK's and 迷城密室's
`resolve_pool_grade`/`validate_scope`/lesson-loading were verified
line-for-line identical including error strings — 多人對抗賽/team_arena's
equivalents were NOT moved here because they differ on purpose: different
user-facing error copy and no out-of-range grade guard, since that mode's
scope is server-resolved from the host's own profile, never user input).

live_quiz is intentionally NOT a consumer of this package — it is
teacher-hosted and takes an explicit list of `lesson_uid`s from the
teacher's selection UI, never a `scope_type`/`scope_ref` pair, so it has no
grade-pool-resolution step to share in the first place.
"""
