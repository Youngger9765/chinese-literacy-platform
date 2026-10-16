"""LeagueTheme — the editable STORYLINE/CHEST/BADGE content schema for 跨班賽季.

See docs/prd/2026-10-14-chinese-star-league-prd.md §13 for the design.

What this schema covers (content, back-office-editable, AI-generatable):
    era / title / intro narrative / faction banners / energy-bar label /
    milestone captions / chest {name, description, art} / badge
    {name, description, art} / win-lose-draw copy.

What this schema explicitly does NOT cover (fixed in code, never touched
here): scoring weights, badge thresholds, treasure-chest participation
ratio, grade-floor offset — all of those stay in
`app/services/league_scoring.py::LeagueWeights`. The two badge entries and
the one chest entry below carry TEXT ONLY; there is no numeric/threshold
field anywhere in this module. `BADGE_KEYS` is the fixed set of mechanics a
theme's badges must map onto 1:1 — a theme cannot invent a third badge or
drop one of the two.

Security/safety posture (this is content an LLM may generate and a
non-engineer may paste in, so it must fail closed):
    - `extra="forbid"` everywhere — an unknown key is rejected, not ignored.
    - Every free-text field has a length cap and is checked for HTML/script
      injection markers (`<`, `>`, `javascript:`, `on\\w+=`) — content is
      copy, never markup.
    - `LeagueThemeArt` is either `emoji` (a short glyph from the already-
      bundled font, same posture as the existing hardcoded 🏅⭐🏆🔒 in
      EnergyBar.tsx/LeagueBadgeCard.tsx — "bundled assets only", no external
      image URLs) or `svg` (inline SVG run through `sanitize_svg`, which
      allow-lists tags/attributes and rejects `<script>`, `on*=`,
      `javascript:`, `<foreignObject>`, external `url(...)`/`href`).

Versioning / forward-compat (2026-10-16, requested alongside a separate,
not-yet-written 2D story-mode design doc — NPC guide characters, dialogue
scenes, milestone cutscenes):
    - `schema_version` is a real field, not decoration — a future story
      mode bumps it (e.g. 2) and adds its own validated scenes schema. This
      module deliberately does NOT accept an unvalidated `scenes` key
      today: `extra="forbid"` rejects it, same as any other unknown key,
      and `test_league_theme_schema.py::test_scenes_key_rejected_until_
      story_mode_schema_lands` is the trip-wire that forces whoever adds
      real scenes support to consciously touch this file (and that test)
      rather than have it silently start accepting arbitrary scene data.
    - `background_art` is optional decorative art (era backdrop) shown
      behind the existing BattleHero gradient card — see PRD §12.2 decision
      #1 (no new full-page dark theme; this stays a subtle overlay, not a
      theme swap of the card chrome itself).
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ── Fixed mechanic keys a theme's badges must map onto (never extended by
# theme content — see league.py models / league_scoring.py for the actual
# mechanics these are cosmetic skins for). ─────────────────────────────────
BADGE_KEY_INDIVIDUAL = "individual_badge"
BADGE_KEY_CLASS = "class_badge"
BADGE_KEYS: frozenset[str] = frozenset({BADGE_KEY_INDIVIDUAL, BADGE_KEY_CLASS})

_NO_MARKUP_RE = re.compile(r"[<>]|javascript:|on\w+\s*=", re.IGNORECASE)


def _forbid_markup(value: str, *, field_name: str) -> str:
    if _NO_MARKUP_RE.search(value):
        raise ValueError(f"{field_name} 不可包含 HTML/script 標記")
    return value


# ── Inline-SVG sanitizer (allow-list, not a blocklist) ─────────────────────

_SVG_ALLOWED_TAGS = {
    "svg", "g", "path", "circle", "ellipse", "rect", "line", "polygon",
    "polyline", "text", "tspan", "defs", "lineargradient", "radialgradient",
    "stop",
}
_SVG_ALLOWED_ATTRS = {
    "viewbox", "width", "height", "xmlns", "fill", "stroke", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "d", "cx", "cy", "r", "rx", "ry",
    "x", "y", "x1", "y1", "x2", "y2", "points", "transform", "opacity",
    "fill-opacity", "font-size", "font-family", "text-anchor", "id",
    "gradientunits", "offset", "stop-color", "stop-opacity",
}
_SVG_DANGEROUS_RE = re.compile(
    r"<\s*(script|foreignObject|iframe|image|use)\b"
    r"|javascript:"
    r"|on\w+\s*="
    r"|url\s*\(",
    re.IGNORECASE,
)
_SVG_TAG_RE = re.compile(r"<\s*/?\s*([a-zA-Z][a-zA-Z0-9-]*)")
_SVG_ATTR_RE = re.compile(r"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=")


class SvgValidationError(ValueError):
    pass


def sanitize_svg(raw: str) -> str:
    """Allow-list validation for inline SVG art. Raises SvgValidationError
    (a ValueError subclass — Pydantic field_validators re-raise ValueError
    as part of the model's error list) on anything outside the allow-list.

    This is a REJECTING validator, not a rewriting sanitizer: it never
    silently strips a disallowed tag/attribute and lets the rest through
    (that would let a theme author believe their art rendered as submitted
    when a dangerous fragment was quietly dropped). Fail closed: reject the
    whole payload, tell the author exactly what's disallowed.
    """
    if len(raw) > 4000:
        raise SvgValidationError("SVG 內容過長（上限 4000 字元）")
    if "<svg" not in raw.lower():
        raise SvgValidationError("SVG art 必須包含 <svg> 根元素")
    if _SVG_DANGEROUS_RE.search(raw):
        raise SvgValidationError("SVG 含有不允許的標記（script/事件屬性/外部 url()/foreignObject 等）")
    for tag in _SVG_TAG_RE.findall(raw):
        if tag.lower() not in _SVG_ALLOWED_TAGS:
            raise SvgValidationError(f"SVG 含有不允許的標籤：<{tag}>")
    for attr in _SVG_ATTR_RE.findall(raw):
        bare = attr.split(":")[-1].lower()
        if bare not in _SVG_ALLOWED_ATTRS and attr.lower() not in _SVG_ALLOWED_ATTRS:
            raise SvgValidationError(f"SVG 含有不允許的屬性：{attr}")
    return raw


class LeagueThemeArt(BaseModel):
    """Decorative art for a chest/badge — "bundled assets only", never an
    externally-hosted image URL. Two kinds:
      - emoji: a short glyph already shipped in the app's font (same trust
        level as the hardcoded 🏅⭐🏆 already in the current components).
      - svg: inline SVG, allow-list sanitized by `sanitize_svg`.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["emoji", "svg"]
    value: str = Field(..., min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _validate_value_for_kind(self) -> "LeagueThemeArt":
        if self.kind == "emoji":
            if len(self.value) > 8:
                raise ValueError("emoji art 過長（上限 8 字元）")
            if _NO_MARKUP_RE.search(self.value):
                raise ValueError("emoji art 不可包含 HTML/script 標記")
        else:
            sanitize_svg(self.value)
        return self


class LeagueThemeMilestone(BaseModel):
    """A caption shown when progress toward the (already-frozen, unchanged)
    `badge_threshold` crosses `ratio`. Presentation-only — picking which
    caption to show never changes how many points anything is worth."""

    model_config = ConfigDict(extra="forbid")

    ratio: float = Field(..., gt=0, le=1)
    message: str = Field(..., min_length=1, max_length=80)

    @field_validator("message")
    @classmethod
    def _no_markup(cls, v: str) -> str:
        return _forbid_markup(v, field_name="milestone message")


class LeagueThemeChest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=20)
    description: str = Field(..., min_length=1, max_length=80)
    art: LeagueThemeArt

    @field_validator("name", "description")
    @classmethod
    def _no_markup(cls, v: str) -> str:
        return _forbid_markup(v, field_name="chest text")


class LeagueThemeBadge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: Literal["individual_badge", "class_badge"]
    name: str = Field(..., min_length=1, max_length=20)
    description: str = Field(..., min_length=1, max_length=80)
    art: LeagueThemeArt

    @field_validator("name", "description")
    @classmethod
    def _no_markup(cls, v: str) -> str:
        return _forbid_markup(v, field_name="badge text")


class LeagueThemeResultCopy(BaseModel):
    """Win/lose/draw flavor text shown once a season is finalized. Pure
    copy — which side is "win" vs "lose" is decided by comparing the
    already-computed average_points of the two board rows (frontend-only
    comparison, see leagueTheme.ts::pickResultCopy); this schema never
    changes who wins."""

    model_config = ConfigDict(extra="forbid")

    win: str = Field(..., min_length=1, max_length=60)
    lose: str = Field(..., min_length=1, max_length=60)
    draw: str = Field(..., min_length=1, max_length=60)

    @field_validator("win", "lose", "draw")
    @classmethod
    def _no_markup(cls, v: str) -> str:
        return _forbid_markup(v, field_name="result copy")


class LeagueTheme(BaseModel):
    """The full editable storyline/chest/badge content for one theme.

    `extra="forbid"` at every level in this module means an AI-generated or
    hand-pasted JSON payload with an unexpected key (e.g. a stray
    `badge_threshold` someone tried to sneak in to change scoring) is
    REJECTED outright, not silently dropped — see `validate_theme_payload`
    in league_theme_service.py for how routes surface that as a 422 with
    the offending field path.
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = Field(
        default=1,
        description=(
            "Content schema version. A future 2D story-mode (NPC guide "
            "characters / dialogue scenes / milestone cutscenes) will bump "
            "this and add its own validated `scenes` schema — see module "
            "docstring. Never changed by theme authors; bump only when the "
            "Python schema itself gains a new validated shape."
        ),
    )
    key: str = Field(..., min_length=2, max_length=48)
    era: str = Field(..., min_length=1, max_length=20)
    title: str = Field(..., min_length=1, max_length=40)
    intro: list[str] = Field(..., min_length=1, max_length=4)
    faction_labels: list[str] = Field(..., min_length=2, max_length=2)
    energy_bar_label: str = Field(..., min_length=1, max_length=10)
    milestones: list[LeagueThemeMilestone] = Field(default_factory=list, max_length=6)
    background_art: LeagueThemeArt | None = Field(
        default=None,
        description="Optional subtle era backdrop shown behind the existing BattleHero gradient card (never a full theme swap of the card chrome).",
    )
    chest: LeagueThemeChest
    badges: list[LeagueThemeBadge] = Field(..., min_length=2, max_length=2)
    result_copy: LeagueThemeResultCopy

    @field_validator("key")
    @classmethod
    def _key_is_slug(cls, v: str) -> str:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,47}", v):
            raise ValueError("key 必須是小寫字母/數字/連字號組成的 slug（例如 tang-dynasty）")
        return v

    @field_validator("era", "title")
    @classmethod
    def _no_markup_single(cls, v: str) -> str:
        return _forbid_markup(v, field_name="era/title")

    @field_validator("intro")
    @classmethod
    def _intro_paragraphs(cls, v: list[str]) -> list[str]:
        for p in v:
            if not (1 <= len(p) <= 160):
                raise ValueError("intro 每段長度必須在 1–160 字元之間")
            _forbid_markup(p, field_name="intro paragraph")
        return v

    @field_validator("faction_labels")
    @classmethod
    def _faction_labels_len(cls, v: list[str]) -> list[str]:
        for label in v:
            if not (1 <= len(label) <= 12):
                raise ValueError("faction_labels 每個長度必須在 1–12 字元之間")
            _forbid_markup(label, field_name="faction label")
        return v

    @field_validator("energy_bar_label")
    @classmethod
    def _no_markup_bar(cls, v: str) -> str:
        return _forbid_markup(v, field_name="energy_bar_label")

    @field_validator("milestones")
    @classmethod
    def _milestones_sorted_unique(cls, v: list[LeagueThemeMilestone]) -> list[LeagueThemeMilestone]:
        ratios = [m.ratio for m in v]
        if len(set(ratios)) != len(ratios):
            raise ValueError("milestones 的 ratio 不可重複")
        if ratios != sorted(ratios):
            raise ValueError("milestones 必須依 ratio 由小到大排列")
        return v

    @field_validator("badges")
    @classmethod
    def _badges_cover_fixed_keys_exactly(cls, v: list[LeagueThemeBadge]) -> list[LeagueThemeBadge]:
        keys = {b.key for b in v}
        if keys != BADGE_KEYS:
            raise ValueError(
                f"badges 必須恰好對應固定機制 {sorted(BADGE_KEYS)}（收到 {sorted(keys)}）"
            )
        return v


class LeagueThemeSummary(BaseModel):
    """List-view row — enough to pick a theme without fetching full content."""

    model_config = ConfigDict(extra="forbid")

    key: str
    era: str
    title: str
    is_builtin: bool
