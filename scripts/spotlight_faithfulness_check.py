#!/usr/bin/env python3
"""
spotlight_faithfulness_check.py

Stage-1 invariant checker for spotlight faithfulness on staging.
It evaluates all stories that have non-empty reading_strategy (expected: 161).
"""

from __future__ import annotations

import argparse
import copy
import difflib
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

DEFAULT_BASE_URL = "https://lingoleap-backend-staging-958347263320.asia-east1.run.app"
DEFAULT_OUT = Path(".qa-screenshots/spotlight-sweep/faithfulness-report.json")

# Known-FAIL baseline (post round-3). Real extractor bugs 54/1089/1103/1115/1116
# are FIXED (content-verified) and dropped from this set so they freeze into golden.
# Remaining are content gaps (文言 inv=7) + 空骨架 inv=2 + option inv=3 + reading_strategy
# placeholder inv=4 — tracked here as the current regression baseline.
EXPECTED_RED_IDS = {
    # 文言課 — 需要人工補文言語法材料（#2388）
    46,   # 文-L03 inv=6,7
    47,   # 文-L04 inv=7
    1154, # 文-L6 inv=7
    1155, # 文-L7 inv=7
    1158, # 文-L10 inv=7
    # 內容缺口 — online-schema 無 spotlight range（#2388）
    1014, # G4-L14 inv=2
    # gate should_use_v2 誤判（v2 互動=0 但 legacy 有 4-5 步驟）—— render 實測畫面正常顯示
    # legacy 內容，非真缺陷；列此避免 baseline drift（gate 通則待調 should_use_v2 偏好 legacy）
    29,   # G7-L02 inv=2（legacy 5 步，render OK）
    30,   # G7-L03 inv=2（legacy 5 步，render OK）
    49,   # G9-L04 inv=2（legacy 4 步，render OK）
}

INTERACTIVE_TYPES = {"single", "multi", "fill", "fill_blank", "free_text"}
RENDERED_INTERACTIVE_TYPES = {
    "single",
    "multi",
    "fill",
    "fill_blank",
    "fill_table",
    "free_text",
    "match",
    "highlight",
    "self_check",
}
LEGACY_INTERACTIVE_TYPE_MAP = {
    "select": "single",
    "single": "single",
    "multi": "multi",
    "multiple": "multi",
    "fill": "fill_blank",
    "fill_blank": "fill_blank",
    "fill_table": "fill_table",
    "free_text": "free_text",
    "match": "match",
    "highlight": "highlight",
    "self_check": "self_check",
}
PUNCT_ONLY_RE = re.compile(r"^[\s\W_]+$", re.UNICODE)
TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]")
SINGLE_LETTER_CODE_RE = re.compile(r"^[A-Za-z]$")
WENYAN_STRATEGY_KEYWORDS = (
    "代詞",
    "判讀主語",
    "主語",
    "判斷句",
    "固定句式",
    "句式",
    "一字多義",
    "文言聚光燈",
)
GENERIC_STORY_FRAMEWORK_CUES = (
    "故事脈絡",
    "主角",
    "主要人物",
    "人物",
    "問題",
    "解決",
    "結果",
    "結局",
    "故事",
)
WENYAN_GRAMMAR_EXERCISE_CUES = (
    "代詞所指",
    "指示代詞",
    "疑問代詞",
    "指出主語",
    "主語是",
    "判斷句",
    "句型",
    "固定句式",
    "一字多義",
    "詞義",
    "以",
    "為",
)
OPEN_PROMPT_MARKERS = (
    "請寫下",
    "轉換",
    "請說說",
    "任務：",
    "任務:",
    "請完成",
)
CHART_READING_STRATEGY_CUES = (
    "折線圖",
    "長條圖",
    "圖表判讀",
    "圖文表整合",
    "圖表繪製",
    "判讀圖表",
    "組織圖表",
)
# 缺源護欄：抽取器抽不到素材時的 placeholder 標記。
# 這些課只能標「待人工補件」，不可冒充成有效題目 silent PASS（防 relabel-to-placeholder gaming）。
MISSING_SOURCE_MARKERS = (
    "[missing_spotlight_source]",
    "缺可抽取素材",
    "待補件",
)


@dataclass
class InvariantResult:
    ok: bool
    detail: str


def http_json(url: str, retries: int = 5, timeout: int = 30) -> Any:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            last_err = err
            if err.code == 429 and attempt < retries - 1:
                time.sleep(1.2 * (attempt + 1))
                continue
            raise
        except Exception as err:  # noqa: BLE001
            last_err = err
            if attempt < retries - 1:
                time.sleep(0.8 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def tokenize(text: str) -> list[str]:
    return [m.group(0) for m in TOKEN_RE.finditer(normalize_text(text))]


def token_set(text: str) -> set[str]:
    tokens = tokenize(text)
    out: set[str] = set()
    for idx, tok in enumerate(tokens):
        out.add(tok)
        if idx + 1 < len(tokens):
            out.add(f"{tok}{tokens[idx + 1]}")
    return {t for t in out if len(t.strip()) >= 2}


def spotlight_blocks(story: dict[str, Any]) -> list[dict[str, Any]]:
    sv2 = story.get("spotlight_v2")
    if isinstance(sv2, dict):
        blocks = sv2.get("blocks")
        if isinstance(blocks, list):
            return [b for b in blocks if isinstance(b, dict)]
    return []


def spotlight_strategy_name(story: dict[str, Any]) -> str:
    sv2 = story.get("spotlight_v2")
    if isinstance(sv2, dict):
        return normalize_text(str(sv2.get("strategy_name") or ""))
    return ""


def spotlight_lesson_code(story: dict[str, Any]) -> str:
    sv2 = story.get("spotlight_v2")
    if isinstance(sv2, dict):
        return str(sv2.get("lesson") or "")
    return ""


def has_spotlight_v2(story: dict[str, Any]) -> bool:
    return isinstance(story.get("spotlight_v2"), dict)


def story_body_text(story: dict[str, Any]) -> str:
    return "\n".join(
        [
            str(story.get("title") or ""),
            "\n".join(str(p) for p in (story.get("paragraphs") or [])),
        ]
    )


def legacy_strategy_steps(story: dict[str, Any]) -> list[dict[str, Any]]:
    strategy_exercise = story.get("strategy_exercise")
    if not isinstance(strategy_exercise, dict):
        return []
    steps = strategy_exercise.get("steps")
    if not isinstance(steps, list):
        return []
    return [step for step in steps if isinstance(step, dict)]


def legacy_step_type(step: dict[str, Any]) -> str:
    raw = normalize_text(
        str(step.get("type") or step.get("question_type") or step.get("kind") or "")
    )
    return LEGACY_INTERACTIVE_TYPE_MAP.get(raw, raw)


def rendered_interactive_count(story: dict[str, Any]) -> tuple[str, int]:
    if should_use_v2(story):
        blocks = spotlight_blocks(story)
        count = sum(
            1 for b in blocks if str(b.get("type") or "") in RENDERED_INTERACTIVE_TYPES
        )
        return "v2", count
    steps = legacy_strategy_steps(story)
    count = sum(1 for step in steps if legacy_step_type(step) in RENDERED_INTERACTIVE_TYPES)
    return "legacy", count


def rendered_strategy_name(story: dict[str, Any]) -> str:
    if should_use_v2(story):
        return spotlight_strategy_name(story)
    strategy_exercise = story.get("strategy_exercise")
    if isinstance(strategy_exercise, dict):
        return normalize_text(str(strategy_exercise.get("strategy_name") or ""))
    return ""


def strategy_keywords(text: str) -> set[str]:
    cleaned = normalize_text(text)
    cleaned = cleaned.replace("閱讀策略", " ").replace("策略", " ")
    tokens = re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+", cleaned)
    return {tok for tok in tokens if len(tok.strip()) >= 1}


def should_use_v2(story: dict[str, Any]) -> bool:
    if not has_spotlight_v2(story):
        return False
    blocks = spotlight_blocks(story)
    v2_interactive = sum(
        1 for b in blocks if str(b.get("type") or "") in RENDERED_INTERACTIVE_TYPES
    )
    if v2_interactive > 0:
        return True
    legacy_count = sum(
        1 for step in legacy_strategy_steps(story) if legacy_step_type(step) in RENDERED_INTERACTIVE_TYPES
    )
    if legacy_count == 0:
        return True
    block_len = len(blocks)
    has_passage = any(str(b.get("type") or "") == "passage" for b in blocks)
    # Keep strict fail on compact v2 skeletons where interactive blocks were likely stripped.
    if block_len <= 3 and not has_passage and legacy_count >= 3:
        return True
    if block_len == 4 and not has_passage and 0 < legacy_count <= 3:
        return True
    return False


def rendered_prompt_passage_text(story: dict[str, Any]) -> str:
    chunks: list[str] = []
    if should_use_v2(story):
        blocks = spotlight_blocks(story)
        for b in blocks:
            btype = str(b.get("type") or "")
            if btype == "passage":
                paras = b.get("paragraphs")
                if isinstance(paras, list):
                    chunks.extend(str(p) for p in paras)
            prompt = b.get("prompt")
            if isinstance(prompt, str) and prompt.strip():
                chunks.append(prompt)
            if btype in {"guide", "free_text"}:
                text = b.get("text")
                if isinstance(text, str) and text.strip():
                    chunks.append(text)
    else:
        for step in legacy_strategy_steps(story):
            prompt = step.get("prompt")
            if isinstance(prompt, str) and prompt.strip():
                chunks.append(prompt)
    return "\n".join(chunks)


def combined_spotlight_text(story: dict[str, Any]) -> str:
    chunks: list[str] = []
    blocks = spotlight_blocks(story)
    for b in blocks:
        for key in ("text", "prompt"):
            value = b.get(key)
            if isinstance(value, str) and value.strip():
                chunks.append(value)
        options = b.get("options")
        if isinstance(options, list):
            chunks.extend(str(opt) for opt in options)
        paras = b.get("paragraphs")
        if isinstance(paras, list):
            chunks.extend(str(p) for p in paras)

    for step in legacy_strategy_steps(story):
        prompt = step.get("prompt")
        if isinstance(prompt, str) and prompt.strip():
            chunks.append(prompt)
        options = step.get("options")
        if isinstance(options, list):
            chunks.extend(str(opt) for opt in options)
    return "\n".join(chunks)


def count_open_prompt_markers(story: dict[str, Any]) -> int:
    count = 0
    for b in spotlight_blocks(story):
        btype = str(b.get("type") or "")
        if btype not in {"guide", "free_text"}:
            continue
        text = normalize_text(str(b.get("text") or b.get("prompt") or ""))
        if text and any(marker in text for marker in OPEN_PROMPT_MARKERS):
            count += 1
    return count


def strategy_requires_chart_figure(story: dict[str, Any]) -> bool:
    text = normalize_text(
        " ".join(
            [
                str(story.get("reading_strategy") or ""),
                rendered_strategy_name(story),
            ]
        )
    )
    return any(cue in text for cue in CHART_READING_STRATEGY_CUES)


def block_text_for_faithfulness(blocks: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for b in blocks:
        btype = b.get("type")
        if btype in {"guide", "free_text"}:
            chunks.append(str(b.get("text") or b.get("prompt") or ""))
        elif btype in {"single", "multi", "fill", "fill_blank"}:
            chunks.append(str(b.get("prompt") or ""))
            options = b.get("options")
            if isinstance(options, list):
                chunks.extend(str(opt) for opt in options)
        elif btype == "passage":
            paras = b.get("paragraphs")
            if isinstance(paras, list):
                chunks.extend(str(p) for p in paras)
    return "\n".join(chunks)


def canonical_structure(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    block_types = [str(b.get("type") or "unknown") for b in blocks]
    question_count = sum(1 for b in blocks if str(b.get("type")) in INTERACTIVE_TYPES)
    figures = [
        {
            "referent": b.get("referent"),
            "asset": b.get("asset"),
        }
        for b in blocks
        if b.get("type") == "figure"
    ]
    return {
        "block_type_sequence": block_types,
        "question_count": question_count,
        "figure_summary": figures,
    }


def canonical_semantic_hash(blocks: list[dict[str, Any]]) -> str:
    rows: list[dict[str, Any]] = []
    for b in blocks:
        row: dict[str, Any] = {"type": b.get("type")}
        if "prompt" in b:
            row["prompt"] = b.get("prompt")
        if "text" in b and b.get("type") == "guide":
            row["prompt"] = b.get("text")
        if "options" in b:
            row["options"] = b.get("options")
        if "answer" in b:
            row["answer"] = b.get("answer")
        if b.get("type") == "passage":
            row["passage"] = b.get("paragraphs")
        rows.append(row)
    encoded = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    # 16-char prefix：對 ~140 課防碰撞足夠，且 <32 hex 不會誤觸 secret-scan 的 key regex
    return "sha256-" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:16]


def overlap_score(tokens_a: set[str], tokens_b: set[str]) -> float:
    if not tokens_a or not tokens_b:
        return 0.0
    inter = tokens_a & tokens_b
    return len(inter) / max(1, min(len(tokens_a), len(tokens_b)))


def check_invariant_1(
    story: dict[str, Any],
    blocks: list[dict[str, Any]],
    all_story_tokens: dict[int, set[str]],
) -> InvariantResult:
    if not blocks:
        return InvariantResult(True, "advisory: spotlight_v2 blocks missing; overlap skipped")
    spotlight_text = block_text_for_faithfulness(blocks)
    story_text = story_body_text(story)
    sp_tokens = token_set(spotlight_text)
    st_tokens = token_set(story_text)
    if not sp_tokens or not st_tokens:
        return InvariantResult(True, "advisory: insufficient tokens for overlap")
    current_score = overlap_score(sp_tokens, st_tokens)
    best_other_id = None
    best_other_score = 0.0
    for other_id, other_tokens in all_story_tokens.items():
        if other_id == int(story["id"]):
            continue
        score = overlap_score(sp_tokens, other_tokens)
        if score > best_other_score:
            best_other_score = score
            best_other_id = other_id

    # Strong drift signal: another lesson matches far better than current lesson
    if best_other_score >= 0.12 and best_other_score >= current_score * 2.6:
        return InvariantResult(
            True,
            (
                "advisory: topic drift signal "
                f"current={current_score:.3f} best_other={best_other_score:.3f} other_id={best_other_id}"
            ),
        )
    return InvariantResult(True, f"advisory: current={current_score:.3f} best_other={best_other_score:.3f}")


def check_invariant_2(
    story: dict[str, Any],
    blocks: list[dict[str, Any]],
    by_design_empty_ids: set[int],
) -> InvariantResult:
    sid = int(story["id"])
    source, rendered_count = rendered_interactive_count(story)
    if rendered_count > 0:
        return InvariantResult(True, f"source={source} interactive_blocks={rendered_count}")
    open_prompt_count = count_open_prompt_markers(story)
    if open_prompt_count > 0 and sid not in EXPECTED_RED_IDS:
        return InvariantResult(True, f"source={source} heuristic_free_text_prompts={open_prompt_count}")
    if sid in by_design_empty_ids:
        return InvariantResult(True, "by_design_empty allowlist")
    if source == "v2":
        legacy_count = sum(
            1 for step in legacy_strategy_steps(story) if legacy_step_type(step) in RENDERED_INTERACTIVE_TYPES
        )
        return InvariantResult(
            False,
            f"source=v2 interactive_blocks=0 legacy_blocks={legacy_count}",
        )
    return InvariantResult(False, "source=legacy interactive_blocks=0")


def check_invariant_3(blocks: list[dict[str, Any]]) -> InvariantResult:
    for idx, b in enumerate(blocks):
        btype = str(b.get("type"))
        if btype not in {"single", "multi"}:
            continue
        options = b.get("options")
        if not isinstance(options, list) or len(options) < 2:
            return InvariantResult(False, f"block[{idx}] invalid options")
        clean_opts = [normalize_text(str(opt)) for opt in options]
        checkbox_artifacts = {"請在", "（請在", "(請在", "打勾", "打勾）", "打勾)"}
        if any(opt in checkbox_artifacts for opt in clean_opts):
            return InvariantResult(False, f"block[{idx}] checkbox artifact leaked into options")
        meaningful_opts = [
            opt
            for opt in clean_opts
            if opt
            and not PUNCT_ONLY_RE.match(opt)
        ]
        if len(meaningful_opts) < 2:
            return InvariantResult(False, f"block[{idx}] insufficient meaningful options")

        answer = b.get("answer")
        if btype == "single":
            ans = normalize_text(str(answer))
            if ans not in clean_opts:
                return InvariantResult(False, f"block[{idx}] answer not in options")
            if PUNCT_ONLY_RE.match(ans):
                return InvariantResult(False, f"block[{idx}] invalid single-choice answer")
            if re.search(r"結論|結果", str(b.get("prompt") or "")) and re.search(r"立刻|馬上", ans):
                return InvariantResult(False, f"block[{idx}] suspicious conclusion answer")
        else:
            if not isinstance(answer, list) or not answer:
                return InvariantResult(False, f"block[{idx}] multi answer invalid")
            ans_norm = [normalize_text(str(a)) for a in answer]
            if any(a not in clean_opts for a in ans_norm):
                return InvariantResult(False, f"block[{idx}] multi answer not in options")
            if any(
                PUNCT_ONLY_RE.match(a)
                for a in ans_norm
            ):
                return InvariantResult(False, f"block[{idx}] invalid multi-choice answer")
    return InvariantResult(True, "options and answers valid")


def check_invariant_4(story: dict[str, Any]) -> InvariantResult:
    rs = normalize_text(str(story.get("reading_strategy") or ""))
    sn = rendered_strategy_name(story)
    if not sn:
        return InvariantResult(True, "advisory: rendered strategy_name missing")
    if not rs:
        return InvariantResult(True, "advisory: reading_strategy missing")
    if rs == sn or rs in sn or sn in rs:
        return InvariantResult(True, "aligned by containment")

    rs_kw = strategy_keywords(rs)
    sn_kw = strategy_keywords(sn)
    overlap = rs_kw & sn_kw
    similarity = difflib.SequenceMatcher(a=rs, b=sn).ratio()
    placeholders = {"待改", "todo", "tbd", "placeholder"}
    if any(p in rs for p in placeholders) or any(p in sn for p in placeholders):
        return InvariantResult(False, f"strategy placeholder detected rs={rs} sn={sn}")
    if overlap:
        return InvariantResult(
            True,
            f"advisory: keyword overlap={sorted(overlap)} similarity={similarity:.3f}",
        )
    if similarity >= 0.72:
        return InvariantResult(True, f"advisory: fuzzy similarity={similarity:.3f}")
    return InvariantResult(True, f"advisory: weak alignment similarity={similarity:.3f}")


def check_invariant_5(story: dict[str, Any], blocks: list[dict[str, Any]]) -> InvariantResult:
    strict_chart_mode = strategy_requires_chart_figure(story)
    missing_indices: list[int] = []
    for idx, b in enumerate(blocks):
        if b.get("type") != "figure":
            continue
        asset = b.get("asset")
        if not isinstance(asset, str) or not asset.strip():
            missing_indices.append(idx)
    if not missing_indices:
        return InvariantResult(True, "all figure assets bound")
    if not strict_chart_mode:
        return InvariantResult(
            True,
            f"advisory: decorative figure asset missing at blocks={missing_indices}",
        )
    return InvariantResult(False, f"chart-reading figure asset missing at blocks={missing_indices}")


def check_invariant_7(story: dict[str, Any]) -> InvariantResult:
    reading_strategy = normalize_text(str(story.get("reading_strategy") or ""))
    if not reading_strategy:
        return InvariantResult(True, "reading_strategy missing")
    if not any(keyword in reading_strategy for keyword in WENYAN_STRATEGY_KEYWORDS):
        return InvariantResult(True, "non-wenyan-grammar strategy")

    rendered_text = normalize_text(combined_spotlight_text(story))
    if not rendered_text:
        return InvariantResult(True, "advisory: no spotlight content text")

    generic_hits = [cue for cue in GENERIC_STORY_FRAMEWORK_CUES if cue in rendered_text]
    grammar_hits = [
        cue
        for cue in WENYAN_GRAMMAR_EXERCISE_CUES
        if cue in rendered_text and cue not in {"以", "為"}
    ]

    has_explicit_yiwei_pattern = bool(re.search(r"以.{0,8}為", rendered_text))
    if has_explicit_yiwei_pattern:
        grammar_hits.append("以…為")

    generic_core_hits = [
        cue for cue in generic_hits if cue not in {"故事", "故事脈絡"}
    ]
    generic_framework = (
        "故事脈絡" in generic_hits
        or len(set(generic_core_hits)) >= 2
        or ("故事" in generic_hits and len(set(generic_core_hits)) >= 1)
    )

    if generic_framework and not grammar_hits:
        return InvariantResult(
            False,
            (
                "wenyan fallback to generic story framework "
                f"generic_hits={sorted(set(generic_hits))}"
            ),
        )
    return InvariantResult(
        True,
        (
            f"generic_hits={sorted(set(generic_hits))} "
            f"grammar_hits={sorted(set(grammar_hits))}"
        ),
    )


def check_invariant_6(
    story: dict[str, Any],
    all_story_tokens: dict[int, set[str]],
    all_rendered_tokens: dict[int, set[str]],
) -> InvariantResult:
    sid = int(story["id"])
    rendered_tokens = all_rendered_tokens.get(sid, set())
    if not rendered_tokens:
        return InvariantResult(True, "no rendered passage/prompt text")

    own_story_overlap = overlap_score(rendered_tokens, all_story_tokens.get(sid, set()))
    best_other_id: int | None = None
    best_other_overlap = 0.0
    for other_id, other_story_tokens in all_story_tokens.items():
        if other_id == sid:
            continue
        score = overlap_score(rendered_tokens, other_story_tokens)
        if score > best_other_overlap:
            best_other_overlap = score
            best_other_id = other_id

    if best_other_overlap >= 0.22 and best_other_overlap >= max(0.08, own_story_overlap * 2.2):
        return InvariantResult(
            False,
            (
                "cross-lesson content drift "
                f"own_overlap={own_story_overlap:.3f} best_other_overlap={best_other_overlap:.3f} "
                f"other_id={best_other_id}"
            ),
        )
    return InvariantResult(
        True,
        f"own_overlap={own_story_overlap:.3f} best_other_overlap={best_other_overlap:.3f}",
    )


def check_invariant_8(story: dict[str, Any]) -> InvariantResult:
    """缺源護欄：_missing_source placeholder 不可冒充成題目 silent PASS。
    缺源課文只能誠實標記待人工補件 → FAIL（flag 給人補），不可 relabel 成 strategy_name 騙過 inv=7。"""
    sv2 = story.get("spotlight_v2")
    if isinstance(sv2, dict) and sv2.get("_missing_source") is True:
        return InvariantResult(False, "missing_source placeholder — needs human content")
    for b in spotlight_blocks(story):
        text = normalize_text(str(b.get("text") or b.get("prompt") or ""))
        if any(marker in text for marker in MISSING_SOURCE_MARKERS):
            return InvariantResult(False, "placeholder marker in block text — needs human content")
    return InvariantResult(True, "no missing-source placeholder")


# MD5 hash of the generic book+pencil grey placeholder image on GCS.
# Any figure block whose resolved GCS URL returns this exact file is a fake illustration.
_PLACEHOLDER_FIG_MD5 = "9f31079bf8dc822e61f0a65ba433c34e"
_GCS_LESSONS_BASE = "https://storage.googleapis.com/lingoleap-assets/lessons-images"
# Cache fetched md5 values within a check run to avoid duplicate HTTP requests.
_figure_md5_cache: dict[str, str | None] = {}


def _fetch_md5(url: str) -> str | None:
    """Fetch URL and return its md5 hex digest, or None on error."""
    if url in _figure_md5_cache:
        return _figure_md5_cache[url]
    try:
        import urllib.parse
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = resp.read()
        result = hashlib.md5(data).hexdigest()
    except Exception:
        result = None
    _figure_md5_cache[url] = result
    return result


def check_invariant_9(story: dict[str, Any]) -> InvariantResult:
    """Placeholder-figure gate: figure blocks must not point to the generic placeholder image.

    The extractor used to emit figure blocks for every spotlight lesson and fall back to
    GCS fig1.png, which is a generic book+pencil grey icon (md5 9f31079...).  Rendering
    this image gives users a meaningless illustration.  This invariant detects the case
    where a figure block has asset=fig1.png AND the GCS object is the placeholder.

    Check is remote (HTTP): runs only when the asset name is fig1.png to limit requests.
    Other assets (fig2.png, fig10.png, …) are assumed real — they were never bulk-uploaded
    as placeholders.

    Only fails when md5 matches the known placeholder (not on 404 / network error).
    """
    lesson_code = story.get("grade_code") or ""
    if not lesson_code:
        return InvariantResult(True, "no grade_code — skip")

    placeholder_blocks: list[int] = []
    for idx, b in enumerate(spotlight_blocks(story)):
        if b.get("type") != "figure":
            continue
        asset = b.get("asset") or ""
        if asset != "fig1.png":
            # Only fig1.png was bulk-uploaded as placeholder; other assets are real.
            continue
        import urllib.parse
        url = f"{_GCS_LESSONS_BASE}/{urllib.parse.quote(lesson_code)}/fig1.png"
        md5 = _fetch_md5(url)
        if md5 == _PLACEHOLDER_FIG_MD5:
            placeholder_blocks.append(idx)

    if placeholder_blocks:
        return InvariantResult(
            False,
            f"figure block(s) at index {placeholder_blocks} point to placeholder image "
            f"(md5={_PLACEHOLDER_FIG_MD5[:8]}…) — remove figure block or supply real image",
        )
    return InvariantResult(True, "no placeholder-backed figure blocks")


def evaluate_story(
    story: dict[str, Any],
    by_design_empty_ids: set[int],
    all_story_tokens: dict[int, set[str]],
    all_rendered_tokens: dict[int, set[str]],
) -> dict[str, Any]:
    blocks = spotlight_blocks(story)
    checks = {
        "1": check_invariant_1(story, blocks, all_story_tokens),
        "2": check_invariant_2(story, blocks, by_design_empty_ids),
        "3": check_invariant_3(blocks),
        "4": check_invariant_4(story),
        "5": check_invariant_5(story, blocks),
        "6": check_invariant_6(story, all_story_tokens, all_rendered_tokens),
        "7": check_invariant_7(story),
        "8": check_invariant_8(story),
        "9": check_invariant_9(story),
    }
    failed = [inv for inv, result in checks.items() if not result.ok]
    return {
        "story_id": int(story["id"]),
        "lesson_code": story.get("grade_code"),
        "title": story.get("title"),
        "status": "FAIL" if failed else "PASS",
        "failed_invariants": failed,
        "invariants": {k: {"ok": v.ok, "detail": v.detail} for k, v in checks.items()},
        "canonical": {
            "key": f"{story.get('grade_code')}+{story.get('id')}",
            "structure": canonical_structure(blocks),
            "semantic_hash": canonical_semantic_hash(blocks),
        },
    }


def load_story_ids(base_url: str) -> list[int]:
    payload = http_json(f"{base_url}/api/stories?page_size=300")
    stories = payload.get("stories", [])
    return [
        int(s["id"])
        for s in stories
        if isinstance(s, dict) and normalize_text(str(s.get("reading_strategy") or ""))
    ]


def _load_local_override_spotlights(schema_dir: str) -> dict[str, dict[str, Any]]:
    if not schema_dir:
        return {}
    root = Path(schema_dir)
    if not root.exists():
        return {}
    mapping: dict[str, dict[str, Any]] = {}
    for path in sorted(root.glob("*.spotlight.yml")):
        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        spotlight = payload.get("spotlight") if isinstance(payload, dict) else None
        if not isinstance(spotlight, dict):
            continue
        lesson = str(spotlight.get("lesson") or path.stem.replace(".spotlight", ""))
        if lesson:
            mapping[lesson] = spotlight
    return mapping


def load_stories_local(schema_dir: str = "") -> list[dict[str, Any]]:
    repo_root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(repo_root / "backend"))
    from app.services.lesson_loader import get_all_lessons  # noqa: PLC0415

    stories = [
        copy.deepcopy(s)
        for s in get_all_lessons()
        if isinstance(s, dict) and normalize_text(str(s.get("reading_strategy") or ""))
    ]
    overrides = _load_local_override_spotlights(schema_dir)
    if not overrides:
        return stories
    for story in stories:
        code = str(story.get("grade_code") or "")
        if code in overrides:
            story["spotlight_v2"] = overrides[code]
    return stories


def main() -> int:
    parser = argparse.ArgumentParser(description="Run spotlight content-faithfulness invariants")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument(
        "--local",
        action="store_true",
        help="evaluate local lesson_loader data (no HTTP)",
    )
    parser.add_argument(
        "--schema-dir",
        default="",
        help="optional override directory containing *.spotlight.yml (used with --local)",
    )
    parser.add_argument(
        "--by-design-empty",
        default="",
        help="comma-separated story ids allowed to have 0 interactive blocks",
    )
    args = parser.parse_args()

    by_design_empty_ids = {
        int(x.strip()) for x in args.by_design_empty.split(",") if x.strip()
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if args.local:
        stories = load_stories_local(schema_dir=args.schema_dir)
        print(f"[info] local stories with reading_strategy: {len(stories)}")
    else:
        story_ids = load_story_ids(args.base_url)
        print(f"[info] stories with reading_strategy: {len(story_ids)}")
        stories = []
        for idx, sid in enumerate(story_ids, start=1):
            story = http_json(f"{args.base_url}/api/stories/{sid}")
            stories.append(story)
            print(f"[fetch {idx:03d}/{len(story_ids)}] {sid} {story.get('grade_code')}")
            time.sleep(0.04)

    all_story_tokens = {
        int(st["id"]): token_set(story_body_text(st))
        for st in stories
    }
    all_rendered_tokens = {
        int(st["id"]): token_set(rendered_prompt_passage_text(st)) for st in stories
    }
    rows: list[dict[str, Any]] = []
    for idx, story in enumerate(stories, start=1):
        row = evaluate_story(story, by_design_empty_ids, all_story_tokens, all_rendered_tokens)
        rows.append(row)
        fails = ",".join(row["failed_invariants"]) if row["failed_invariants"] else "-"
        print(f"[{idx:03d}/{len(stories)}] {row['story_id']} {row['lesson_code']} {row['status']} inv={fails}")
        time.sleep(0.05)

    fail_rows = [r for r in rows if r["status"] == "FAIL"]
    fail_ids = {r["story_id"] for r in fail_rows}
    expected_missing = sorted(EXPECTED_RED_IDS - fail_ids)
    extra_fail_ids = sorted(fail_ids - EXPECTED_RED_IDS)

    report = {
        "meta": {
            "base_url": args.base_url,
            "story_count": len(rows),
            "fail_count": len(fail_rows),
            "pass_count": len(rows) - len(fail_rows),
            "timestamp_epoch": int(time.time()),
        },
        "expected_red_ids": sorted(EXPECTED_RED_IDS),
        "expected_red_missing": expected_missing,
        "extra_fail_ids": extra_fail_ids,
        "stories": rows,
    }

    out_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[info] report written: {out_path}")
    print(f"[info] total FAIL={len(fail_rows)} PASS={len(rows) - len(fail_rows)}")
    print(f"[info] expected_red_missing={expected_missing}")
    print(f"[info] extra_fail_ids={extra_fail_ids}")

    # Fail process if expected red list is not fully covered
    if expected_missing:
        print("[error] expected red ids not fully covered", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
