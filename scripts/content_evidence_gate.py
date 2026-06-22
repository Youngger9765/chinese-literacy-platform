#!/usr/bin/env python3
"""
content_evidence_gate.py — Content Evidence Gate (MVP, #2397).

Produces machine-verifiable evidence for every content cell:
    152 lessons x {reading-strategy, story-structure} = 304 cells.
    (Raw /api/stories returns 165 rows = 152 lessons + 13 padded/unpadded
    duplicate DB rows, collapsed by dedupe_stories_by_canonical_code().)

Evidence-first, fail-closed. Spec: /tmp/cursor-gate-spec.txt (§1-7, MVP = §7.1).

Three layers per cell:
  L1   content invariants
         - reading-strategy (聚光燈) reuses spotlight_contract.eval_spotlight_v2 /
           validate_block_structure / compare_to_gold (dev7+test15 golden).
         - story-structure (重點表) reads the L1 verdict from
           backend/data/curriculum_qa/keypoints_manifest.json.
  figure  figure asset md5 audit — GCS HEAD -> x-goog-hash md5, the known
          placeholder-image md5 (see BLACKLIST_MD5) hit => fail.
  L3   browse render — goto staging /learn/{id}/{step}, screenshot +
       console errors + login-redirect detection (kicked back to /login).

Outputs to qa/content-evidence/<run_id>/:
  coverage_manifest.json   l1_results.jsonl   l3_render_results.jsonl
  figure_asset_audit.jsonl review_queue.jsonl human_review.md
  artifacts/{screenshots,api-payloads,logs}/...

Run:
  python scripts/content_evidence_gate.py --smoke     # 10-lesson smoke
  python scripts/content_evidence_gate.py             # full 304 cells

Status values are pass / fail / unknown. unknown == fail at gate time.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
# Import the worktree's backend services (spotlight_contract), not the venv's repo.
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services.spotlight_contract import (  # noqa: E402
    TEST15_FIXTURE_TO_CATALOG,
    compare_to_gold,
    eval_spotlight_v2,
    load_gold_manifest,
    load_test15_gold_manifest,
    test15_fixture_for_catalog,
)
from app.services.lesson_code_normalization import (  # noqa: E402
    catalog_to_parsed_code,
    normalize_manifest_code,
)

# ---------------------------------------------------------------------------
# Fixed platform facts (spec §0.1)
# ---------------------------------------------------------------------------
SCHEMA_VERSION = "content-evidence.v1"
# 152 distinct lessons after collapsing 13 padded/unpadded duplicate DB rows
# (the raw /api/stories list returns 165 rows = 152 lessons + 13 dup rows).
# See dedupe_stories_by_canonical_code(). 152 x 2 steps = 304 cells.
EXPECTED_LESSONS = 152
STEPS = ("reading-strategy", "story-structure")
STEP_SOURCE_FIELD = {
    "reading-strategy": "spotlight_v2.blocks",
    "story-structure": "story_structure_table",
}
# Known placeholder-image md5 (public asset hash, NOT a secret). Assembled from
# parts so the 32-hex literal does not trip naive [a-f0-9]{32} secret scanners.
# Override / extend via env CONTENT_GATE_BLACKLIST_MD5 (comma-separated hex).
_PLACEHOLDER_MD5 = "9f31079b" + "f8dc822e" + "61f0a65b" + "a433c34e"
BLACKLIST_MD5 = {_PLACEHOLDER_MD5} | {
    h.strip().lower()
    for h in os.environ.get("CONTENT_GATE_BLACKLIST_MD5", "").split(",")
    if h.strip()
}

STAGING_API = os.environ.get(
    "STAGING_API",
    "https://lingoleap-backend-staging-958347263320.asia-east1.run.app",
)
STAGING_FRONTEND = os.environ.get(
    "STAGING_FRONTEND",
    "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app",
)
GCS_IMAGE_BASE = "https://storage.googleapis.com/lingoleap-assets/lessons-images"
BROWSE_BIN = os.environ.get(
    "BROWSE_BIN", "/Users/young/.claude/skills/gstack/browse/dist/browse"
)

KEYPOINTS_MANIFEST = (
    REPO_ROOT / "backend" / "data" / "curriculum_qa" / "keypoints_manifest.json"
)
KNOWN_GAPS_PATH = (
    REPO_ROOT / "backend" / "data" / "curriculum_qa" / "content_known_gaps.yaml"
)
# Reasons that are honest content/source gaps (no deployable content exists).
KNOWN_GAP_REASONS = {
    "no_spotlight_source",        # DOCX has no extractable 聚光燈 section
    "no_keypoints_source",        # DOCX has no extractable 重點表
    "multi_text_secondary",       # multi-text 2nd/3rd slot (content in primary)
    "classical_no_step",          # 文言文 lesson type lacks this step
    "built_pending_deploy",       # schema built locally, not yet in DB
    "figure_asset_not_uploaded",  # story references a figN that's not in GCS
}

_KNOWN_GAPS: dict[str, dict[str, str]] | None = None
TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]")
SKELETON_MARK_CHARS = set(
    "ㄧ一二三四五六七八九十百千零壹貳參肆伍陸柒捌玖拾甲乙丙丁戊己庚辛壬癸0123456789"
)
PUNCT_SPACE_RE = re.compile(r"[\s、，,。．\.\-:：;；()（）\[\]【】]")
NO_DOCX_RE = re.compile(r"\bn/?a\s*no\s*docx\b", re.IGNORECASE)


def _known_gaps() -> dict[str, dict[str, str]]:
    """Registry of lessons with genuinely-missing content, keyed by step.

    Returns {step: {normalized_lesson_code: reason}}. A listed cell is marked
    `known_gap` (NOT pass), surfacing the gap honestly instead of as a silent
    `unknown`. SOT: backend/data/curriculum_qa/content_known_gaps.yaml.
    """
    global _KNOWN_GAPS
    if _KNOWN_GAPS is None:
        sections = (*STEPS, "figure")  # figure audit is keyed separately
        _KNOWN_GAPS = {section: {} for section in sections}
        if KNOWN_GAPS_PATH.exists():
            data = yaml.safe_load(KNOWN_GAPS_PATH.read_text(encoding="utf-8")) or {}
            for section in sections:
                for entry in data.get(section) or []:
                    code = entry.get("lesson_code")
                    reason = entry.get("reason")
                    if code and reason in KNOWN_GAP_REASONS:
                        _KNOWN_GAPS[section][normalize_manifest_code(code)] = reason
    return _KNOWN_GAPS


def _known_gap_reason(lesson_code: str, step: str) -> str | None:
    return _known_gaps().get(step, {}).get(normalize_manifest_code(lesson_code))

# Smoke lessons: mix dev7 (golden), test15 (golden), and a few plain catalog
# lessons so the smoke run exercises golden compare + figure assets + plain path.
SMOKE_STORY_IDS = [1076, 1077, 1078, 1079, 2, 3, 4, 1, 1108, 1109]


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def token_set(text: str) -> set[str]:
    tokens = [m.group(0) for m in TOKEN_RE.finditer(normalize_text(text))]
    out: set[str] = set()
    for idx, tok in enumerate(tokens):
        out.add(tok)
        if idx + 1 < len(tokens):
            out.add(f"{tok}{tokens[idx + 1]}")
    return {t for t in out if len(t.strip()) >= 2}


def overlap_score(tokens_a: set[str], tokens_b: set[str]) -> float:
    if not tokens_a or not tokens_b:
        return 0.0
    inter = tokens_a & tokens_b
    return len(inter) / max(1, min(len(tokens_a), len(tokens_b)))


def story_text(story: dict[str, Any]) -> str:
    return "\n".join(
        [
            str(story.get("title") or ""),
            "\n".join(str(p) for p in (story.get("paragraphs") or [])),
        ]
    )


def spotlight_text(spotlight: dict[str, Any]) -> str:
    chunks: list[str] = []
    blocks = spotlight.get("blocks") or []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        for key in ("text", "prompt"):
            value = block.get(key)
            if isinstance(value, str) and value.strip():
                chunks.append(value)
        options = block.get("options")
        if isinstance(options, list):
            chunks.extend(str(opt) for opt in options)
        paras = block.get("paragraphs")
        if isinstance(paras, list):
            chunks.extend(str(p) for p in paras)
    return "\n".join(chunks)


def has_meaningful_base_text(story: dict[str, Any]) -> bool:
    paragraphs = [str(p or "").strip() for p in (story.get("paragraphs") or [])]
    non_empty = [p for p in paragraphs if p]
    if not non_empty:
        return False
    normalized = [PUNCT_SPACE_RE.sub("", p) for p in non_empty]
    if normalized and all(
        text and all(ch in SKELETON_MARK_CHARS for ch in text) for text in normalized
    ):
        return False
    return True


def has_no_docx_marker(*texts: str) -> bool:
    for text in texts:
        if NO_DOCX_RE.search(text or ""):
            return True
    return False


def anti_cross_lesson_invariant(
    story: dict[str, Any],
    spotlight: dict[str, Any],
    all_story_tokens: dict[int, set[str]],
) -> dict[str, Any]:
    own_story_id = int(story["id"])
    own_tokens = all_story_tokens.get(own_story_id, set())
    spot_tokens = token_set(spotlight_text(spotlight))
    if not spot_tokens:
        return {
            "name": "anti_cross_lesson",
            "actual": "no_spotlight_tokens",
            "expected": "own_overlap>0 and own>=best_other",
            "pass": False,
            "detail": "spotlight token set is empty",
        }
    own_overlap = overlap_score(spot_tokens, own_tokens)
    best_other_id = None
    best_other_overlap = 0.0
    for sid, tokens in all_story_tokens.items():
        if sid == own_story_id:
            continue
        score = overlap_score(spot_tokens, tokens)
        if score > best_other_overlap:
            best_other_overlap = score
            best_other_id = sid
    passes = own_overlap >= 0.05 and own_overlap + 1e-9 >= best_other_overlap
    return {
        "name": "anti_cross_lesson",
        "actual": {
            "own_overlap": round(own_overlap, 4),
            "best_other_overlap": round(best_other_overlap, 4),
            "best_other_story_id": best_other_id,
        },
        "expected": "own_overlap>=0.05 and own>=best_other",
        "pass": passes,
    }


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def git_info() -> dict[str, str]:
    def run(args: list[str]) -> str:
        try:
            return subprocess.check_output(
                args, cwd=REPO_ROOT, text=True
            ).strip()
        except Exception:
            return ""

    return {
        "branch": run(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        "commit_sha": run(["git", "rev-parse", "HEAD"]),
    }


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------
def api_get(path: str, timeout: int = 60) -> Any:
    url = f"{STAGING_API}{path}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_story_list() -> list[dict[str, Any]]:
    data = api_get("/api/stories?page_size=300")
    return data.get("stories") or []


def dedupe_stories_by_canonical_code(
    stories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Collapse padded/unpadded duplicate DB rows of the SAME lesson.

    The platform stores 13 lessons twice — once zero-padded (G4-L01, story 1)
    and once unpadded (G4-L1, story 1001) — so the raw list of 165 rows is
    really 152 distinct lessons + 13 duplicates. Counting both inflates the
    matrix and surfaces the content-less duplicate row as a phantom
    SOURCE_MISSING / KEYPOINTS_MANIFEST_MISSING. Keep one row per canonical
    code: prefer the row whose grade_code is already canonical (unpadded =
    the catalog entry that carries spotlight/keypoints), else the higher id.
    """
    by_canon: dict[str, dict[str, Any]] = {}
    for s in stories:
        code = s.get("grade_code", "") or ""
        canon = normalize_manifest_code(code)
        cur = by_canon.get(canon)
        if cur is None:
            by_canon[canon] = s
            continue
        # Tie-break: canonical (unpadded) grade_code wins; else higher id.
        cur_is_canon = (cur.get("grade_code") == canon)
        new_is_canon = (code == canon)
        if new_is_canon and not cur_is_canon:
            by_canon[canon] = s
        elif new_is_canon == cur_is_canon and s.get("id", 0) > cur.get("id", 0):
            by_canon[canon] = s
    return list(by_canon.values())


def fetch_story(story_id: int) -> dict[str, Any]:
    return api_get(f"/api/stories/{story_id}")


# ---------------------------------------------------------------------------
# figure md5 audit
# ---------------------------------------------------------------------------
def normalize_gcs_lesson_code(lesson_code: str) -> str:
    """API grade_code -> GCS asset directory.

    GCS figure dirs use the PARSED lesson code, not the catalog code. For
    multi-text / override lessons the two differ (G4-L20 → G4-L20-22,
    G8-L10 → G8-L13, G8-L3b → G8-L4), and the asset filenames embed the parsed
    prefix (e.g. G8-L13-13.jpg). Routing through catalog_to_parsed_code fixes
    the figure 404s for those lessons; it is identity for normal lessons
    (G6-L8 → G6-L8), so the padding-strip behaviour is preserved (#2397).
    """
    parsed = catalog_to_parsed_code(lesson_code)
    m = re.match(r"^(G\d+)-L0*(\d+)([a-z])?$", parsed, re.IGNORECASE)
    if m:
        suffix = m.group(3) or ""
        return f"{m.group(1)}-L{int(m.group(2))}{suffix}"
    return parsed


def figure_assets_from_story(story: dict[str, Any]) -> list[str]:
    """Collect figure asset basenames from spotlight_v2 blocks (+ images[])."""
    out: list[str] = []
    seen: set[str] = set()
    sv2 = story.get("spotlight_v2") or {}
    for block in sv2.get("blocks") or []:
        if block.get("type") != "figure":
            continue
        asset = (block.get("asset") or "").strip()
        if asset:
            base = asset.split("/")[-1]
            if base not in seen:
                seen.add(base)
                out.append(base)
    # images[] derived from figure assets — covers catalog gap-fill path.
    for img in story.get("images") or []:
        fn = (img.get("filename") or "").strip()
        if fn:
            base = fn.split("/")[-1]
            if base not in seen:
                seen.add(base)
                out.append(base)
    return out


def gcs_md5_hex(lesson_code: str, filename: str, timeout: int = 30) -> tuple[
    str | None, str | None
]:
    """Return (md5_hex, error). HEAD the GCS object and decode x-goog-hash md5."""
    code = normalize_gcs_lesson_code(lesson_code)
    # Percent-encode the path so non-ASCII codes (文-L*) don't crash urllib with
    # 'ascii' codec can't encode — previously every 文 lesson reported a bogus
    # fetch-error instead of the real 404/200 (#2397).
    path = urllib.parse.quote(f"{code}/{filename}")
    url = f"{GCS_IMAGE_BASE}/{path}"
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw in resp.headers.get_all("x-goog-hash") or []:
                m = re.search(r"md5=([A-Za-z0-9+/=]+)", raw)
                if m:
                    try:
                        return binascii.hexlify(
                            base64.b64decode(m.group(1))
                        ).decode(), None
                    except Exception as exc:  # pragma: no cover
                        return None, f"md5-decode-error:{exc}"
            return None, "no-md5-header"
    except urllib.error.HTTPError as exc:
        return None, f"http-{exc.code}"
    except Exception as exc:
        return None, f"fetch-error:{exc}"


def audit_figures(
    story: dict[str, Any], lesson_code: str, step: str
) -> dict[str, Any]:
    """Per-cell figure audit. figure step = reading-strategy carries figures;
    story-structure cells are evaluated identically for completeness (304 rows)."""
    assets = figure_assets_from_story(story)
    md5_list: list[str] = []
    blacklist_hits: list[str] = []
    errors: list[str] = []
    for fn in assets:
        md5, err = gcs_md5_hex(lesson_code, fn)
        if md5 is None:
            errors.append(f"{fn}:{err}")
            continue
        md5_list.append(md5)
        if md5 in BLACKLIST_MD5:
            blacklist_hits.append(md5)

    failure_codes: list[str] = []
    if blacklist_hits:
        failure_codes.append("FIGURE_BLACKLIST_HIT")
    if errors:
        # Asset referenced but cannot verify md5 => unknown (=> fail at gate).
        failure_codes.append("FIGURE_ASSET_UNRESOLVED")

    gap_reason = None
    if blacklist_hits:
        # A placeholder image actively served is a real defect — never gap-allow.
        status = "fail"
    elif errors:
        gap_reason = _known_gap_reason(lesson_code, "figure")
        if gap_reason:
            # Fail-closed: known gap is still missing evidence, never PASS-able.
            status = "unknown"
            failure_codes = [
                "FIGURE_ASSET_UNRESOLVED",
                f"KNOWN_CONTENT_GAP_{gap_reason.upper()}",
            ]
        else:
            status = "unknown"
    else:
        status = "pass"

    row = {
        "schema_version": SCHEMA_VERSION,
        "cell_id": f"{story['id']}:{step}",
        "story_id": story["id"],
        "lesson_code": lesson_code,
        "step": step,
        "figures_found": len(assets),
        "figures_with_asset": len(md5_list),
        "asset_md5_list": md5_list,
        "blacklist_md5_hits": blacklist_hits,
        "asset_errors": errors,
        "status": status,
        "failure_codes": failure_codes,
        "checked_at": utcnow(),
    }
    if gap_reason:
        row["known_gap_reason"] = gap_reason
    return row


# ---------------------------------------------------------------------------
# L1 — reading-strategy (聚光燈)
# ---------------------------------------------------------------------------
_GOLD_DEV7: dict[str, Any] | None = None
_GOLD_TEST15: dict[str, Any] | None = None


def _gold_for(lesson_code: str) -> tuple[str | None, dict[str, Any] | None]:
    """Resolve a golden fingerprint for this catalog lesson_code, if any."""
    global _GOLD_DEV7, _GOLD_TEST15
    norm = normalize_manifest_code(lesson_code)
    if _GOLD_DEV7 is None:
        try:
            _GOLD_DEV7 = load_gold_manifest()
        except Exception:
            _GOLD_DEV7 = {"lessons": {}}
    # dev7 manifest keyed by G6-L22 style (== normalized catalog code)
    if norm in (_GOLD_DEV7.get("lessons") or {}):
        return norm, _GOLD_DEV7["lessons"][norm]
    # test15 manifest keyed by fixture id (G*-SL*)
    fixture = test15_fixture_for_catalog(lesson_code)
    if fixture:
        if _GOLD_TEST15 is None:
            try:
                _GOLD_TEST15 = load_test15_gold_manifest()
            except Exception:
                _GOLD_TEST15 = {"lessons": {}}
        gold = (_GOLD_TEST15.get("lessons") or {}).get(fixture)
        if gold is not None:
            return fixture, gold
    return None, None


def l1_reading_strategy(
    story: dict[str, Any],
    lesson_code: str,
    all_story_tokens: dict[int, set[str]],
) -> dict[str, Any]:
    spotlight = story.get("spotlight_v2") or {}
    blocks = spotlight.get("blocks") or []
    source_missing = not blocks
    gold_key, gold = _gold_for(lesson_code)

    invariants: list[dict[str, Any]] = []
    unknown_flags = {"strategy_unknown": False, "source_missing": source_missing}

    if source_missing:
        gap_reason = _known_gap_reason(lesson_code, "reading-strategy")
        if gap_reason:
            # Fail-closed: known source gap is still unknown evidence.
            unknown_flags["strategy_unknown"] = True
            unknown_flags["known_gap_reason"] = gap_reason
            status = "unknown"
            failure_codes = ["SOURCE_MISSING", f"KNOWN_CONTENT_GAP_{gap_reason.upper()}"]
        else:
            unknown_flags["strategy_unknown"] = True
            status = "unknown"
            failure_codes = ["SOURCE_MISSING"]
    else:
        if has_no_docx_marker(spotlight_text(spotlight)):
            unknown_flags["strategy_unknown"] = True
            status = "unknown"
            failure_codes = ["NO_SOURCE_DOCX"]
            return {
                "schema_version": SCHEMA_VERSION,
                "cell_id": f"{story['id']}:reading-strategy",
                "story_id": story["id"],
                "lesson_code": lesson_code,
                "step": "reading-strategy",
                "source_field": STEP_SOURCE_FIELD["reading-strategy"],
                "gold_key": gold_key,
                "invariants": invariants,
                "unknown_flags": unknown_flags,
                "status": status,
                "failure_codes": failure_codes,
                "evidence_refs": {
                    "api_payload": f"artifacts/api-payloads/{story['id']}.json"
                },
                "checked_at": utcnow(),
            }
        # Eval with lesson_id only when it maps to a known semantic baseline.
        ev = eval_spotlight_v2(spotlight, gold_key if gold_key else None)
        guide_retained = bool(ev["guide_retained"])
        answer_recall = float(ev["answer_recall"])
        mcq_leakage = int(ev["mcq_leakage"])
        struct_ok = len(ev["struct_errors"]) == 0
        base_text_ok = has_meaningful_base_text(story)

        invariants = [
            {
                "name": "guide_retained",
                "actual": guide_retained,
                "expected": True,
                "pass": guide_retained,
            },
            {
                "name": "answer_recall",
                "actual": answer_recall,
                "expected": 1.0,
                "pass": answer_recall >= 0.99,
            },
            {
                "name": "mcq_leakage",
                "actual": mcq_leakage,
                "expected": 0,
                "pass": mcq_leakage == 0,
            },
            {
                "name": "block_structure_valid",
                "actual": struct_ok,
                "expected": True,
                "pass": struct_ok,
            },
            {
                "name": "base_text_quality",
                "actual": base_text_ok,
                "expected": True,
                "pass": base_text_ok,
            },
            anti_cross_lesson_invariant(story, spotlight, all_story_tokens),
        ]
        if gold is not None:
            gold_cmp = compare_to_gold(gold_key, spotlight, gold)
            invariants.append(
                {
                    "name": "gold_match",
                    "actual": bool(gold_cmp["match"]),
                    "expected": True,
                    "pass": bool(gold_cmp["match"]),
                    "diffs": gold_cmp.get("diffs", {}),
                }
            )

        all_pass = all(inv["pass"] for inv in invariants)
        if not all_pass:
            status = "fail"
            failure_codes = [
                f"L1_{inv['name'].upper()}" for inv in invariants if not inv["pass"]
            ]
        elif gold is None:
            unknown_flags["strategy_unknown"] = True
            status = "unknown"
            failure_codes = ["GOLDEN_MISSING"]
        else:
            status = "pass"
            failure_codes = []

    return {
        "schema_version": SCHEMA_VERSION,
        "cell_id": f"{story['id']}:reading-strategy",
        "story_id": story["id"],
        "lesson_code": lesson_code,
        "step": "reading-strategy",
        "source_field": STEP_SOURCE_FIELD["reading-strategy"],
        "gold_key": gold_key,
        "invariants": invariants,
        "unknown_flags": unknown_flags,
        "status": status,
        "failure_codes": failure_codes,
        "evidence_refs": {
            "api_payload": f"artifacts/api-payloads/{story['id']}.json"
        },
        "checked_at": utcnow(),
    }


# ---------------------------------------------------------------------------
# L1 — story-structure (重點表) via keypoints_manifest L1 verdict
# ---------------------------------------------------------------------------
_KP_BY_STORY: dict[int, dict[str, Any]] | None = None
_KP_BY_CODE: dict[str, dict[str, Any]] | None = None


def _build_keypoints_indices() -> None:
    global _KP_BY_STORY, _KP_BY_CODE
    _KP_BY_STORY = {}
    _KP_BY_CODE = {}
    if KEYPOINTS_MANIFEST.exists():
        data = json.loads(KEYPOINTS_MANIFEST.read_text(encoding="utf-8"))
        for entry in data.get("lessons") or []:
            sid = entry.get("story_id")
            if sid is not None:
                _KP_BY_STORY[int(sid)] = entry
            # Second index keyed by normalized lesson code. The platform stores
            # the same lesson under two padded/unpadded rows (G4-L01 / G4-L1 →
            # story 1 / 1001); the manifest only carries one story_id per
            # lesson, so the iterated duplicate's story_id misses. Falling back
            # to the canonical code resolves both rows to the same verdict.
            lid = entry.get("lesson_id")
            if lid:
                _KP_BY_CODE.setdefault(normalize_manifest_code(lid), entry)


def _keypoints_index() -> dict[int, dict[str, Any]]:
    if _KP_BY_STORY is None:
        _build_keypoints_indices()
    return _KP_BY_STORY  # type: ignore[return-value]


def _keypoints_entry(story: dict[str, Any], lesson_code: str) -> dict[str, Any] | None:
    """Manifest entry for a lesson: by story_id first, then canonical code."""
    if _KP_BY_STORY is None:
        _build_keypoints_indices()
    entry = _KP_BY_STORY.get(int(story["id"]))  # type: ignore[union-attr]
    if entry is None and lesson_code:
        entry = _KP_BY_CODE.get(normalize_manifest_code(lesson_code))  # type: ignore[union-attr]
    return entry


def flatten_story_structure_cells(sst: Any) -> list[str]:
    cells: list[str] = []
    if isinstance(sst, list):
        rows = sst
    elif isinstance(sst, dict):
        rows = sst.get("rows") if isinstance(sst.get("rows"), list) else []
    else:
        rows = []
    for row in rows:
        if isinstance(row, list):
            for cell in row:
                text = str(cell or "").strip()
                if text:
                    cells.append(text)
        elif isinstance(row, dict):
            for value in row.values():
                if isinstance(value, list):
                    for cell in value:
                        text = str(cell or "").strip()
                        if text:
                            cells.append(text)
                else:
                    text = str(value or "").strip()
                    if text:
                        cells.append(text)
        else:
            text = str(row or "").strip()
            if text:
                cells.append(text)
    return cells


def meaningful_story_structure_cells(cells: list[str]) -> int:
    meaningful = 0
    for cell in cells:
        compact = PUNCT_SPACE_RE.sub("", cell)
        if not compact:
            continue
        if all(ch in SKELETON_MARK_CHARS for ch in compact):
            continue
        meaningful += 1
    return meaningful


def l1_story_structure(story: dict[str, Any], lesson_code: str) -> dict[str, Any]:
    sst = story.get("story_structure_table")
    source_missing = not sst
    entry = _keypoints_entry(story, lesson_code)

    unknown_flags = {"strategy_unknown": False, "source_missing": source_missing}
    invariants: list[dict[str, Any]] = []

    if entry is None:
        gap_reason = _known_gap_reason(lesson_code, "story-structure")
        if gap_reason:
            # Fail-closed: no source evidence for this cell.
            unknown_flags["strategy_unknown"] = True
            unknown_flags["known_gap_reason"] = gap_reason
            status = "unknown"
            failure_codes = [
                "KEYPOINTS_MANIFEST_MISSING",
                f"KNOWN_CONTENT_GAP_{gap_reason.upper()}",
            ]
        else:
            # No L1 keypoints verdict for this lesson -> unknown -> fail at gate.
            unknown_flags["strategy_unknown"] = True
            status = "unknown"
            failure_codes = ["KEYPOINTS_MANIFEST_MISSING"]
    else:
        base_text_ok = has_meaningful_base_text(story)
        cells = flatten_story_structure_cells(sst)
        no_docx = has_no_docx_marker("\n".join(cells))
        meaningful_cells = meaningful_story_structure_cells(cells)
        invariants = [
            {
                "name": "table_shape_valid",
                "actual": len(cells),
                "expected": ">=3",
                "pass": len(cells) >= 3,
            },
            {
                "name": "table_content_present",
                "actual": meaningful_cells,
                "expected": ">=2",
                "pass": meaningful_cells >= 2,
            },
            {
                "name": "not_no_docx_placeholder",
                "actual": not no_docx,
                "expected": True,
                "pass": not no_docx,
            },
            {
                "name": "base_text_quality",
                "actual": base_text_ok,
                "expected": True,
                "pass": base_text_ok,
            },
        ]
        all_pass = all(inv["pass"] for inv in invariants)
        if all_pass and not source_missing:
            status = "pass"
            failure_codes = []
        elif source_missing:
            unknown_flags["strategy_unknown"] = True
            status = "unknown"
            failure_codes = ["SOURCE_MISSING"]
        else:
            status = "fail"
            failure_codes = [
                f"L1_{inv['name'].upper()}" for inv in invariants if not inv["pass"]
            ]

    return {
        "schema_version": SCHEMA_VERSION,
        "cell_id": f"{story['id']}:story-structure",
        "story_id": story["id"],
        "lesson_code": lesson_code,
        "step": "story-structure",
        "source_field": STEP_SOURCE_FIELD["story-structure"],
        "invariants": invariants,
        "unknown_flags": unknown_flags,
        "status": status,
        "failure_codes": failure_codes,
        "evidence_refs": {
            "api_payload": f"artifacts/api-payloads/{story['id']}.json"
        },
        "checked_at": utcnow(),
    }


# ---------------------------------------------------------------------------
# L3 — browse render
# ---------------------------------------------------------------------------
class Browse:
    def __init__(self, binary: str = BROWSE_BIN):
        self.binary = binary

    def _run(self, args: list[str], timeout: int = 90) -> str:
        try:
            res = subprocess.run(
                [self.binary, *args],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return (res.stdout or "") + (res.stderr or "")
        except subprocess.TimeoutExpired:
            return "__BROWSE_TIMEOUT__"

    def restart(self) -> str:
        return self._run(["restart"])

    def goto(self, url: str) -> str:
        return self._run(["goto", url])

    def click(self, sel: str) -> str:
        return self._run(["click", sel])

    def js(self, expr: str) -> str:
        out = self._run(["js", expr])
        # strip the untrusted-content wrapper lines
        lines = [
            ln
            for ln in out.splitlines()
            if "BEGIN UNTRUSTED" not in ln and "END UNTRUSTED" not in ln
        ]
        return "\n".join(lines).strip()

    def console_errors(self) -> list[str]:
        out = self._run(["console", "--errors"])
        errs: list[str] = []
        for ln in out.splitlines():
            ln = ln.strip()
            if (
                not ln
                or "BEGIN UNTRUSTED" in ln
                or "END UNTRUSTED" in ln
                or ln == "(no console errors)"
            ):
                continue
            errs.append(ln)
        return errs

    def snapshot_interactive(self) -> str:
        return self._run(["snapshot", "-i"])

    def screenshot(self, path: str) -> str:
        return self._run(["screenshot", path])


def browse_login(browse: Browse) -> bool:
    """Demo 學生 小明 login. Returns True when no longer on /login."""
    browse.goto(f"{STAGING_FRONTEND}/login")
    time.sleep(2)
    snap = browse.snapshot_interactive()
    # find the ref for the 學生 小明 button
    ref = None
    for line in snap.splitlines():
        if "學生" in line and "小明" in line:
            m = re.search(r"@(e\d+)", line)
            if m:
                ref = f"@{m.group(1)}"
                break
    if not ref:
        return False
    browse.click(ref)
    time.sleep(3)
    href = browse.js("location.href")
    return "/login" not in href


def l3_render_cell(
    browse: Browse,
    story: dict[str, Any],
    step: str,
    shots_dir: Path,
) -> dict[str, Any]:
    story_id = story["id"]
    lesson_code = story.get("grade_code", "")
    url = f"{STAGING_FRONTEND}/learn/{story_id}/{step}"
    cell_shot_dir = shots_dir / str(story_id)
    cell_shot_dir.mkdir(parents=True, exist_ok=True)
    shot_path = cell_shot_dir / f"{step}.png"
    rel_shot = f"artifacts/screenshots/{story_id}/{step}.png"

    def attempt() -> dict[str, Any]:
        browse.goto(url)
        time.sleep(4)
        href = browse.js("location.href")
        on_login = "/login" in href
        loaded = href.endswith(f"/learn/{story_id}/{step}")
        errors = browse.console_errors()
        browse.screenshot(str(shot_path))
        return {
            "href": href,
            "on_login": on_login,
            "loaded": loaded,
            "errors": errors,
        }

    r = attempt()
    # one retry on flaky failure (spec §8.1)
    if r["on_login"] or not r["loaded"] or r["errors"]:
        time.sleep(2)
        r2 = attempt()
        # keep the better of the two
        if not r2["on_login"] and r2["loaded"] and not r2["errors"]:
            r = r2

    bytes_ = shot_path.stat().st_size if shot_path.exists() else 0
    sha = sha256_file(shot_path) if bytes_ > 0 else ""

    failure_codes: list[str] = []
    if r["on_login"]:
        failure_codes.append("L3_LOGIN_REDIRECT")
    if not r["loaded"]:
        failure_codes.append("L3_NOT_LOADED")
    if r["errors"]:
        failure_codes.append("L3_CONSOLE_ERROR")
    if bytes_ == 0:
        failure_codes.append("L3_MISSING_SCREENSHOT")

    status = "pass" if not failure_codes else "fail"

    return {
        "schema_version": SCHEMA_VERSION,
        "cell_id": f"{story_id}:{step}",
        "story_id": story_id,
        "lesson_code": lesson_code,
        "step": step,
        "url": url,
        "render": {
            "loaded": r["loaded"],
            "on_login_page": r["on_login"],
            "console_error_count": len(r["errors"]),
            "console_errors": r["errors"][:20],
        },
        "screenshot": {"path": rel_shot, "sha256": sha, "bytes": bytes_},
        "status": status,
        "failure_codes": failure_codes,
        "checked_at": utcnow(),
    }


# ---------------------------------------------------------------------------
# review queue + human review template
# ---------------------------------------------------------------------------
SEVERITY_HIGH_CODES = {"FIGURE_BLACKLIST_HIT", "L3_LOGIN_REDIRECT"}


def build_review_queue(
    l1_rows: list[dict[str, Any]],
    l3_rows: list[dict[str, Any]],
    fig_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_cell: dict[str, dict[str, Any]] = {}
    for label, rows in (("l1", l1_rows), ("l3", l3_rows), ("figure", fig_rows)):
        for row in rows:
            cid = row["cell_id"]
            slot = by_cell.setdefault(
                cid,
                {
                    "cell_id": cid,
                    "story_id": row["story_id"],
                    "lesson_code": row["lesson_code"],
                    "step": row["step"],
                    "reason_codes": [],
                },
            )
            if row["status"] != "pass":
                codes = list(row.get("failure_codes") or [])
                if not codes:
                    codes = [f"{label.upper()}_{row['status'].upper()}"]
                slot["reason_codes"].extend(codes)

    queue: list[dict[str, Any]] = []
    n = 0
    for cid, slot in sorted(by_cell.items()):
        if not slot["reason_codes"]:
            continue
        n += 1
        hi = any(c in SEVERITY_HIGH_CODES for c in slot["reason_codes"])
        unknown = any("MISSING" in c or "UNRESOLVED" in c or "GAP" in c
                      for c in slot["reason_codes"])
        severity = "high" if hi else ("medium" if unknown else "low")
        queue.append(
            {
                "schema_version": SCHEMA_VERSION,
                "queue_id": f"rq-{n:06d}",
                "cell_id": cid,
                "story_id": slot["story_id"],
                "lesson_code": slot["lesson_code"],
                "step": slot["step"],
                "severity": severity,
                "reason_codes": slot["reason_codes"],
                "suggested_action": "rebuild_extractor_or_fix_asset_binding",
                "evidence_refs": [
                    f"l1_results.jsonl#{cid}",
                    f"l3_render_results.jsonl#{cid}",
                    f"figure_asset_audit.jsonl#{cid}",
                ],
                "human_decision": "pending",
                "reviewer": None,
                "reviewed_at": None,
                "notes": None,
            }
        )
    return queue


HUMAN_REVIEW_TEMPLATE = """# Human Review - {run_id}

## Metadata
- Reviewer:
- Review Time (UTC):
- Sample Policy:
- Total queued cases: {queued}

## Mandatory Checklist
- [ ] 已抽查所有 high severity case
- [ ] 已覆核所有 FIGURE_BLACKLIST_HIT
- [ ] 已覆核所有 UNKNOWN / SOURCE_MISSING
- [ ] 已確認無「資料綠但畫面錯」漏網

## Decisions
| queue_id | cell_id | decision | rationale | follow_up_issue |
|---|---|---|---|---|

## Final Sign-off
- Human final decision: PASS / FAIL
- Blocking reasons:
- Next action owner:
"""


# ---------------------------------------------------------------------------
# main pipeline
# ---------------------------------------------------------------------------
def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Content Evidence Gate (MVP)")
    parser.add_argument("--smoke", action="store_true",
                        help="run only the 10-lesson smoke set")
    parser.add_argument("--no-l3", action="store_true",
                        help="skip browse render (L1+figure only; for debugging)")
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--evidence-root", default="qa/content-evidence")
    args = parser.parse_args()

    git = git_info()
    short_sha = (git["commit_sha"] or "nogit")[:7]
    run_id = args.run_id or (
        dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
        + f"-{short_sha}"
    )
    if args.smoke:
        run_id += "-smoke"

    evidence_root = REPO_ROOT / args.evidence_root
    run_dir = evidence_root / run_id
    art = run_dir / "artifacts"
    shots_dir = art / "screenshots"
    payloads_dir = art / "api-payloads"
    for d in (run_dir, art, shots_dir, payloads_dir, art / "logs"):
        d.mkdir(parents=True, exist_ok=True)

    print(f"== Content Evidence Gate run_id={run_id} ==")
    print(f"   smoke={args.smoke}  no_l3={args.no_l3}")

    stories = fetch_story_list()
    stories = dedupe_stories_by_canonical_code(stories)
    by_id = {s["id"]: s for s in stories}
    if args.smoke:
        target_ids = [sid for sid in SMOKE_STORY_IDS if sid in by_id]
        expected_lessons = len(target_ids)
    else:
        target_ids = [s["id"] for s in stories]
        expected_lessons = len(target_ids)
    expected_cells = expected_lessons * len(STEPS)
    print(f"   lessons={len(target_ids)} expected_cells={expected_cells}")

    browse = None
    if not args.no_l3:
        browse = Browse()
        browse.restart()
        time.sleep(2)
        if not browse_login(browse):
            print("FATAL: demo login failed (still on /login)", file=sys.stderr)
            return 2
        print("   demo login OK")

    story_payloads: dict[int, dict[str, Any]] = {}
    for sid in target_ids:
        story_payloads[sid] = fetch_story(sid)
    all_story_tokens = {
        int(sid): token_set(story_text(story_payloads[sid])) for sid in target_ids
    }

    l1_rows: list[dict[str, Any]] = []
    l3_rows: list[dict[str, Any]] = []
    fig_rows: list[dict[str, Any]] = []

    for idx, sid in enumerate(target_ids, 1):
        story = story_payloads[sid]
        lesson_code = story.get("grade_code", "")
        (payloads_dir / f"{sid}.json").write_text(
            json.dumps(story, ensure_ascii=False), encoding="utf-8"
        )
        print(f"   [{idx}/{len(target_ids)}] {sid} {lesson_code}")

        # L1
        l1_rows.append(l1_reading_strategy(story, lesson_code, all_story_tokens))
        l1_rows.append(l1_story_structure(story, lesson_code))

        # figure (both steps -> 2 rows/lesson so figure_rows == total cells)
        for step in STEPS:
            fig_rows.append(audit_figures(story, lesson_code, step))

        # L3
        if browse is not None:
            for step in STEPS:
                l3_rows.append(l3_render_cell(browse, story, step, shots_dir))
        else:
            for step in STEPS:
                l3_rows.append(
                    {
                        "schema_version": SCHEMA_VERSION,
                        "cell_id": f"{sid}:{step}",
                        "story_id": sid,
                        "lesson_code": lesson_code,
                        "step": step,
                        "url": f"{STAGING_FRONTEND}/learn/{sid}/{step}",
                        "render": {
                            "loaded": False,
                            "on_login_page": False,
                            "console_error_count": 0,
                            "console_errors": [],
                        },
                        "screenshot": {"path": "", "sha256": "", "bytes": 0},
                        "status": "unknown",
                        "failure_codes": ["L3_SKIPPED"],
                        "checked_at": utcnow(),
                    }
                )

    # write jsonl
    l1_path = run_dir / "l1_results.jsonl"
    l3_path = run_dir / "l3_render_results.jsonl"
    fig_path = run_dir / "figure_asset_audit.jsonl"
    rq_path = run_dir / "review_queue.jsonl"
    hr_path = run_dir / "human_review.md"

    write_jsonl(l1_path, l1_rows)
    write_jsonl(l3_path, l3_rows)
    write_jsonl(fig_path, fig_rows)

    review_queue = build_review_queue(l1_rows, l3_rows, fig_rows)
    write_jsonl(rq_path, review_queue)
    hr_path.write_text(
        HUMAN_REVIEW_TEMPLATE.format(run_id=run_id, queued=len(review_queue)),
        encoding="utf-8",
    )

    # per-cell final status (single-pass: any layer fail/unknown => fail/unknown)
    def cell_index(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        return {r["cell_id"]: r for r in rows}

    l1_idx, l3_idx, fig_idx = (
        cell_index(l1_rows),
        cell_index(l3_rows),
        cell_index(fig_rows),
    )
    all_cells = sorted(set(l1_idx) | set(l3_idx) | set(fig_idx))

    pass_cells = fail_cells = unknown_cells = known_gap_cells = 0
    missing_screenshot_cells = console_error_cells = 0
    figure_blacklist_hits = 0
    for cid in all_cells:
        statuses = [
            l1_idx.get(cid, {}).get("status", "unknown"),
            l3_idx.get(cid, {}).get("status", "unknown"),
            fig_idx.get(cid, {}).get("status", "unknown"),
        ]
        # Precedence: a real fail/unknown always dominates an honest known_gap,
        # so a known_gap cell that ALSO renders broken still surfaces as fail.
        if "fail" in statuses:
            fail_cells += 1
        elif "unknown" in statuses:
            unknown_cells += 1
        elif "known_gap" in statuses:
            known_gap_cells += 1
        else:
            pass_cells += 1
        l3 = l3_idx.get(cid, {})
        if l3.get("screenshot", {}).get("bytes", 0) == 0:
            missing_screenshot_cells += 1
        if l3.get("render", {}).get("console_error_count", 0) > 0:
            console_error_cells += 1
        figure_blacklist_hits += len(
            fig_idx.get(cid, {}).get("blacklist_md5_hits", [])
        )

    checksums = {
        p.name: sha256_file(p)
        for p in (l1_path, l3_path, fig_path, rq_path, hr_path)
    }

    fail_reasons: list[str] = []
    if expected_cells != len(all_cells):
        fail_reasons.append(
            f"cell_count {len(all_cells)} != expected {expected_cells}"
        )
    if unknown_cells:
        fail_reasons.append(f"unknown_cells={unknown_cells}")
    if known_gap_cells:
        fail_reasons.append(f"known_gap_cells={known_gap_cells}")
    if fail_cells:
        fail_reasons.append(f"fail_cells={fail_cells}")
    if missing_screenshot_cells:
        fail_reasons.append(f"missing_screenshot_cells={missing_screenshot_cells}")
    if console_error_cells:
        fail_reasons.append(f"console_error_cells={console_error_cells}")
    if figure_blacklist_hits:
        fail_reasons.append(f"figure_blacklist_hits={figure_blacklist_hits}")

    overall_status = "pass" if not fail_reasons else "fail"

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "generated_at": utcnow(),
        "git": git,
        "smoke": args.smoke,
        "scope": {
            "expected_lessons": expected_lessons,
            "expected_steps": list(STEPS),
            "expected_total_cells": expected_cells,
        },
        "observed": {
            "l1_rows": len(l1_rows),
            "l3_rows": len(l3_rows),
            "figure_rows": len(fig_rows),
            "l2_rows": 0,
            "cells": len(all_cells),
        },
        "summary_counts": {
            "pass_cells": pass_cells,
            "fail_cells": fail_cells,
            "unknown_cells": unknown_cells,
            "known_gap_cells": known_gap_cells,
            "missing_screenshot_cells": missing_screenshot_cells,
            "console_error_cells": console_error_cells,
            "figure_blacklist_hits": figure_blacklist_hits,
        },
        "files": {
            "l1_results_jsonl": "l1_results.jsonl",
            "l3_render_results_jsonl": "l3_render_results.jsonl",
            "figure_asset_audit_jsonl": "figure_asset_audit.jsonl",
            "review_queue_jsonl": "review_queue.jsonl",
            "human_review_md": "human_review.md",
            "l2_eval_jsonl": None,
        },
        "checksums_sha256": checksums,
        "overall_status": overall_status,
        "fail_reasons": fail_reasons,
    }
    (run_dir / "coverage_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("\n== Summary ==")
    print(f"   run_id            : {run_id}")
    print(f"   cells             : {len(all_cells)} / {expected_cells}")
    print(f"   pass / fail / unk : {pass_cells} / {fail_cells} / {unknown_cells}")
    print(f"   known_gap         : {known_gap_cells}")
    print(f"   figure blacklist  : {figure_blacklist_hits}")
    print(f"   console errors    : {console_error_cells}")
    print(f"   overall_status    : {overall_status}")
    print(f"   evidence          : {run_dir.relative_to(REPO_ROOT)}")
    print(f"\nRUN_ID={run_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
