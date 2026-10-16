#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate the 7 PK AI-opponent SVG art assets — PRD §10.5 (issue #3586).

Why a generator, not 56 hand-authored files: PRD §10.5.2 requires "7 位人物
共用同一套原創美術風格（同一個畫師/產線規格，不是東拼西湊)" — a single
parameterized template IS that shared production pipeline, and it is the
only way to guarantee all 7 figures (icon + 7 expression portraits each =
56 files) stay visually consistent instead of drifting file-by-file.

Per figure, two coordinate systems:
  - icon.svg              — viewBox 0 0 48 48, bold/simple, legible at 48px
                             display size (PRD §10.5.1 / §16.2 acceptance).
  - portrait-<expr>.svg   — viewBox 0 0 220 300, more detail retained,
                             legible at 390px width (PRD §10.5.1).

7 expressions per figure (PRD §10.5.3): idle, thinking, happy, impressed,
frustrated, victory, defeat — same base body/robe/prop, only the face
group (eyebrows/eyes/mouth) swaps, per §10.5.3 "同一張基礎立繪，只換臉部
局部". "defeat" (the AI loses) is explicitly gentle, never mocking.

Run: python3 scripts/generate_pk_figures.py
Output: public/pk/figures/<tier>-<slug>/{icon.svg, portrait-<expr>.svg, ART_BRIEF.md}
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.normpath(os.path.join(HERE, "..", "public", "pk", "figures"))

EXPRESSIONS = ("idle", "thinking", "happy", "impressed", "frustrated", "victory", "defeat")


@dataclass(frozen=True)
class Tier:
    tier: int
    slug: str
    name: str
    era: str  # "tang" | "song"
    hat: str  # "futou" | "dongpo" | "bun_pin" | "topknot" | "band"
    robe: str  # primary robe color
    robe_dark: str  # collar / fold shading
    accent: str  # sash / trim color
    prop: str  # prop key -> prop_svg()
    prop_color: str
    skin: str = "#F2C9A0"


TIERS: list[Tier] = [
    Tier(1, "luo-binwang", "駱賓王", "tang", "topknot", "#9ACD9A", "#6FA06F", "#E8E0C8", "goose", "#FFFFFF"),
    Tier(2, "meng-haoran", "孟浩然", "tang", "topknot", "#C9A876", "#9C7E51", "#E8E0C8", "dawn", "#F5B942"),
    Tier(3, "bai-juyi", "白居易", "tang", "futou", "#4F6FA3", "#35507E", "#D8C98A", "pipa", "#7A4B2A"),
    Tier(4, "li-qingzhao", "李清照", "song", "bun_pin", "#C97B9B", "#9E5679", "#EAD6E0", "chrysanthemum", "#F3D34A"),
    Tier(5, "du-fu", "杜甫", "tang", "band", "#9B8F7E", "#776C5D", "#D8C98A", "hut", "#8A5A3C"),
    Tier(6, "su-shi", "蘇軾", "song", "dongpo", "#D08A4C", "#A3652E", "#EADFC7", "staff", "#6B8E4E"),
    Tier(7, "li-bai", "李白", "tang", "topknot_loose", "#A98BC9", "#7C5FA0", "#F0E8FF", "moon_cup", "#F5D76E"),
]


# ---------------------------------------------------------------------------
# Shared body parts (portrait coordinate system: 220 x 300)
# ---------------------------------------------------------------------------

def _head(skin: str) -> str:
    return f'''
  <ellipse cx="110" cy="92" rx="38" ry="42" fill="{skin}"/>
  <ellipse cx="78" cy="96" rx="7" ry="9" fill="{skin}"/>
  <ellipse cx="142" cy="96" rx="7" ry="9" fill="{skin}"/>'''


def _hat(hat: str, accent: str, robe_dark: str) -> str:
    if hat == "futou":  # 幞頭：soft cap + two side wings (mid-rank official)
        return f'''
  <path d="M72 70 Q110 38 148 70 L148 60 Q110 30 72 60 Z" fill="{robe_dark}"/>
  <path d="M70 58 Q46 52 34 62 Q46 68 68 66 Z" fill="{robe_dark}"/>
  <path d="M150 58 Q174 52 186 62 Q174 68 152 66 Z" fill="{robe_dark}"/>'''
    if hat == "dongpo":  # 東坡巾：raised rectangular block (蘇軾 signature)
        return f'''
  <rect x="80" y="38" width="60" height="26" rx="4" fill="{robe_dark}"/>
  <rect x="86" y="30" width="48" height="16" rx="3" fill="{accent}"/>'''
    if hat == "bun_pin":  # female hair bun + ornamental pin (李清照)
        return f'''
  <circle cx="110" cy="54" r="24" fill="#3A2E22"/>
  <circle cx="110" cy="50" r="14" fill="#3A2E22"/>
  <line x1="122" y1="44" x2="150" y2="34" stroke="{accent}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="150" cy="34" r="4" fill="{accent}"/>'''
    if hat == "band":  # plain cloth headband, no official rank (杜甫)
        return f'''
  <path d="M72 76 Q110 56 148 76" fill="none" stroke="{robe_dark}" stroke-width="10" stroke-linecap="round"/>
  <circle cx="110" cy="58" r="16" fill="#3A2E22"/>'''
    if hat == "topknot_loose":  # flowing, unofficial (李白)
        return '''
  <path d="M86 58 Q110 30 134 58 Q128 44 110 42 Q92 44 86 58 Z" fill="#3A2E22"/>
  <circle cx="110" cy="46" r="10" fill="#3A2E22"/>'''
    # "topknot" default — simple scholar bun (駱賓王 / 孟浩然)
    return '''
  <circle cx="110" cy="54" r="20" fill="#3A2E22"/>
  <circle cx="110" cy="48" r="10" fill="#3A2E22"/>'''


def _collar(era: str, robe_dark: str) -> str:
    if era == "song":  # 交領 cross-collar
        return f'<path d="M86 132 L110 160 L134 132 L124 126 L110 140 L96 126 Z" fill="{robe_dark}"/>'
    # 唐 圓領 round collar
    return f'<path d="M92 128 Q110 146 128 128 L122 122 Q110 134 98 122 Z" fill="{robe_dark}"/>'


def _robe(robe: str, robe_dark: str, accent: str, era: str) -> str:
    collar = _collar(era, robe_dark)
    return f'''
  <path d="M46 300 L54 190 Q58 150 110 140 Q162 150 166 190 L174 300 Z" fill="{robe}"/>
  <path d="M46 300 L58 230 L78 300 Z" fill="{robe_dark}" opacity="0.35"/>
  <path d="M174 300 L162 230 L142 300 Z" fill="{robe_dark}" opacity="0.35"/>
  <rect x="90" y="186" width="40" height="70" rx="6" fill="{accent}" opacity="0.9"/>
  {collar}'''


# ---------------------------------------------------------------------------
# Face groups — one per expression (PRD §10.5.3 event -> expression map)
# ---------------------------------------------------------------------------

def _face(expr: str) -> str:
    # Eyebrows, eyes, mouth — simple path primitives, swapped as a unit.
    if expr == "idle":
        brows = '<path d="M86 84 Q94 80 102 84" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M118 84 Q126 80 134 84" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        eyes = '<ellipse cx="94" cy="94" rx="4" ry="5" fill="#3A2E22"/><ellipse cx="126" cy="94" rx="4" ry="5" fill="#3A2E22"/>'
        mouth = '<path d="M98 112 Q110 118 122 112" fill="none" stroke="#8A4A3C" stroke-width="3" stroke-linecap="round"/>'
    elif expr == "thinking":
        brows = '<path d="M86 82 Q94 86 102 83" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M118 83 Q126 79 134 82" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        eyes = '<path d="M90 94 Q94 90 98 94" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M122 94 Q126 90 130 94" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        mouth = '<path d="M102 114 Q110 110 118 114" fill="none" stroke="#8A4A3C" stroke-width="3" stroke-linecap="round"/>'
    elif expr == "happy":
        brows = '<path d="M86 80 Q94 76 102 80" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M118 80 Q126 76 134 80" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        eyes = '<path d="M88 94 Q94 88 100 94" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M120 94 Q126 88 132 94" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        mouth = '<path d="M94 110 Q110 126 126 110" fill="none" stroke="#8A4A3C" stroke-width="4" stroke-linecap="round"/>'
    elif expr == "impressed":
        brows = '<path d="M86 78 Q94 74 102 78" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M118 78 Q126 74 134 78" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        eyes = '<circle cx="94" cy="94" r="6" fill="#3A2E22"/><circle cx="126" cy="94" r="6" fill="#3A2E22"/>'
        mouth = '<ellipse cx="110" cy="114" rx="7" ry="6" fill="#8A4A3C"/>'
    elif expr == "frustrated":
        brows = '<path d="M86 86 Q94 80 102 85" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M118 85 Q126 80 134 86" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        eyes = '<path d="M90 96 L98 96" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M122 96 L130 96" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        mouth = '<path d="M98 116 Q110 110 122 116" fill="none" stroke="#8A4A3C" stroke-width="3" stroke-linecap="round"/>'
    elif expr == "victory":
        # Deliberately more exuberant than "happy" (not just a near-duplicate
        # of it) so the two are tellable apart in the 7x7 QA matrix (PRD
        # §16.2) -- raised arm-like cheer marks + tightly scrunched joyful
        # eyes, reused from this same quote-bearing celebration moment
        # (PRD §10.5.3: victory/happy are the only two with a real
        # classical-quote line attached).
        brows = '<path d="M84 76 Q94 68 104 76" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M116 76 Q126 68 136 76" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        eyes = '<path d="M86 94 Q94 84 102 94 Q94 90 86 94 Z" fill="#3A2E22"/><path d="M118 94 Q126 84 134 94 Q126 90 118 94 Z" fill="#3A2E22"/>'
        mouth = '<path d="M90 106 Q110 132 130 106 Q110 120 90 106 Z" fill="#8A4A3C"/>'
        cheer = '<path d="M62 70 L50 54" stroke="#F5A623" stroke-width="3" stroke-linecap="round"/><path d="M158 70 L170 54" stroke="#F5A623" stroke-width="3" stroke-linecap="round"/><path d="M70 50 L66 36" stroke="#F5A623" stroke-width="3" stroke-linecap="round"/><path d="M150 50 L154 36" stroke="#F5A623" stroke-width="3" stroke-linecap="round"/>'
        return f"\n  {brows}\n  {eyes}\n  {mouth}\n  {cheer}"
    else:  # defeat — gentle, friendly, never mocking (own loss, not the student's)
        brows = '<path d="M86 84 Q94 88 102 85" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M118 85 Q126 88 134 84" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        eyes = '<path d="M89 95 Q94 98 99 95" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/><path d="M121 95 Q126 98 131 95" fill="none" stroke="#3A2E22" stroke-width="3" stroke-linecap="round"/>'
        mouth = '<path d="M100 114 Q110 112 120 115" fill="none" stroke="#8A4A3C" stroke-width="3" stroke-linecap="round"/>'
    return f"\n  {brows}\n  {eyes}\n  {mouth}"


# ---------------------------------------------------------------------------
# Props — hand-authored per figure (PRD §10.5.2 cited identifying items)
# ---------------------------------------------------------------------------

def _prop(prop: str, color: str) -> str:
    if prop == "goose":  # 駱賓王《詠鵝》
        return f'''
  <g>
    <ellipse cx="0" cy="18" rx="20" ry="14" fill="{color}" stroke="#D8D8D8" stroke-width="1.5"/>
    <path d="M6 6 Q22 -10 30 -22" fill="none" stroke="{color}" stroke-width="10" stroke-linecap="round"/>
    <circle cx="31" cy="-24" r="7" fill="{color}"/>
    <path d="M36 -26 L46 -24 L36 -21 Z" fill="#F5A623"/>
    <circle cx="33" cy="-26" r="1.4" fill="#2A2A2A"/>
  </g>'''
    if prop == "dawn":  # 孟浩然《春曉》— sunrise + bird
        return f'''
  <g>
    <circle cx="0" cy="0" r="16" fill="{color}" opacity="0.9"/>
    <path d="M-26 10 Q-18 2 -10 8 Q-4 2 2 8" fill="none" stroke="#5E5B55" stroke-width="2.5" stroke-linecap="round"/>
  </g>'''
    if prop == "pipa":  # 白居易《琵琶行》
        return f'''
  <g>
    <ellipse cx="0" cy="10" rx="16" ry="22" fill="{color}"/>
    <rect x="-4" y="-34" width="8" height="30" rx="3" fill="{color}"/>
    <ellipse cx="0" cy="-36" rx="7" ry="5" fill="{color}"/>
    <line x1="0" y1="-30" x2="0" y2="26" stroke="#2A2A2A" stroke-width="1"/>
    <line x1="-4" y1="-28" x2="-4" y2="24" stroke="#2A2A2A" stroke-width="1"/>
    <line x1="4" y1="-28" x2="4" y2="24" stroke="#2A2A2A" stroke-width="1"/>
  </g>'''
    if prop == "chrysanthemum":  # 李清照《醉花陰》
        return f'''
  <g>
    <circle cx="0" cy="0" r="6" fill="#8A6A2A"/>
    <g fill="{color}">
      <ellipse cx="0" cy="-12" rx="5" ry="10"/>
      <ellipse cx="0" cy="12" rx="5" ry="10"/>
      <ellipse cx="-12" cy="0" rx="10" ry="5"/>
      <ellipse cx="12" cy="0" rx="10" ry="5"/>
      <ellipse cx="-9" cy="-9" rx="8" ry="5" transform="rotate(-45 -9 -9)"/>
      <ellipse cx="9" cy="-9" rx="8" ry="5" transform="rotate(45 9 -9)"/>
      <ellipse cx="-9" cy="9" rx="8" ry="5" transform="rotate(45 -9 9)"/>
      <ellipse cx="9" cy="9" rx="8" ry="5" transform="rotate(-45 9 9)"/>
    </g>
    <rect x="-2" y="4" width="4" height="26" fill="#6FA06F"/>
  </g>'''
    if prop == "hut":  # 杜甫《茅屋為秋風所破歌》
        return f'''
  <g>
    <path d="M-24 10 L0 -16 L24 10 Z" fill="{color}"/>
    <rect x="-18" y="10" width="36" height="20" fill="#D8C99E"/>
    <rect x="-5" y="16" width="10" height="14" fill="#5E4A33"/>
  </g>'''
    if prop == "staff":  # 蘇軾《定風波》"竹杖芒鞋"
        return f'''
  <g>
    <line x1="0" y1="-30" x2="0" y2="40" stroke="{color}" stroke-width="7" stroke-linecap="round"/>
    <line x1="-4" y1="-18" x2="4" y2="-18" stroke="#3A5E2E" stroke-width="3"/>
    <line x1="-4" y1="0" x2="4" y2="0" stroke="#3A5E2E" stroke-width="3"/>
    <line x1="-4" y1="18" x2="4" y2="18" stroke="#3A5E2E" stroke-width="3"/>
    <ellipse cx="-2" cy="46" rx="14" ry="6" fill="#C9A876"/>
  </g>'''
    # moon_cup — 李白《靜夜思》/《月下獨酌》
    return f'''
  <g>
    <path d="M14 -14 A16 16 0 1 0 14 14 A12 12 0 1 1 14 -14 Z" fill="{color}"/>
    <g transform="translate(0,34)">
      <path d="M-12 -6 L12 -6 L9 8 Q0 14 -9 8 Z" fill="#E8E0C8" stroke="#B9A066" stroke-width="1.5"/>
      <ellipse cx="0" cy="-6" rx="12" ry="3" fill="#F5EEDD"/>
    </g>
  </g>'''


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

# Portrait: prop sits on the figure's right shoulder (viewer's right side of
# the frame), same anchor point for every figure -- each prop's own local
# shapes (after the translate-stripping above) are already centered near
# their own (0,0), so one shared anchor keeps the composition consistent.
_PORTRAIT_PROP_ANCHOR = (170, 196)
# Icon: the head+hat+face group's bounding box in the ORIGINAL 220x300
# coordinate space is roughly x:72-186 (futou's wings are the widest hat),
# y:30-120 (hat top to chin) -- center (129,75). Solved for
# translate(tx,ty) scale(0.3) placing that center at icon-space (24,22):
#   tx = 24 - 0.3*129 = -14.7 ; ty = 22 - 0.3*75 = -0.5
_ICON_HEAD_TRANSFORM = "translate(-14.7,-0.5) scale(0.3)"


def build_portrait(t: Tier, expr: str) -> str:
    body = _robe(t.robe, t.robe_dark, t.accent, t.era)
    hat = _hat(t.hat, t.accent, t.robe_dark)
    head = _head(t.skin)
    face = _face(expr)
    px, py = _PORTRAIT_PROP_ANCHOR
    prop = f'<g transform="translate({px},{py})">{_prop(t.prop, t.prop_color)}</g>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 300" width="220" height="300" role="img" aria-label="{t.name}">
  <title>{t.name}（{expr}）</title>
  <rect x="0" y="0" width="220" height="300" fill="none"/>
  {body}
  {head}
  {hat}
  {face}
  {prop}
</svg>
'''


def build_icon(t: Tier) -> str:
    # Bold, simplified: colored circle badge (robe color) + hat silhouette +
    # a simple face. The identifying PROP is deliberately NOT squeezed into
    # the 48px icon (every prop has a different local bounding box, so one
    # shared small-scale transform either clips some or shrinks others to
    # invisibility) -- PRD §10.5.1 only requires the icon be distinguishable
    # from the other 6 at 48px, not that the prop specifically be legible
    # there; color + hat silhouette + face already gives 7 distinct
    # silhouettes (5 hat shapes x 7 robe colors), and the prop is fully
    # legible on the portrait (§10.5.1's actual requirement for props).
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="{t.name}">
  <title>{t.name}</title>
  <circle cx="24" cy="24" r="23" fill="{t.robe}"/>
  <circle cx="24" cy="24" r="23" fill="none" stroke="{t.robe_dark}" stroke-width="2"/>
  <g transform="{_ICON_HEAD_TRANSFORM}">
    {_head(t.skin)}
    {_hat(t.hat, t.accent, t.robe_dark)}
    <circle cx="94" cy="94" r="5" fill="#3A2E22"/>
    <circle cx="126" cy="94" r="5" fill="#3A2E22"/>
    <path d="M94 112 Q110 120 126 112" fill="none" stroke="#8A4A3C" stroke-width="5" stroke-linecap="round"/>
  </g>
</svg>
'''


PROP_CITATION = {
    "goose": "《詠鵝》——「鵝鵝鵝，曲項向天歌」",
    "dawn": "《春曉》——「春眠不覺曉，處處聞啼鳥」",
    "pipa": "《琵琶行》——「同是天涯淪落人」，琵琶是全詩核心意象",
    "chrysanthemum": "《醉花陰》——「簾捲西風，人比黃花瘦」（黃花即菊花）",
    "hut": "《茅屋為秋風所破歌》——「安得廣廈千萬間」",
    "staff": "《定風波》——「竹杖芒鞋輕勝馬，誰怕？一蓑煙雨任平生」",
    "moon_cup": "《月下獨酌》——「舉杯邀明月，對影成三人」",
}

HAT_NOTE = {
    "futou": "幞頭（唐代官帽，雙翅）——示意性傳統美術元素，非文物等級服飾考證",
    "dongpo": "東坡巾——民間長期流傳、與蘇軾本人高度連結的傳統配飾",
    "bun_pin": "宋代女子髮髻＋髮簪——示意性傳統美術元素",
    "band": "素色頭巾（無官帽，呼應杜甫仕途不順、生活困頓的形象）",
    "topknot": "文人髮髻（無官帽）",
    "topknot_loose": "鬆散髮髻，呼應李白性格豪放不羈、不戀官位的形象",
}


def build_art_brief(t: Tier) -> str:
    era_label = "唐代" if t.era == "tang" else "宋代"
    return f"""# PK 對手美術規格書 — {t.name}（第 {t.tier} 級）

> 產製方式：本案不叫任何其他 LLM 或繪圖生成模型 —— 由 Claude 以 SVG（向量圖形）繪製，
> 透過 `frontend/scripts/generate_pk_figures.py` 的共用產線產生，確保 7 位人物風格一致。
> 原創創作，不臨摹任何既有畫作、教科書插圖或其他遊戲的角色設計。

## 基本資料
- 朝代：{era_label}（{t.era}）
- 風格：扁平向量插畫（flat vector mascot），對國小學生友善，不做漫畫化嘲諷或滑稽變形

## 色票
| 用途 | 色值 |
|---|---|
| 袍服主色 | `{t.robe}` |
| 袍服暗部／領口 | `{t.robe_dark}` |
| 腰帶／配飾 | `{t.accent}` |
| 道具主色 | `{t.prop_color}` |
| 膚色 | `{t.skin}` |

## 頭飾
{HAT_NOTE[t.hat]}

## 識別道具
道具：**{t.prop}** —— 依據作品：{PROP_CITATION[t.prop]}

## 服飾朝代備註
{"唐代圓領袍衫" if t.era == "tang" else "宋代交領直裰"} —— 示意性的傳統美術元素，不宣稱精確還原歷史服裝。

## 資產清單
- `icon.svg`（48×48，列表／分數條頭像用，不含表情變化）
- `portrait-idle.svg` / `portrait-thinking.svg` / `portrait-happy.svg` /
  `portrait-impressed.svg` / `portrait-frustrated.svg` / `portrait-victory.svg` /
  `portrait-defeat.svg`（220×300，VS 畫面／生平動畫／結果頁用，7 種表情共用同一套
  髮型／袍服／道具，只有臉部表情局部不同 —— PRD §10.5.3）

## 表情對照（PRD §10.5.3 事件 -> 表情）
| 事件 | 表情檔 |
|---|---|
| 進入「選一位對手」畫面／對戰尚未開始 | `portrait-idle.svg` |
| 學生作答倒數進行中 | `portrait-thinking.svg` |
| 揭曉：AI 這題自己答對 | `portrait-happy.svg` |
| 揭曉：學生這題答對 | `portrait-impressed.svg` |
| 揭曉：AI 這題自己答錯 | `portrait-frustrated.svg` |
| 結果畫面，AI 贏 | `portrait-victory.svg` |
| 結果畫面，學生贏 | `portrait-defeat.svg`（有風度，絕不嘲笑學生 —— 鐵律）|

## 重畫／調整風格依據
之後如需重畫或調整風格，改 `frontend/scripts/generate_pk_figures.py` 裡
`TIERS` 清單中 tier={t.tier}（slug="{t.slug}"）的設定，並重新執行該腳本 ——
不要個別手改產出的 SVG 檔，否則下次重新產生時手改內容會遺失。
"""


def main() -> None:
    for t in TIERS:
        out_dir = os.path.join(OUT_ROOT, f"{t.tier}-{t.slug}")
        os.makedirs(out_dir, exist_ok=True)

        with open(os.path.join(out_dir, "icon.svg"), "w", encoding="utf-8") as f:
            f.write(build_icon(t))

        for expr in EXPRESSIONS:
            with open(os.path.join(out_dir, f"portrait-{expr}.svg"), "w", encoding="utf-8") as f:
                f.write(build_portrait(t, expr))

        with open(os.path.join(out_dir, "ART_BRIEF.md"), "w", encoding="utf-8") as f:
            f.write(build_art_brief(t))

        print(f"tier {t.tier} ({t.name}): wrote icon.svg + {len(EXPRESSIONS)} portraits + ART_BRIEF.md -> {out_dir}")


if __name__ == "__main__":
    main()
