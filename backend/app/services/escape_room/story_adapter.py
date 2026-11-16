"""將現有 StoryPack 的通用欄位投影為迷城密室的展示槽位。"""
from __future__ import annotations

from ...services.story_pack_defaults import BUILTIN_PACKS, DEFAULT_PACK_KEY


# StoryPack 尚未有 DialogueLine/scene。日後 schema 擴充該欄位後，才改為讀取它。
#
# #4051「救回隊友後訊息仍是「有人被迷霧碰到了，快救他！」」——「rescue」這個
# event 原本被兩種完全相反的時刻共用：隊友剛被迷霧碰到（需要救援，這句話
# 才對）、以及救援題剛答對（隊友剛被救回來）。後者需要自己的訊息，否則
# 玩家救對了，畫面講的卻像救援還沒發生。
#
# 「not_this_time」的文字原本跟 `StudentEscapeRoomRun.tsx` 結局頁自己寫死
# 的標題（`escaped ? ... : '這次沒來得及，再試一次？'`）逐字相同，於是同一
# 句話在結局頁的標題與內文各印一次。
DEFAULT_DIALOGUE = {
    "mist": "濃霧漸漸籠罩，快想辦法推開它！",
    "retreat": "太好了，迷霧退開了一些",
    "rescue": "有人被迷霧碰到了，快救他！",
    "rescued": "太好了，你把他救回來了！",
    "escape": "團隊逃出了迷城！",
    "not_this_time": "沒關係，下次再挑戰看看！",
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
