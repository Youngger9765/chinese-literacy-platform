"""Round-type registry.

Adding a round type (next PR: 字盤找詞回合 / word search) means adding one
module here with ``generate_rounds`` / ``score_submission`` / ``player_view``
and one line in ``ROUND_TYPES`` — the engine and the three DB tables
(``live_quiz_games`` / ``live_quiz_players`` / ``live_quiz_answers``) do not
change. See ``round_types/base.py`` for the contract each module implements.
"""
from __future__ import annotations

from . import choice

ROUND_TYPES: dict = {
    choice.NAME: choice,
}
