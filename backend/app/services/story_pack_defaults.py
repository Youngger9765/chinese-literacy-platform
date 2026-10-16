"""Five shipped builtin `StoryPack`s for 跨班賽季 — 上古神話 (default), 唐,
宋, 武俠, 偵探劇 (PRD §13, generalized + expanded 2026-10-16 per Young's
direction).

Political neutrality (see schemas/story_pack.py's `content_guidelines`):
every pack below frames itself as falling INTO a story/book, never as
"going back to our country's history"; every conflict is abstract (fog,
a scattered training manual, an unsolved case) — never a people, country,
or ethnic group; no banned nation/ethnicity terms (enforced by the schema
validator, not just this docstring); no combat/war framing (「大戰」
rejected by the validator too).

上古神話 cites real classical sources for each milestone/chapter (verified
2026-10-16 — see each milestone's inline citation below); it deliberately
ships with 4 chapters, not the fuller list originally drafted (6 classical
myths + one Taiwan Indigenous chapter) — Young's 2026-10-16 MVP-scope
correction explicitly deferred the Indigenous chapter ("needs proper
review — later") and said not to invest further in pack content breadth
this round. 武俠 and 偵探劇 are original settings: 武俠 invents its own
school/place names (no characters, sects, or names from any existing
novel or game) and frames everything as 切磋／修練／行俠仗義 — no blood, no
killing, no weapon-injury language, "對手" are sparring partners, not
enemies. 偵探劇 is a 少年偵探社 solving kid-safe mysteries (lost items,
notes, a misplaced chart) — no crime violence, no real places/people.

"Guide NPC lines" (asked for alongside 武俠/偵探劇) are deliberately NOT a
new schema field — Young's MVP-scope correction cut the planned
`guide_character` model. They're expressed through the existing
`intro`/`result_copy` fields instead, which already carry a consistent
narrative voice for each pack. No new schema surface was added for this.
"""
from __future__ import annotations

from pathlib import Path

from ..schemas.story_pack import BADGE_KEY_CLASS, BADGE_KEY_INDIVIDUAL, StoryPack

MYTH_PACK_KEY = "myth"
TANG_PACK_KEY = "tang-dynasty"
SONG_PACK_KEY = "song-dynasty"
WUXIA_PACK_KEY = "wuxia"
DETECTIVE_PACK_KEY = "detective"

# Bundled SVG art (era backgrounds + chest icons) for 唐/宋 — generated via
# codex image-gen (see `_prompts.json` in this directory). 上古神話／武俠／
# 偵探劇 ship text-only for now (Young 2026-10-16: art generation is lower
# priority than shipping the editable store) — their chest/badge art is
# emoji, same trust tier as the hardcoded emoji already used elsewhere in
# this app ("bundled assets only", no external image URLs).
_ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "league_themes"


def _load_svg_art(filename: str) -> dict:
    raw = (_ASSETS_DIR / filename).read_text(encoding="utf-8").strip()
    return {"kind": "svg", "value": raw}


# ── 上古神話 (default) ───────────────────────────────────────────────────
# Each milestone cites its real classical source (verified 2026-10-16):
#   盤古開天 — 《三五歷紀》(徐整, 三國時代; 原書已佚, 內容轉引自《藝文類聚》等類書)
#   女媧補天 — 《淮南子．覽冥訓》(西漢, 劉安)
#   后羿射日 — 《淮南子．本經訓》(西漢, 劉安)
#   大禹治水 — 《尚書》、《史記．夏本紀》
MYTH_PACK = StoryPack(
    key=MYTH_PACK_KEY,
    era="上古",
    title="上古神話歷險記",
    intro=[
        "一陣書頁翻動的風吹來，兩班讀家一起掉進了古書裡的上古神話世界。",
        "書中的文字被一層奇怪的迷霧遮住了——每讀完一篇課文，就能驅散一塊迷霧，翻開下一個故事。",
        "從盤古開天到大禹治水，四段古老的故事正等著被重新讀懂。",
    ],
    faction_labels=["探書隊", "尋光隊"],
    energy_bar_label="書頁亮度",
    milestones=[
        {"ratio": 0.25, "message": "盤古一斧劈開混沌，天與地終於分開——《三五歷紀》記載的開天第一步"},
        {"ratio": 0.5, "message": "天破了一角，女媧煉五色石補天——出自《淮南子．覽冥訓》"},
        {"ratio": 0.75, "message": "十日並出，后羿張弓射下九個——《淮南子．本經訓》裡的英雄"},
        {"ratio": 1.0, "message": "大禹治水成功，故事從神話走進了信史——《尚書》與《史記．夏本紀》"},
    ],
    background_art=None,
    chest={
        "name": "神話寶箱",
        "description": "全班過半同學都翻開了書，寶箱就會出現",
        "art": {"kind": "emoji", "value": "📜"},
    },
    badges=[
        {
            "key": BADGE_KEY_INDIVIDUAL,
            "name": "尋頁勳章",
            "description": "獨自讀完全部篇章，找回遺失的書頁",
            "art": {"kind": "emoji", "value": "🔍"},
        },
        {
            "key": BADGE_KEY_CLASS,
            "name": "點亮迷霧勳章",
            "description": "全班平均達標，一起驅散了迷霧",
            "art": {"kind": "emoji", "value": "🌤️"},
        },
    ],
    result_copy={
        "win": "你們的書頁率先變得清晰，這段故事由你們讀懂了！",
        "lose": "迷霧還沒散去，下一段故事換你們挑戰",
        "draw": "兩隊同時讀懂了這段故事，迷霧一起散去了",
    },
)

TANG_PACK = StoryPack(
    key=TANG_PACK_KEY,
    era="唐",
    title="大唐風雲賽",
    intro=[
        "一陣風吹開了一本描寫長安城的古書，兩班讀家一起走進了書裡的絲路世界。",
        "每讀完一篇課文，就像為書中的驛站補上一份糧草；糧草齊備，烽火台就能點亮下一程。",
    ],
    faction_labels=["長安守軍", "塞外行旅"],
    energy_bar_label="軍糧",
    milestones=[
        {"ratio": 0.25, "message": "糧草剛起步，驛站已經感受到暖意"},
        {"ratio": 0.5, "message": "糧倉過半，商隊士氣大振"},
        {"ratio": 0.75, "message": "烽火將燃，再加把勁就能照亮全程"},
        {"ratio": 1.0, "message": "糧倉全滿，烽火點亮，絲路暢通無阻"},
    ],
    background_art=_load_svg_art("tang-background.svg"),
    chest={
        "name": "絲路寶箱",
        "description": "全班過半同學都上路了，寶箱就在驛站裡等著開啟",
        "art": _load_svg_art("tang-chest.svg"),
    },
    badges=[
        {
            "key": BADGE_KEY_INDIVIDUAL,
            "name": "行者勳章",
            "description": "一路讀下去，累積達標，獨得這份旅人的榮耀",
            "art": {"kind": "emoji", "value": "🎖️"},
        },
        {
            "key": BADGE_KEY_CLASS,
            "name": "守關勳章",
            "description": "全班平均達標，一起守住了這座驛站",
            "art": {"kind": "emoji", "value": "🏯"},
        },
    ],
    result_copy={
        "win": "烽火率先點亮，這一程由你們守住了！",
        "lose": "糧草還在路上，下一程換你們點亮烽火",
        "draw": "兩班的烽火同時點亮，絲路因你們而暢通",
    },
)

SONG_PACK = StoryPack(
    key=SONG_PACK_KEY,
    era="宋",
    title="汴京風華賽",
    intro=[
        "一陣風吹開了一本描寫汴京城的古書，兩班讀家一起走進了書裡的瓦子世界。",
        "每讀完一篇課文，就像替書坊多刻好一塊雕版；雕版集滿，整條街的燈籠就會一起點亮。",
    ],
    faction_labels=["汴京書坊", "江南書院"],
    energy_bar_label="墨量",
    milestones=[
        {"ratio": 0.25, "message": "第一塊雕版刻好，書坊門口已經有人探頭張望"},
        {"ratio": 0.5, "message": "墨量過半，街坊開始排隊等著翻閱"},
        {"ratio": 0.75, "message": "雕版快集滿了，再刻幾塊燈籠就能點亮"},
        {"ratio": 1.0, "message": "雕版集滿，滿街燈籠齊亮，新書刻印完成"},
    ],
    background_art=_load_svg_art("song-background.svg"),
    chest={
        "name": "瓦子寶箱",
        "description": "全班過半同學都動筆了，書坊的寶箱就會打開",
        "art": _load_svg_art("song-chest.svg"),
    },
    badges=[
        {
            "key": BADGE_KEY_INDIVIDUAL,
            "name": "刻工勳章",
            "description": "一人刻滿一部書的雕版，技藝獨得認可",
            "art": {"kind": "emoji", "value": "🖋️"},
        },
        {
            "key": BADGE_KEY_CLASS,
            "name": "書坊勳章",
            "description": "全班平均達標，一起刻完了這部新書",
            "art": {"kind": "emoji", "value": "🏮"},
        },
    ],
    result_copy={
        "win": "滿街燈籠率先點亮，這部新書由你們刻成！",
        "lose": "雕版還差幾塊，下一部書換你們刻成",
        "draw": "兩間書坊的燈籠同時點亮，街坊今晚讀得特別開心",
    },
)

# ── 武俠（原創世界，無既有小說／遊戲的角色、門派、名稱） ───────────────────
WUXIA_PACK = StoryPack(
    key=WUXIA_PACK_KEY,
    era="武林",
    title="武林修練記",
    intro=[
        "一陣風吹開了一本武俠小說，兩班讀家一起走進了書裡的武林世界。",
        "書裡的武功秘笈被風吹散了幾頁，每讀完一篇課文，就能找回一頁、練成一招。",
    ],
    faction_labels=["清風山莊", "明月谷"],
    energy_bar_label="內力",
    milestones=[
        {"ratio": 0.25, "message": "蹲馬步練基本功，雖然枯燥，卻是扎穩根基的第一步"},
        {"ratio": 0.5, "message": "學會了輕功，身手變得靈活，一躍而起"},
        {"ratio": 0.75, "message": "與同門切磋劍法，在你來我往中練出默契"},
        {"ratio": 1.0, "message": "練成壓箱底的絕招，終於能行俠仗義、濟弱扶傾"},
    ],
    background_art=None,
    chest={
        "name": "秘笈寶箱",
        "description": "全班過半同學都開始修練，秘笈寶箱就會打開",
        "art": {"kind": "emoji", "value": "📖"},
    },
    badges=[
        {
            "key": BADGE_KEY_INDIVIDUAL,
            "name": "武學奇才勳章",
            "description": "個人武功大進，獨得師門讚賞",
            "art": {"kind": "emoji", "value": "🥋"},
        },
        {
            "key": BADGE_KEY_CLASS,
            "name": "同心協力勳章",
            "description": "全班平均達標，一起練成了團體武藝",
            "art": {"kind": "emoji", "value": "🤝"},
        },
    ],
    result_copy={
        "win": "你們率先練成絕招，技高一籌！",
        "lose": "內力還差一點，下一回合再切磋",
        "draw": "兩班同時練成絕招，不分軒輊",
    },
)

# ── 偵探劇（少年偵探社，無真實地點／人物，案件皆為輕量且安全） ───────────────
DETECTIVE_PACK = StoryPack(
    key=DETECTIVE_PACK_KEY,
    era="校園",
    title="少年偵探社事件簿",
    intro=[
        "兩班讀家加入了神秘的少年偵探社，準備一起解開學校裡發生的小謎團。",
        "每答對一題，就能找到一條新線索——線索湊齊，謎底就會水落石出。",
    ],
    faction_labels=["謎團調查隊", "線索調查隊"],
    energy_bar_label="線索",
    milestones=[
        {"ratio": 0.25, "message": "第一件案子：消失的班費撲滿——是誰不小心碰倒了呢？"},
        {"ratio": 0.5, "message": "第二件案子：圖書館神秘留言條——是誰想傳遞什麼訊息？"},
        {"ratio": 0.75, "message": "第三件案子：不見的教室掛圖——線索指向被放錯的角落"},
        {"ratio": 1.0, "message": "最後的謎底大公開：所有線索湊在一起，真相終於清楚了！"},
    ],
    background_art=None,
    chest={
        "name": "線索百寶箱",
        "description": "全班過半同學都交出破案報告，百寶箱就會打開",
        "art": {"kind": "emoji", "value": "🔎"},
    },
    badges=[
        {
            "key": BADGE_KEY_INDIVIDUAL,
            "name": "名偵探勳章",
            "description": "獨自破解全部案件，推理力滿分",
            "art": {"kind": "emoji", "value": "🕵️"},
        },
        {
            "key": BADGE_KEY_CLASS,
            "name": "團隊推理勳章",
            "description": "全班平均達標，一起破了案",
            "art": {"kind": "emoji", "value": "🧩"},
        },
    ],
    result_copy={
        "win": "你們率先破解所有謎團，真相大白！",
        "lose": "線索還差一點，下一件案子見真章",
        "draw": "兩隊同時破案，謎底一起揭曉",
    },
)

BUILTIN_PACKS: dict[str, StoryPack] = {
    MYTH_PACK_KEY: MYTH_PACK,
    TANG_PACK_KEY: TANG_PACK,
    SONG_PACK_KEY: SONG_PACK,
    WUXIA_PACK_KEY: WUXIA_PACK,
    DETECTIVE_PACK_KEY: DETECTIVE_PACK,
}

# Young 2026-10-16: 上古神話 feels more fitting than a single dynasty as the
# shipped default — 唐/宋 remain fully selectable alternates.
DEFAULT_PACK_KEY = MYTH_PACK_KEY
DEFAULT_PACK = MYTH_PACK
