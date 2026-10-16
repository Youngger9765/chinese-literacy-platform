"""Two shipped default `LeagueTheme`s — 唐 (Tang) and 宋 (Song) — for 跨班賽季.

Original copy written for this feature (PRD §13). No fabricated classical
quotations are used anywhere below — flavor comes from well-known, general
historical motifs (絲路／長安／驛站 for Tang; 汴京／瓦子／活字印刷 for Song),
not from quoting a specific person or text, so there is nothing here that
needs a citation. Framing is non-violent ("守護/挑戰/點亮", never weapons or
injury) and written at a grade-4–9 reading level.

Both constants are validated at IMPORT TIME (constructing a `LeagueTheme`
raises immediately if the literal payload below is ever edited into an
invalid shape) — see `test_league_theme_defaults.py` for the regression
lock that both themes exist, parse, and differ.
"""
from __future__ import annotations

from pathlib import Path

from ..schemas.league_theme import BADGE_KEY_CLASS, BADGE_KEY_INDIVIDUAL, LeagueTheme

TANG_THEME_KEY = "tang-dynasty"
SONG_THEME_KEY = "song-dynasty"

# Bundled SVG art (era backgrounds + chest icons) — generated via codex
# image-gen (see `_prompts.json` in this directory for the exact prompts
# and model used; code/wiring/validation here is hand-written, codex only
# authored the SVG markup). `COPY app/ ./app/` in backend/Dockerfile picks
# this directory up automatically — these are backend-local assets, not
# frontend/public static files, so the API embeds the SVG text directly in
# the theme JSON rather than the frontend fetching a separate file.
_ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "league_themes"


def _load_svg_art(filename: str) -> dict:
    raw = (_ASSETS_DIR / filename).read_text(encoding="utf-8").strip()
    return {"kind": "svg", "value": raw}

TANG_THEME = LeagueTheme(
    key=TANG_THEME_KEY,
    era="唐",
    title="大唐風雲賽",
    intro=[
        "長安城外，絲路商旅往來不絕，兩班讀家受命守護沿途驛站。",
        "每讀完一篇課文，就像為驛站補上一份糧草；糧草齊備，烽火台就能點亮下一程。",
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

SONG_THEME = LeagueTheme(
    key=SONG_THEME_KEY,
    era="宋",
    title="汴京風華賽",
    intro=[
        "汴京城裡，瓦子書坊的雕版正等著刻上新故事；印得越快，街坊看得越多。",
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

BUILTIN_THEMES: dict[str, LeagueTheme] = {
    TANG_THEME_KEY: TANG_THEME,
    SONG_THEME_KEY: SONG_THEME,
}

DEFAULT_THEME_KEY = TANG_THEME_KEY
DEFAULT_THEME = TANG_THEME
