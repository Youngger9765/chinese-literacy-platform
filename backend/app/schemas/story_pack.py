"""StoryPack — the editable world/story content for a game mode's "skin"
(PRD §13, generalized 2026-10-16 per Young's direction: this started as
league-only `LeagueTheme` and is now a generic, subject-agnostic content
container any game mode can bind to).

content_guidelines (short note, per Young 2026-10-16 — MVP scope, no new
schema fields for this beyond the validator below):
    - Frame every pack as travelling INTO a story/book
      ("掉進《山海經》這本書"), never as "going back to our country's
      history" — this is a literature world, not a nation's history.
    - Never use nation/ethnicity framing words — see
      `BANNED_POLITICAL_TERMS` below; the schema validator rejects them in
      every free-text field, so this is enforced, not just documented.
    - Any antagonist/conflict must be abstract (fog, time turbulence, a
      forgotten page) — never a people, country, or ethnic group. Prefer
      「冒險／挑戰」framing over「大戰」(also rejected by the validator).
    - Dynasty names (唐/宋/...) are era LABELS only, not historical combat
      framing.
    - A pack must still work if the game mode never reads its new fields —
      only era/title/intro/faction_labels/energy_bar_label/milestones/
      chest/badges/result_copy exist today (MVP scope, 2026-10-16: richer
      per-mode slots — NPC dialogue trees, chapter objects with citations,
      subject/age/realm metadata — were explicitly deferred, not built, to
      keep this PR to "the smallest thing that works"; chapter structure
      and citations for content-heavy packs like 上古神話 are expressed as
      ordinary `milestones` entries, not a new nested model).

What this schema explicitly does NOT cover (still fixed in code for
league, never touched here): scoring weights, badge thresholds,
treasure-chest participation ratio, grade-floor offset — all of those stay
in `app/services/league_scoring.py::LeagueWeights`. A pack's `badges` list
carries TEXT ONLY, keyed onto whatever fixed mechanic keys the consuming
game mode defines (league's are `individual_badge`/`class_badge` — see
`BADGE_KEY_INDIVIDUAL`/`BADGE_KEY_CLASS`).
"""
from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

# ── Fixed mechanic keys league's badges map onto (never extended by pack
# content — see app/models/league.py / league_scoring.py for the actual
# mechanics these are cosmetic skins for). Other game modes binding to
# StoryPack later will define their own badge-key sets. ───────────────────
BADGE_KEY_INDIVIDUAL = "individual_badge"
BADGE_KEY_CLASS = "class_badge"
BADGE_KEYS: frozenset[str] = frozenset({BADGE_KEY_INDIVIDUAL, BADGE_KEY_CLASS})

# ── Political-neutrality guard (Young 2026-10-16) ──────────────────────────
# Content must never use nation/ethnicity framing — this app is used by
# Taiwan schools and must stay neutral regardless of which side a reader
# leans. Checked as a plain substring match across every free-text field;
# a false positive (a legitimate word containing one of these as a
# substring) is an acceptable cost given the explicit instruction to hard-
# reject these, and none of the shipped pack copy uses them.
BANNED_POLITICAL_TERMS: tuple[str, ...] = (
    "中華", "中國", "祖國", "民族", "我國", "炎黃子孫", "統一", "收復", "大一統",
    # 「大戰」framing guard — Young: rename combat/war framing to 冒險／挑戰
    # in all user-visible copy. Not a nation-identity term, but cheap to
    # also hard-block here as defense-in-depth for the same instruction.
    "大戰",
)

_NO_MARKUP_RE = re.compile(r"[<>]|javascript:|on\w+\s*=", re.IGNORECASE)


class BannedTermError(ValueError):
    pass


# Error messages below are shown verbatim to the admin (issue 3615): Chinese
# only, and they do NOT name the field — story_pack_service attaches the
# Chinese field label from the error's location, so the message says only
# WHAT is wrong.
def _forbid_banned_terms(value: str) -> None:
    for term in BANNED_POLITICAL_TERMS:
        if term in value:
            raise BannedTermError(f"不可包含「{term}」，請改用中立的書中世界／冒險描述")


def _forbid_markup(value: str) -> str:
    if _NO_MARKUP_RE.search(value):
        raise ValueError("不可包含 HTML 或程式標記")
    _forbid_banned_terms(value)
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
    (that would let a pack author believe their art rendered as submitted
    when a dangerous fragment was quietly dropped). Fail closed: reject the
    whole payload, tell the author exactly what's disallowed.
    """
    if len(raw) > 4000:
        raise SvgValidationError("SVG 內容過長，最多 4000 個字元")
    if "<svg" not in raw.lower():
        raise SvgValidationError("SVG 圖必須以「<svg>」根元素包起來")
    if _SVG_DANGEROUS_RE.search(raw):
        raise SvgValidationError("SVG 含有不允許的內容：程式、事件屬性、外部連結或內嵌物件")
    for tag in _SVG_TAG_RE.findall(raw):
        if tag.lower() not in _SVG_ALLOWED_TAGS:
            raise SvgValidationError(f"SVG 含有不允許的標籤「<{tag}>」")
    for attr in _SVG_ATTR_RE.findall(raw):
        bare = attr.split(":")[-1].lower()
        if bare not in _SVG_ALLOWED_ATTRS and attr.lower() not in _SVG_ALLOWED_ATTRS:
            raise SvgValidationError(f"SVG 含有不允許的屬性「{attr}」")
    return raw


class StoryPackArt(BaseModel):
    """Decorative art for a chest/badge — "bundled assets only", never an
    externally-hosted image URL. Two kinds:
      - emoji: a short glyph already shipped in the app's font.
      - svg: inline SVG, allow-list sanitized by `sanitize_svg`.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["emoji", "svg"]
    value: str = Field(..., min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _validate_value_for_kind(self) -> "StoryPackArt":
        # Both branches must also clear the banned-term check — `art.value`
        # is free text (an emoji glyph, or an SVG that can legally contain
        # <text>/<tspan> nodes per the allow-list below) reachable from
        # background_art/chest.art/badge.art, all writable through the same
        # admin endpoint as every other field. Code review 2026-10-16 found
        # this field was the one gap where the neutrality validator wasn't
        # actually wired up despite the module docstring's "every free-text
        # field" claim — see test_story_pack_schema.py::
        # TestPoliticalNeutralityValidator::test_banned_term_in_art_* for the
        # mutation-tested regression lock.
        if self.kind == "emoji":
            if len(self.value) > 8:
                raise ValueError("表情符號過長，最多 8 個字元")
            if _NO_MARKUP_RE.search(self.value):
                raise ValueError("表情符號不可包含 HTML 或程式標記")
            _forbid_banned_terms(self.value)
        else:
            sanitize_svg(self.value)
            _forbid_banned_terms(self.value)
        return self


class StoryPackMilestone(BaseModel):
    """A caption shown when progress toward a fixed, mode-owned threshold
    crosses `ratio`. Presentation-only — picking which caption to show
    never changes how many points anything is worth. For content-heavy
    packs (e.g. 上古神話), each milestone doubles as one narrative "chapter"
    beat — see module docstring for why this isn't a separate model."""

    model_config = ConfigDict(extra="forbid")

    ratio: float = Field(..., gt=0, le=1)
    message: str = Field(..., min_length=1, max_length=80)

    @field_validator("message")
    @classmethod
    def _no_markup(cls, v: str) -> str:
        return _forbid_markup(v)


class StoryPackChest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=20)
    description: str = Field(..., min_length=1, max_length=80)
    art: StoryPackArt

    @field_validator("name", "description")
    @classmethod
    def _no_markup(cls, v: str) -> str:
        return _forbid_markup(v)


class StoryPackBadge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: Literal["individual_badge", "class_badge"]
    name: str = Field(..., min_length=1, max_length=20)
    description: str = Field(..., min_length=1, max_length=80)
    art: StoryPackArt

    @field_validator("name", "description")
    @classmethod
    def _no_markup(cls, v: str) -> str:
        return _forbid_markup(v)


class StoryPackResultCopy(BaseModel):
    """Win/lose/draw flavor text shown once a season is finalized. Pure
    copy — which side is "win" vs "lose" is decided by the consuming game
    mode comparing its own already-computed scores; this schema never
    changes who wins."""

    model_config = ConfigDict(extra="forbid")

    win: str = Field(..., min_length=1, max_length=60)
    lose: str = Field(..., min_length=1, max_length=60)
    draw: str = Field(..., min_length=1, max_length=60)

    @field_validator("win", "lose", "draw")
    @classmethod
    def _no_markup(cls, v: str) -> str:
        return _forbid_markup(v)


# Per-item types so an error lands on the exact paragraph / label
# ("intro.1"), not on the whole list — the admin sees「開場白第 2 段」.
_IntroParagraph = Annotated[str, StringConstraints(min_length=1, max_length=160), AfterValidator(_forbid_markup)]
_FactionLabel = Annotated[str, StringConstraints(min_length=1, max_length=12), AfterValidator(_forbid_markup)]


class StoryPack(BaseModel):
    """The full editable world/story content for one pack.

    `extra="forbid"` at every level in this module means an AI-generated or
    hand-pasted JSON payload with an unexpected key (e.g. a stray
    `badge_threshold` someone tried to sneak in to change scoring) is
    REJECTED outright, not silently dropped.
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = Field(
        default=1,
        description="Content schema version. MVP scope (2026-10-16): no "
        "versioned shape change yet — see module docstring for what was "
        "deliberately deferred.",
    )
    key: str = Field(..., min_length=2, max_length=48)
    era: str = Field(..., min_length=1, max_length=20)
    title: str = Field(..., min_length=1, max_length=40)
    intro: list[_IntroParagraph] = Field(..., min_length=1, max_length=4)
    faction_labels: list[_FactionLabel] = Field(..., min_length=2, max_length=2)
    energy_bar_label: str = Field(..., min_length=1, max_length=10)
    milestones: list[StoryPackMilestone] = Field(default_factory=list, max_length=6)
    background_art: StoryPackArt | None = Field(
        default=None,
        description="Optional subtle backdrop art shown behind the hero card.",
    )
    chest: StoryPackChest
    badges: list[StoryPackBadge] = Field(..., min_length=2, max_length=2)
    result_copy: StoryPackResultCopy

    @field_validator("key")
    @classmethod
    def _key_is_slug(cls, v: str) -> str:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,47}", v):
            raise ValueError("只能用小寫英文字母、數字和連字號，至少 2 個字元，例如「tang-dynasty」")
        return v

    @field_validator("era", "title")
    @classmethod
    def _no_markup_single(cls, v: str) -> str:
        return _forbid_markup(v)

    @field_validator("energy_bar_label")
    @classmethod
    def _no_markup_bar(cls, v: str) -> str:
        return _forbid_markup(v)

    @field_validator("milestones")
    @classmethod
    def _milestones_sorted_unique(cls, v: list[StoryPackMilestone]) -> list[StoryPackMilestone]:
        ratios = [m.ratio for m in v]
        if len(set(ratios)) != len(ratios):
            raise ValueError("各里程碑的進度比例不可重複")
        if ratios != sorted(ratios):
            raise ValueError("里程碑必須依進度比例由小到大排列")
        return v

    @field_validator("badges")
    @classmethod
    def _badges_cover_fixed_keys_exactly(cls, v: list[StoryPackBadge]) -> list[StoryPackBadge]:
        keys = {b.key for b in v}
        if keys != BADGE_KEYS:
            raise ValueError("徽章必須恰好是個人徽章與班級徽章各一個")
        return v


class StoryPackSummary(BaseModel):
    """List-view row — enough to pick a pack without fetching full content."""

    model_config = ConfigDict(extra="forbid")

    key: str
    era: str
    title: str
    is_builtin: bool
