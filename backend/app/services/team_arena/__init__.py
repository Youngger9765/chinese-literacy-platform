"""五人對抗賽 (team_arena) — PRD docs/prd/2026-10-18-team-arena-prd.md, issue #3632.

Independent module (same four independence rules `live_quiz`/`pk`/`escape_room`
already established): reads `live_quiz`'s question-source adapters and
`round_types/choice.py::generate_rounds` one-way (PRD §7), never writes to
`live_quiz_*`/`pk_*`/`league_*`/`escape_room_*` tables, has its own three
tables (`team_arena_sessions`/`team_arena_members`/`team_arena_answers`) and
its own `/api/team-arena/*` routes (not yet built — v1 slice 1 is models +
pure-function engine only).
"""
