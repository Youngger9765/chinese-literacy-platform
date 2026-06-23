#!/usr/bin/env python3
"""build_spotlight_goldens.py — per-lesson spotlight (聚光燈) golden builder (#2397).

Replaces the broken token-overlap anti-cross heuristic (~85% misfire) with
LLM-judged, human-spot-checkable per-lesson goldens.

For every lesson that has a 聚光燈 (spotlight_v2.blocks) on the staging API:
  1. Fetch title + paragraphs (課文) + spotlight_v2.blocks (聚光燈內容).
  2. Ask Gemini (gemini-2.5-flash, us-central1 — same model as omo_grader) a
     content-faithfulness judge:
         verdict ∈ {faithful, cross_lesson, skeleton}
     The judge is LENIENT toward generic pedagogical scaffolding ("小試身手",
     "請打勾", "請依論點檢核") — those are legitimate strategy prompts, NOT
     張冠李戴. Only content that clearly teaches a DIFFERENT lesson's topic is
     cross_lesson; only pure numbering with no real prose is skeleton.
  3. Write ALL judge results (incl. cross_lesson / skeleton) to
     qa/content-evidence/spotlight-golden-judge.jsonl — for human spot-check
     calibration. EVERY lesson is written, not just faithful ones.
  4. For verdict == faithful, freeze a CANDIDATE golden to
     backend/data/curriculum_qa/golden/<lesson_code>/reading-strategy.golden.json
     with verified_by="llm-judge-pending-spotcheck" (honest — NOT human-verified).

This reuses content_evidence_gate's lesson enumeration + lesson_code↔story_id
mapping (no re-implementation of dedupe / normalization).

Run:
  python scripts/build_spotlight_goldens.py            # all spotlight lessons
  python scripts/build_spotlight_goldens.py --limit 5  # smoke (first 5)
  python scripts/build_spotlight_goldens.py --dry-run  # judge only, no freeze
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

# Reuse the gate's enumeration + mapping + text helpers — DO NOT re-implement.
from content_evidence_gate import (  # noqa: E402
    dedupe_stories_by_canonical_code,
    fetch_story,
    fetch_story_list,
    spotlight_text,
    story_text,
)
from app.services.lesson_code_normalization import (  # noqa: E402
    normalize_manifest_code,
)

from google import genai  # noqa: E402
from google.genai import types as genai_types  # noqa: E402

# Same model + region as omo_grader (LOCKED, #1730). Vertex AI service account
# auth on Cloud Run / local gcloud ADC — no API key needed.
JUDGE_MODEL = "gemini-2.5-flash"
JUDGE_LOCATION = "us-central1"
JUDGE_PROJECT = "lingoleap-dev"
# Account that holds Vertex AI access on lingoleap-dev. Locally the ambient ADC
# may be pinned to another project's SA (the gcloud `lingoleap` config has been
# observed pointing at a career-creator-card SA), which 403s on lingoleap-dev.
# Set JUDGE_GCLOUD_ACCOUNT to a cached lingoleap account to mint a token from it
# explicitly. Unset (e.g. on Cloud Run) -> fall back to service-account ADC.
JUDGE_GCLOUD_ACCOUNT = os.environ.get("JUDGE_GCLOUD_ACCOUNT", "").strip()

GOLDEN_ROOT = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "golden"
JUDGE_JSONL = (
    REPO_ROOT / "qa" / "content-evidence" / "spotlight-golden-judge.jsonl"
)

# Fixed placeholder so re-runs are byte-stable (spec: do NOT use datetime.now).
JUDGED_AT_PLACEHOLDER = ""
VERIFIED_BY = "llm-judge-pending-spotcheck"
SOURCE = "staging-api"

TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[一-鿿]")
# Filler / stopword tokens that carry no lesson-topic signal — excluded from
# title_tokens so the keyword set is genuinely discriminative.
STOP_TOKENS = set(
    "的了是在和與及或也都就而又這那有我你他她它們之其以為對於從到把被讓使請"
    "一二三四五六七八九十學習閱讀策略文章課文題目下方完成表格內容"
)


# ---------------------------------------------------------------------------
# Judge prompt
# ---------------------------------------------------------------------------
JUDGE_SYSTEM_PROMPT = """你是國小國語文教材的內容稽核員。你的任務是判斷一份「閱讀聚光燈」(閱讀策略練習) 是否忠實對應「本課」的課文。

你會收到：
- 本課標題 (title)
- 本課課文段落 (paragraphs)
- 本課的聚光燈內容 (spotlight) —— 包含策略引導語、練習題、選項等

請判斷聚光燈內容是否「忠實對應本課」，回傳三選一的 verdict：

1. "faithful" —— 聚光燈在教 / 練習「本課」的主題與內容。引用本課課文的例子、人物、概念、論點即為忠實。
2. "cross_lesson" (張冠李戴) —— 聚光燈整段在講「別課」的主題。例如：本課課文是「供給與需求 / 物價波動」，但聚光燈整段在講「天才是練出來的 / 費德勒苦練」—— 這是把別課內容貼到本課，屬於嚴重錯誤。
3. "skeleton" (骨架) —— 聚光燈只有純標號 (一、二、三 / ❶❷❸) 或空白欄位，沒有任何實質內文可供判斷。

判斷原則 (CRITICAL，避免誤判)：
- 寬鬆對待「通用教學鷹架語」：像「小試身手」「請打勾」「請依論點檢核」「請依文章內容完成下方表格」「請從文章中找出證據」這類是合法的策略引導框架語，**不算**張冠李戴，**不影響** faithful 判定。
- 只有當聚光燈的**實質內文**明顯在講「別課主題」(跟本課 title / paragraphs 完全無關的另一個故事 / 概念) 才算 cross_lesson。
- 聚光燈引用本課課文的句子 / 例子 / 人物 = faithful (這正是策略練習該做的)。
- 聚光燈是空的或只有編號標記 = skeleton。
- 有疑慮但內容跟本課沾得上邊 → 傾向 faithful，不要過度判 cross_lesson。

回傳 JSON：
{
  "verdict": "faithful" | "cross_lesson" | "skeleton",
  "confidence": 0.0 到 1.0 的數字,
  "reasoning": "用繁體中文一兩句說明為什麼這樣判 (Young/方大哥會逐筆稽核)",
  "suspected_actual_lesson": "若 cross_lesson，描述聚光燈內容看起來像哪一課 / 在講什麼主題；否則空字串"
}"""

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["faithful", "cross_lesson", "skeleton"],
        },
        "confidence": {"type": "number"},
        "reasoning": {"type": "string"},
        "suspected_actual_lesson": {"type": "string"},
    },
    "required": ["verdict", "confidence", "reasoning", "suspected_actual_lesson"],
}


def build_judge_user_content(story: dict[str, Any]) -> str:
    title = str(story.get("title") or "").strip()
    paras = [str(p).strip() for p in (story.get("paragraphs") or []) if str(p).strip()]
    spotlight = story.get("spotlight_v2") or {}
    spot = spotlight_text(spotlight).strip()
    # Cap each section so a single huge lesson can't blow the prompt budget;
    # the topic signal is fully present within these caps.
    para_block = "\n".join(paras)[:6000]
    spot_block = spot[:6000]
    return (
        f"【本課標題】\n{title}\n\n"
        f"【本課課文段落】\n{para_block}\n\n"
        f"【本課聚光燈內容】\n{spot_block}\n"
    )


def make_client() -> genai.Client:
    """Vertex AI client for lingoleap-dev.

    Prefers an explicit token from the cached lingoleap account (works around a
    misconfigured ambient ADC pinned to another project). Falls back to default
    ADC when that account is not cached (e.g. on Cloud Run).
    """
    creds = None
    if JUDGE_GCLOUD_ACCOUNT:
        try:
            token = subprocess.check_output(
                ["gcloud", "auth", "print-access-token", JUDGE_GCLOUD_ACCOUNT],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            if token.startswith("ya29"):
                from google.oauth2.credentials import Credentials

                creds = Credentials(token=token)
        except Exception:
            creds = None
    return genai.Client(
        vertexai=True,
        project=JUDGE_PROJECT,
        location=JUDGE_LOCATION,
        credentials=creds,
    )


def judge_lesson(
    client: genai.Client, story: dict[str, Any], max_retries: int = 3
) -> dict[str, Any]:
    user_content = build_judge_user_content(story)
    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            resp = client.models.generate_content(
                model=JUDGE_MODEL,
                contents=user_content,
                config=genai_types.GenerateContentConfig(
                    system_instruction=JUDGE_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=JUDGE_SCHEMA,
                    max_output_tokens=1024,
                    temperature=0.0,
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                ),
            )
            raw = resp.text or ""
            data = json.loads(raw)
            verdict = data.get("verdict")
            if verdict not in ("faithful", "cross_lesson", "skeleton"):
                raise ValueError(f"bad verdict: {verdict!r}")
            return {
                "verdict": verdict,
                "confidence": float(data.get("confidence", 0.0)),
                "reasoning": str(data.get("reasoning", "")),
                "suspected_actual_lesson": str(
                    data.get("suspected_actual_lesson", "")
                ),
                "judge_error": None,
            }
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    # Fail-closed: a judge error is NOT a faithful verdict. Surface it so the
    # lesson stays without a golden (GOLDEN_MISSING at gate time).
    return {
        "verdict": "judge_error",
        "confidence": 0.0,
        "reasoning": f"judge call failed after {max_retries} attempts: {last_err}",
        "suspected_actual_lesson": "",
        "judge_error": str(last_err),
    }


# ---------------------------------------------------------------------------
# fingerprint + title_tokens for the golden
# ---------------------------------------------------------------------------
def content_fingerprint(spotlight: dict[str, Any]) -> dict[str, Any]:
    """sha256 (first 16) of the spotlight content text + a structure summary.

    Drift detector: if the deployed spotlight content changes, the hash flips
    and the gate flags L1_GOLDEN_MISMATCH.
    """
    text = spotlight_text(spotlight)
    sha16 = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    blocks = spotlight.get("blocks") or []
    type_seq = [b.get("type") for b in blocks if isinstance(b, dict)]
    return {
        "sha256_16": sha16,
        "block_count": len(blocks),
        "type_sequence": type_seq,
        "char_count": len(text),
    }


def title_tokens(story: dict[str, Any], limit: int = 40) -> list[str]:
    """Discriminative keyword set from this lesson's title + paragraphs."""
    text = story_text(story)
    seen: list[str] = []
    out: set[str] = set()
    toks = [m.group(0) for m in TOKEN_RE.finditer(text)]
    # Keep CJK bigrams + standalone alnum >=2 chars; drop stopwords.
    for idx, tok in enumerate(toks):
        if len(tok) >= 2 and tok.lower() not in STOP_TOKENS and tok not in out:
            out.add(tok)
            seen.append(tok)
        if idx + 1 < len(toks):
            bi = f"{tok}{toks[idx + 1]}"
            # bigram of two CJK chars, neither a stopword
            if (
                len(bi) == 2
                and tok not in STOP_TOKENS
                and toks[idx + 1] not in STOP_TOKENS
                and "一" <= tok <= "鿿"
                and "一" <= toks[idx + 1] <= "鿿"
                and bi not in out
            ):
                out.add(bi)
                seen.append(bi)
        if len(seen) >= limit:
            break
    return seen[:limit]


def freeze_golden(story: dict[str, Any], lesson_code: str) -> Path:
    norm = normalize_manifest_code(lesson_code)
    spotlight = story.get("spotlight_v2") or {}
    golden = {
        "lesson_code": norm,
        "step": "reading-strategy",
        "story_id": int(story["id"]),
        "verified_by": VERIFIED_BY,
        "source": SOURCE,
        "title": str(story.get("title") or ""),
        "title_tokens": title_tokens(story),
        "content_fingerprint": content_fingerprint(spotlight),
        "judged_at": JUDGED_AT_PLACEHOLDER,
    }
    out_dir = GOLDEN_ROOT / norm
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "reading-strategy.golden.json"
    out_path.write_text(
        json.dumps(golden, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return out_path


def main() -> int:
    ap = argparse.ArgumentParser(description="Build per-lesson spotlight goldens")
    ap.add_argument("--limit", type=int, default=None,
                    help="only judge the first N spotlight lessons (smoke)")
    ap.add_argument("--dry-run", action="store_true",
                    help="judge + write judge.jsonl, but do NOT freeze goldens")
    args = ap.parse_args()

    print("== build_spotlight_goldens ==")
    print(f"   judge model: {JUDGE_MODEL} @ {JUDGE_LOCATION}")

    stories = dedupe_stories_by_canonical_code(fetch_story_list())
    print(f"   lessons after dedupe: {len(stories)}")

    # Resolve full payloads + keep only lessons that actually have a spotlight.
    spotlight_lessons: list[tuple[str, dict[str, Any]]] = []
    for s in sorted(stories, key=lambda x: int(x.get("id", 0))):
        sid = int(s["id"])
        full = fetch_story(sid)
        sv2 = full.get("spotlight_v2") or {}
        if sv2.get("blocks"):
            spotlight_lessons.append((s.get("grade_code", ""), full))
    print(f"   lessons WITH spotlight: {len(spotlight_lessons)}")

    if args.limit:
        spotlight_lessons = spotlight_lessons[: args.limit]
        print(f"   limited to: {len(spotlight_lessons)}")

    client = make_client()

    JUDGE_JSONL.parent.mkdir(parents=True, exist_ok=True)
    frozen = 0
    counts = {"faithful": 0, "cross_lesson": 0, "skeleton": 0, "judge_error": 0}

    # Write the calibration jsonl incrementally so a late crash in a long
    # (paid) batch never discards already-computed verdicts. fail-closed: any
    # per-lesson exception is recorded as judge_error and the batch continues.
    with JUDGE_JSONL.open("w", encoding="utf-8") as fh:
        for idx, (lesson_code, story) in enumerate(spotlight_lessons, 1):
            try:
                norm = normalize_manifest_code(lesson_code)
                sid = int(story.get("id", 0))
                verdict_obj = judge_lesson(client, story)
                verdict = verdict_obj["verdict"]

                row = {
                    "lesson_code": norm,
                    "story_id": sid,
                    "title": str(story.get("title") or ""),
                    "verdict": verdict,
                    "confidence": verdict_obj["confidence"],
                    "reasoning": verdict_obj["reasoning"],
                    "suspected_actual_lesson": verdict_obj["suspected_actual_lesson"],
                }
                if verdict_obj.get("judge_error"):
                    row["judge_error"] = verdict_obj["judge_error"]

                froze = ""
                if verdict == "faithful" and not args.dry_run:
                    p = freeze_golden(story, lesson_code)
                    frozen += 1
                    froze = f" -> froze {p.relative_to(REPO_ROOT)}"
            except Exception as exc:  # noqa: BLE001
                # Per-lesson failure must not faithful-pass and must not abort
                # the batch — record it as judge_error and keep going.
                verdict = "judge_error"
                norm = normalize_manifest_code(lesson_code) if lesson_code else "?"
                sid = int(story.get("id", 0)) if isinstance(story, dict) else 0
                row = {
                    "lesson_code": norm,
                    "story_id": sid,
                    "title": str(story.get("title") or "") if isinstance(story, dict) else "",
                    "verdict": "judge_error",
                    "confidence": 0.0,
                    "reasoning": f"build error: {exc}",
                    "suspected_actual_lesson": "",
                    "judge_error": str(exc),
                }
                froze = ""

            counts[verdict] = counts.get(verdict, 0) + 1
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            fh.flush()
            print(
                f"   [{idx}/{len(spotlight_lessons)}] {row['lesson_code']} "
                f"(story {row['story_id']}) = {verdict} "
                f"(conf {row['confidence']:.2f}){froze}"
            )

    print("\n== Judge summary ==")
    print(f"   faithful     : {counts['faithful']}")
    print(f"   cross_lesson : {counts['cross_lesson']}")
    print(f"   skeleton     : {counts['skeleton']}")
    print(f"   judge_error  : {counts['judge_error']}")
    print(f"   goldens frozen: {frozen}{' (dry-run, none)' if args.dry_run else ''}")
    print(f"   judge.jsonl  : {JUDGE_JSONL.relative_to(REPO_ROOT)}")
    print("\n   NOTE: goldens are verified_by=llm-judge-pending-spotcheck "
          "(NOT human-verified yet).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
