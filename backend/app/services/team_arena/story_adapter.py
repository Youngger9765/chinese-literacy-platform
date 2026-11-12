"""將現有 StoryPack 的通用欄位投影為五人對抗賽的展示槽位 — PRD §8.

Same shape as `services/escape_room/story_adapter.py`: a pack's existing
fields (never a new schema field — PRD §8: "不跟 StoryPack 要新欄位") are
projected onto this mode's own vocabulary, and any failure (unknown key,
missing art, a blown-up registry) falls back to a hardcoded neutral default
so a broken/missing pack NEVER interrupts a match in progress (PRD §8:
"比賽照常進行").
"""
from __future__ import annotations

from ...services.story_pack_defaults import BUILTIN_PACKS, DEFAULT_PACK_KEY

# PRD §7/§11 literal wording: "不選就用內建中性文案（青隊／橙隊、「書塔」、
# 「主堡」）".
DEFAULT_TEAM_LABELS: tuple[str, str] = ("青隊", "橙隊")
DEFAULT_INTRO = "兩隊讀家即將展開一場友善的課文對抗賽，看誰先攻下對方的書塔與主堡"
DEFAULT_ENERGY_BAR_LABEL = "書塔亮度"
DEFAULT_RESULT_COPY: dict[str, str] = {
    "win": "恭喜！成功攻下對方主堡",
    "lose": "可惜，對方先攻下了主堡，下次再挑戰",
    "draw": "勢均力敵，這場打成平手",
}


def _fallback_story() -> dict:
    return {
        "key": None,
        "team_labels": list(DEFAULT_TEAM_LABELS),
        "intro": DEFAULT_INTRO,
        "background_art": None,
        "energy_bar_label": DEFAULT_ENERGY_BAR_LABEL,
        "result_copy": dict(DEFAULT_RESULT_COPY),
    }


def resolve_story_for_session(story_pack_key: str | None) -> dict:
    """Never lets unavailable/broken story content interrupt a match — any
    exception anywhere in the lookup falls back to the hardcoded default
    story, same fail-open posture as escape_room's
    `resolve_story_for_run`."""
    try:
        pack = BUILTIN_PACKS.get(story_pack_key or "")
        if pack is None:
            pack = BUILTIN_PACKS[DEFAULT_PACK_KEY]
        return {
            "key": pack.key,
            "team_labels": list(pack.faction_labels),
            "intro": "\n".join(pack.intro),
            "background_art": pack.background_art.model_dump() if pack.background_art else None,
            "energy_bar_label": pack.energy_bar_label,
            "result_copy": {
                "win": pack.result_copy.win,
                "lose": pack.result_copy.lose,
                "draw": pack.result_copy.draw,
            },
        }
    except Exception:
        return _fallback_story()
