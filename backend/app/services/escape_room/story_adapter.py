"""將現有 StoryPack 的通用欄位投影為迷城密室的展示槽位。"""
from __future__ import annotations

from ...services.story_pack_defaults import BUILTIN_PACKS, DEFAULT_PACK_KEY


# StoryPack 尚未有 DialogueLine/scene。日後 schema 擴充該欄位後，才改為讀取它。
DEFAULT_DIALOGUE = {
    "mist": "濃霧漸漸籠罩，快想辦法推開它！",
    "retreat": "太好了，迷霧退開了一些",
    "rescue": "有人被迷霧碰到了，快救他！",
    "escape": "團隊逃出了迷城！",
    "not_this_time": "這次沒來得及，再試一次？",
}
DEFAULT_SKIN_ART = {"kind": "emoji", "value": "📖"}


def resolve_story_for_run(story_pack_key: str | None) -> dict:
    """Never lets unavailable story content interrupt a learning run."""
    try:
        pack = BUILTIN_PACKS.get(story_pack_key or "")
        if pack is None:
            pack = BUILTIN_PACKS[DEFAULT_PACK_KEY]
        skin_art = pack.chest.art.model_dump()
        return {
            "key": pack.key,
            "intro": f"翻開《{pack.title}》，和三位夥伴一起找回被迷霧吞沒的文字",
            "background_art": pack.background_art.model_dump() if pack.background_art else None,
            "skin_art": skin_art or DEFAULT_SKIN_ART,
            "dialogue": dict(DEFAULT_DIALOGUE),
        }
    except Exception:
        return {
            "key": None,
            "intro": "翻開書頁，和三位夥伴一起找回被迷霧吞沒的文字",
            "background_art": None,
            "skin_art": dict(DEFAULT_SKIN_ART),
            "dialogue": dict(DEFAULT_DIALOGUE),
        }
