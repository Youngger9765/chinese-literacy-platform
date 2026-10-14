"""The round-type contract.

A round type is a plain module exposing three functions. The engine
(``live_quiz/engine.py``) only ever calls these three — it never reaches into
a round's ``payload``/``submission`` shape directly, which is what lets a
second round type (字盤找詞回合, word search — next PR) plug in without
touching the engine or the three DB tables:

  generate_rounds(lessons, settings, rng) -> list[dict]
      Build the frozen ``rounds_snapshot`` entries (``{round_index,
      round_type, payload}``) for a brand-new game. Only called once, at
      game creation.

  score_submission(payload, submission, elapsed_ms) -> (is_correct, base_points)
      Pure function: given one round's frozen payload and a player's raw
      ``submission`` JSON, decide correctness and this round type's OWN
      base score (e.g. the choice type's "500 + speed bonus" formula). The
      engine applies the cross-cutting settings (double_points_last,
      streak_bonus) on top of ``base_points`` — a round type never sees
      those settings.

  player_view(payload, revealed) -> dict
      The role-aware, answer-safe shape the player's own device receives.
      ``revealed=False`` MUST NOT leak the correct answer (CTO review:
      "學生打開開發者工具也看不到答案").
"""
PROTOCOL_VERSION = 1
