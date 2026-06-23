#!/usr/bin/env python3
"""
spotlight_vision_judge.py — Multimodal vision judge for 聚光燈 / 重點表 content (#2397).

Why vision, not text: 聚光燈 (reading-strategy) and 重點表 (story-structure) are
highly-customized content + layout. Token-overlap text matching misfires ~85%
(the deprecated anti_cross_lesson heuristic). Only a RENDER screenshot fed to a
multimodal model can see (a) cross-lesson content swap, (b) skeleton-only pages,
and crucially (c) placeholder/broken figure images that never appear in the API
text payload.

Flow per cell:
  1. Render staging /learn/{story_id}/{step} (REUSE the gate's Browse + login +
     l3_render_cell — we do NOT reimplement the login flow).
  2. Feed the screenshot (image bytes, multimodal) + this lesson's authoritative
     title/paragraphs (from /api/stories) to Gemini vision.
  3. Ask it to classify the RENDERED page against THIS lesson:
       faithful      — content + layout faithfully serve this lesson
       cross_lesson  — 張冠李戴: the body teaches a DIFFERENT lesson's topic
       skeleton       — pure scaffold/numbering, no substantive body text
       figure_broken  — a placeholder book/pencil icon or broken/missing image
     + confidence (0-1) + reasoning (mandatory, for audit)
     + suspected_actual_lesson (only when cross_lesson)

EDD discipline: this judge must pass the human-labeled eval set
(backend/data/curriculum_qa/eval/spotlight_keypoints_eval.yaml) BEFORE it is
allowed to run on all 152 lessons. Calibrate with --calibrate.

The prompt is a GENERAL rule — it never sees expected_verdict and never branches
on story_id. Feeding answers per lesson would be cheating (overfit).

Usage:
  # single cell (ad-hoc)
  python scripts/spotlight_vision_judge.py --story-id 1020 --step reading-strategy

  # EDD calibration over the 11-case eval set
  python scripts/spotlight_vision_judge.py --calibrate
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

# Reuse the gate's render pipeline — do NOT rewrite login / browse.
from content_evidence_gate import (  # noqa: E402
    Browse,
    browse_login,
    fetch_story,
    l3_render_cell,
)

EVAL_PATH = (
    REPO_ROOT / "backend" / "data" / "curriculum_qa" / "eval"
    / "spotlight_keypoints_eval.yaml"
)
CALIBRATION_REPORT = (
    REPO_ROOT / "qa" / "content-evidence" / "vision-judge-calibration.md"
)

# Vision model: gemini-2.5-flash @ us-central1 (multimodal, OMO-grader proven).
JUDGE_MODEL = "gemini-2.5-flash"
JUDGE_LOCATION = "us-central1"

VERDICTS = ("faithful", "cross_lesson", "skeleton", "figure_broken")

STEP_LABEL = {
    "reading-strategy": "閱讀聚光燈（reading-strategy）",
    "story-structure": "文章重點表（story-structure）",
}


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Prompt (GENERAL RULE — no story_id branching, never sees expected_verdict)
# ---------------------------------------------------------------------------
JUDGE_SYSTEM_PROMPT = """你是國語文閱讀學習平台的內容品管審查員。你會收到「一張某課某學習步驟的網頁截圖」＋「這一課的權威課文資料（標題＋課文段落）」。

你的工作:看截圖上實際 render 出來的內容與排版,判斷它是否忠實地服務「這一課」。你必須同時看「文字內容」與「視覺排版/圖片」,因為有些缺陷(假佔位圖、破圖)只在畫面上看得到、不在文字裡。

請輸出四選一的 verdict:

1. faithful(忠實)
   - 截圖上的實質內容是在講「這一課」的主題/角色/論點,或是合法的通用教學鷹架。
   - ✅ 合法的通用教學鷹架語一律算 faithful,不算張冠李戴。例如:
       「小試身手」「請打勾」「論據檢核」「問出重要問題」「找出關鍵句」「推論三步驟」
       「換位思考」「指稱詞練習」等策略引導語 —— 這些是教學方法的鷹架,本來就跨課通用。
   - 只要頁面的實質敘述、舉的例子、點到的人事物,與本課課文一致(或只是通用策略框架),就是 faithful。
   - 排版正常、有實質內文、圖片(若有)是真實圖示。

2. cross_lesson(張冠李戴)
   - 頁面的「主體實質內容」(策略要練的那篇文本、那組舉例、那個被分析的主題)
     明確在講「另一課的主題」,與本課課文完全無關。
   - 關鍵判準:不是「用語不同」,而是「頁面主體被分析的文本/主要舉例/整段敘述,是別的課文」。
     例如本課課文講「供給與需求/物價」,但聚光燈整個主體在講「費德勒/海菲茲靠練習成為天才」——
     本課的供需主題完全不見、整段被別課內容取代 = cross_lesson。
   - 如果判定 cross_lesson,請在 suspected_actual_lesson 填你推測那段內容「其實是哪一課/什麼主題」。
   - ⚠️ 重要的負面判準(避免誤判,以下情況「不是」cross_lesson,應判 faithful):
       (a) 頁面用了通用策略鷹架語(小試身手/論據檢核/問出重要問題)。
       (b) 頁面在「示範如何做」的步驟裡,夾帶一個跟本課無關的「教學示範例/造句範例/格式範例」,
           但頁面的主體內容、被分析的文本、主要討論對象仍然是本課。
           例如本課是《背影》,主體在討論「朱自清為什麼寫背影」(=忠實本課),
           只是在教學生「怎麼提問」的步驟順手舉了一句格式示範(提到別的作者名)——
           這只是 scaffold 裡的 incidental 範例,主體仍是本課 → faithful,不是 cross_lesson。
     只有「頁面主體/被分析的文本本身」是別課時才判 cross_lesson;
     單一句範例、格式示範、scaffold 夾帶的他課人名,都不足以構成 cross_lesson。

3. skeleton(純骨架)
   - 頁面只有編號、標號、空白格(一、二、三 / 1.2.3. / 甲乙丙),沒有實質內文。
   - 沒有可讀的句子、沒有舉例、沒有策略說明 —— 只是空殼。

4. figure_broken(破圖 — 限「圖片載入失敗」,不含已載入的圖)
   - 只在出現「圖片『載入失敗』」的明確訊號時才判 figure_broken:
       * 明確的「圖片載入失敗」字樣 / broken-image alt text / 紅叉 / 載入錯誤框。
       * 系統的破圖 icon(瀏覽器那種「圖裂掉」的方塊小山+破角)。
       * loading spinner 卡住、永遠轉不出來的灰色 loading 佔位。
   - 這是多模態判斷的關鍵 —— 只有看畫面才看得到「圖根本沒載出來」。
   - ⚠️ 非常重要的負面判準(避免 false figure_broken):以下「不是」figure_broken,
     若內容忠實則判 faithful——
       (a) 圖片其實「有成功載入」,只是畫質低 / 模糊 / 像素化 / 是通用 clip-art
           (例如一隻手指圖、插頭圖、讚的圖示)。
           只要它是一張「載出來的圖」(不是載入失敗框),即使它看起來通用或不夠精緻,
           都不算 figure_broken。圖醜 ≠ 圖破。
       (b) 頁面根本沒有圖。
       (c) 圖跟課文主題關聯性不強,但圖本身有載出來。
     判準只看「圖有沒有載出來」這個二分:載失敗框 → figure_broken;
     有載出來(不論美醜/通用與否)→ 不是 figure_broken。

判斷優先序(當多種情況同時可能時):
   - 若頁面幾乎沒有實質內文 → skeleton 優先。
   - 若有實質內文但「頁面主體被分析的文本」是別課 → cross_lesson。
   - 若內容忠實但出現「圖片載入失敗框/破圖 icon」→ figure_broken。
   - 其餘(內容忠實、排版正常、圖有載出來或無圖)→ faithful。

confidence:0~1,你對這個 verdict 的信心。
reasoning:必填,用 2-4 句中文具體說明你在截圖上看到什麼、為什麼這樣判(要可稽核,引用畫面上的具體字句或視覺元素)。
suspected_actual_lesson:只有 cross_lesson 時填,推測那段內容其實是哪一課/什麼主題;其餘填空字串。

只依據截圖上「實際看到的」判斷,不要腦補截圖外的內容。"""


JUDGE_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": list(VERDICTS),
        },
        "confidence": {"type": "number"},
        "reasoning": {"type": "string"},
        "suspected_actual_lesson": {"type": "string"},
    },
    "required": ["verdict", "confidence", "reasoning"],
}


def build_user_text(story: dict[str, Any], step: str) -> str:
    title = str(story.get("title") or "").strip()
    grade_code = str(story.get("grade_code") or "").strip()
    paragraphs = [str(p or "").strip() for p in (story.get("paragraphs") or [])]
    paragraphs = [p for p in paragraphs if p]
    # Cap body so we don't blow tokens; the topic is identifiable from the head.
    body = "\n".join(paragraphs)
    if len(body) > 3000:
        body = body[:3000] + "…(課文已截斷)"
    step_label = STEP_LABEL.get(step, step)
    return (
        f"【本課權威資料】\n"
        f"課程代碼:{grade_code}\n"
        f"課文標題:{title}\n"
        f"課文段落:\n{body if body else '(無課文段落)'}\n\n"
        f"【待判斷的截圖】\n"
        f"這是本課「{step_label}」步驟的網頁截圖。\n"
        f"請判斷截圖上 render 出來的內容與排版,是否忠實服務上面這一課。\n"
        f"依 system 指示輸出 verdict / confidence / reasoning / suspected_actual_lesson。"
    )


# ---------------------------------------------------------------------------
# Vision call
# ---------------------------------------------------------------------------
def judge_screenshot(
    screenshot_path: Path,
    story: dict[str, Any],
    step: str,
) -> dict[str, Any]:
    """Send screenshot + lesson context to Gemini vision, return verdict dict."""
    from google import genai
    from google.genai import types as genai_types

    image_bytes = screenshot_path.read_bytes()
    client = genai.Client(
        vertexai=True, project="lingoleap-dev", location=JUDGE_LOCATION
    )

    user_text = build_user_text(story, step)
    parts = [
        genai_types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
        genai_types.Part.from_text(text=user_text),
    ]

    response = client.models.generate_content(
        model=JUDGE_MODEL,
        contents=[genai_types.Content(parts=parts, role="user")],
        config=genai_types.GenerateContentConfig(
            system_instruction=JUDGE_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=JUDGE_RESPONSE_SCHEMA,
            max_output_tokens=1024,
            temperature=0.0,
            thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            automatic_function_calling=(
                genai_types.AutomaticFunctionCallingConfig(disable=True)
            ),
        ),
    )
    raw = (response.text or "").strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {
            "verdict": "parse_error",
            "confidence": 0.0,
            "reasoning": f"JSON parse failed: {raw[:200]}",
            "suspected_actual_lesson": "",
        }
    parsed.setdefault("suspected_actual_lesson", "")
    return parsed


# Tall viewport so the WHOLE page (incl. below-the-fold figures) is captured in
# one shot. The gate's default screenshot is viewport-only (1280x720) — a broken
# image lower on the page would never enter frame and figure_broken would be
# missed. The browser caps output height, so the saved shot is downscaled but
# the full page is in frame and text stays legible enough for topic ID.
FULLPAGE_VIEWPORT = "1280x3200"


def capture_fullpage(browse: Browse, shot_path: Path) -> int:
    """Set a tall viewport and re-screenshot the current page. Returns bytes."""
    browse._run(["viewport", FULLPAGE_VIEWPORT])
    time.sleep(1)
    # nudge lazy content into rendering, then settle back to top
    browse._run(["scroll", "--load"])
    time.sleep(1)
    browse.screenshot(str(shot_path))
    return shot_path.stat().st_size if shot_path.exists() else 0


# ---------------------------------------------------------------------------
# Render + judge a single cell (reuses gate l3_render_cell for login + nav)
# ---------------------------------------------------------------------------
def render_and_judge(
    browse: Browse,
    story_id: int,
    step: str,
    shots_dir: Path,
) -> dict[str, Any]:
    story = fetch_story(story_id)
    # l3_render_cell does login-redirect detection, console capture, nav + retry.
    render = l3_render_cell(browse, story, step, shots_dir)
    # Mirror how l3_render_cell builds its path (shots_dir/<id>/<step>.png).
    shot_path = shots_dir / str(story_id) / f"{step}.png"
    result: dict[str, Any] = {
        "story_id": story_id,
        "lesson_code": story.get("grade_code", ""),
        "title": story.get("title", ""),
        "step": step,
        "render_loaded": render["render"]["loaded"],
        "render_on_login": render["render"]["on_login_page"],
        "console_error_count": render["render"]["console_error_count"],
        "checked_at": utcnow(),
    }
    if render["screenshot"]["bytes"] == 0 or render["render"]["on_login_page"]:
        result.update(
            screenshot_path=str(shot_path),
            screenshot_bytes=render["screenshot"]["bytes"],
            verdict="render_failed",
            confidence=0.0,
            reasoning=(
                "Render did not produce a usable screenshot "
                f"(on_login={render['render']['on_login_page']}, "
                f"loaded={render['render']['loaded']})."
            ),
            suspected_actual_lesson="",
        )
        return result
    # Re-capture full page (the gate's shot is viewport-only). Overwrites the
    # viewport shot at the same path with the full-page version we judge on.
    fp_bytes = capture_fullpage(browse, shot_path)
    result["screenshot_path"] = str(shot_path)
    result["screenshot_bytes"] = fp_bytes
    if fp_bytes == 0:
        result.update(
            verdict="render_failed",
            confidence=0.0,
            reasoning="Full-page screenshot capture produced 0 bytes.",
            suspected_actual_lesson="",
        )
        return result
    verdict = judge_screenshot(shot_path, story, step)
    result.update(verdict)
    return result


# ---------------------------------------------------------------------------
# EDD calibration
# ---------------------------------------------------------------------------
def load_eval_cases() -> list[dict[str, Any]]:
    data = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8")) or {}
    return data.get("cases") or []


# --- EDD release gate thresholds ------------------------------------------
# The judge is NOT cleared for the full 152-lesson run unless it clears these.
# Overall accuracy must be high AND the defect classes (the whole point of a
# vision judge) must each be fully recalled — a judge that misses cross_lesson /
# skeleton / figure_broken is worthless even at high overall accuracy because
# faithful cases dominate the set.
MIN_OVERALL_ACCURACY = 0.85
# Categories whose recall MUST be 1.0 (every eval case in them must be hit).
CRITICAL_DEFECT_VERDICTS = ("cross_lesson", "skeleton", "figure_broken")


def per_category_recall(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """recall per expected verdict: {verdict: {hits, total}}."""
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        cat = r["expected"]
        slot = out.setdefault(cat, {"hits": 0, "total": 0})
        slot["total"] += 1
        if r["hit"]:
            slot["hits"] += 1
    return out


def evaluate_gate(
    rows: list[dict[str, Any]],
) -> tuple[bool, list[str], dict[str, dict[str, int]]]:
    """Return (passed, fail_reasons, recall_by_cat)."""
    total = len(rows)
    hits = sum(1 for r in rows if r["hit"])
    acc = hits / total if total else 0.0
    recall = per_category_recall(rows)
    reasons: list[str] = []
    if acc < MIN_OVERALL_ACCURACY:
        reasons.append(
            f"overall accuracy {hits}/{total}={acc:.2f} < {MIN_OVERALL_ACCURACY}"
        )
    for cat in CRITICAL_DEFECT_VERDICTS:
        slot = recall.get(cat)
        if slot is None:
            reasons.append(
                f"defect class '{cat}' has NO eval case (cannot verify recall)"
            )
        elif slot["hits"] < slot["total"]:
            reasons.append(
                f"defect class '{cat}' recall {slot['hits']}/{slot['total']} < 1.0"
            )
    return (not reasons), reasons, recall


def write_calibration_report(summary: dict[str, Any], path: Path) -> None:
    rows = summary["rows"]
    passed = summary["gate_passed"]
    reasons = summary["gate_fail_reasons"]
    recall = summary["recall_by_category"]
    lines: list[str] = []
    lines.append("# Vision Judge — EDD 校準報告")
    lines.append("")
    lines.append(f"- run_id: `{summary['run_id']}`")
    lines.append(f"- judged_at: {summary['judged_at']}")
    lines.append(f"- model: `{JUDGE_MODEL}` @ `{JUDGE_LOCATION}`(多模態 vision)")
    lines.append(f"- eval set: `{EVAL_PATH.relative_to(REPO_ROOT)}`")
    lines.append("")
    lines.append("## 結論")
    verdict_word = "PASS — 達標,可放行跑全量(待 Young/coordinator 看過)" if passed \
        else "FAIL — 未達標,judge 還沒校準到位,不可放出去用"
    lines.append(f"- **{verdict_word}**")
    lines.append(f"- 整體準度:**{summary['accuracy']}** "
                 f"(門檻 ≥ {MIN_OVERALL_ACCURACY:.0%})")
    if reasons:
        lines.append("- 未過門檻原因:")
        for r in reasons:
            lines.append(f"  - {r}")
    lines.append("")
    lines.append("## 各類別 recall(defect class 必須 1.0)")
    lines.append("")
    lines.append("| expected verdict | recall | 是否關鍵缺陷類 |")
    lines.append("|---|---|---|")
    for cat in sorted(recall):
        slot = recall[cat]
        crit = "✅ 關鍵" if cat in CRITICAL_DEFECT_VERDICTS else ""
        lines.append(f"| {cat} | {slot['hits']}/{slot['total']} | {crit} |")
    lines.append("")
    lines.append("## 逐案 expected vs got")
    lines.append("")
    lines.append("| # | story | code | step | expected | got | hit | conf |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for i, r in enumerate(rows, 1):
        mark = "✅" if r["hit"] else "❌"
        lines.append(
            f"| {i} | {r['story_id']} | {r['lesson_code']} | {r['step']} "
            f"| {r['expected']} | **{r['got']}** | {mark} | {r['confidence']} |"
        )
    lines.append("")
    lines.append("## 逐案 reasoning(稽核用)")
    lines.append("")
    for i, r in enumerate(rows, 1):
        mark = "HIT" if r["hit"] else "MISS"
        lines.append(
            f"### {i}. story {r['story_id']} {r['lesson_code']} "
            f"{r['step']} — {mark}"
        )
        lines.append(f"- expected: `{r['expected']}` | got: `{r['got']}` "
                     f"| confidence: {r['confidence']}")
        lines.append(f"- 標註理由(why expected): {r['why_expected']}")
        lines.append(f"- judge reasoning: {r['reasoning']}")
        if r.get("suspected_actual_lesson"):
            lines.append(
                f"- suspected_actual_lesson: {r['suspected_actual_lesson']}"
            )
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def run_calibration(run_id: str | None = None) -> dict[str, Any]:
    cases = load_eval_cases()
    run_id = run_id or dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
    shots_dir = (
        REPO_ROOT / "qa" / "content-evidence" / f"vision-judge-{run_id}"
        / "screenshots"
    )
    shots_dir.mkdir(parents=True, exist_ok=True)

    browse = Browse()
    browse.restart()
    time.sleep(2)
    if not browse_login(browse):
        print("FATAL: demo login failed (still on /login)", file=sys.stderr)
        sys.exit(2)
    print("   demo login OK", flush=True)

    rows: list[dict[str, Any]] = []
    for i, case in enumerate(cases, 1):
        sid = int(case["story_id"])
        step = case.get("step", "reading-strategy")
        expected = case["expected_verdict"]
        print(f"   [{i}/{len(cases)}] story {sid} {step} (expect {expected})",
              flush=True)
        try:
            judged = render_and_judge(browse, sid, step, shots_dir)
        except Exception as exc:  # pragma: no cover
            judged = {
                "story_id": sid,
                "step": step,
                "verdict": "error",
                "confidence": 0.0,
                "reasoning": f"exception: {exc}",
                "suspected_actual_lesson": "",
            }
        got = judged.get("verdict", "error")
        hit = got == expected
        rows.append(
            {
                "story_id": sid,
                "lesson_code": case.get("lesson_code")
                or judged.get("lesson_code", ""),
                "title": case.get("title") or judged.get("title", ""),
                "step": step,
                "expected": expected,
                "got": got,
                "hit": hit,
                "confidence": judged.get("confidence"),
                "reasoning": judged.get("reasoning", ""),
                "suspected_actual_lesson": judged.get(
                    "suspected_actual_lesson", ""
                ),
                "why_expected": case.get("why", ""),
                "screenshot_path": judged.get("screenshot_path", ""),
            }
        )
        print(f"        -> got {got} {'HIT' if hit else 'MISS'}", flush=True)

    hits = sum(1 for r in rows if r["hit"])
    passed, reasons, recall = evaluate_gate(rows)
    summary = {
        "run_id": run_id,
        "total": len(rows),
        "hits": hits,
        "accuracy": f"{hits}/{len(rows)}",
        "recall_by_category": recall,
        "gate_passed": passed,
        "gate_fail_reasons": reasons,
        "min_overall_accuracy": MIN_OVERALL_ACCURACY,
        "critical_defect_verdicts": list(CRITICAL_DEFECT_VERDICTS),
        "rows": rows,
        "judged_at": utcnow(),
    }
    raw_path = shots_dir.parent / "calibration_raw.json"
    raw_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_calibration_report(summary, CALIBRATION_REPORT)
    print(f"\n   calibration: {hits}/{len(rows)}", flush=True)
    print(f"   recall: " + ", ".join(
        f"{c}={recall[c]['hits']}/{recall[c]['total']}" for c in sorted(recall)
    ), flush=True)
    print(f"   gate: {'PASS' if passed else 'FAIL'}", flush=True)
    for r in reasons:
        print(f"     - {r}", flush=True)
    print(f"   raw    -> {raw_path}", flush=True)
    print(f"   report -> {CALIBRATION_REPORT.relative_to(REPO_ROOT)}",
          flush=True)
    return summary


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    p = argparse.ArgumentParser(description="Spotlight/keypoints vision judge")
    p.add_argument("--story-id", type=int, help="single-cell ad-hoc judge")
    p.add_argument("--step", default="reading-strategy",
                   choices=["reading-strategy", "story-structure"])
    p.add_argument("--calibrate", action="store_true",
                   help="run EDD calibration over the eval set")
    p.add_argument("--run-id", default=None)
    args = p.parse_args()

    if args.calibrate:
        summary = run_calibration(args.run_id)
        # Hard gate: fail-closed. A non-zero exit blocks any caller (CI / ship
        # gate / a human) from treating an uncalibrated judge as usable.
        return 0 if summary["gate_passed"] else 1

    if args.story_id is None:
        p.error("either --calibrate or --story-id is required")

    run_id = args.run_id or dt.datetime.now(dt.timezone.utc).strftime(
        "%Y%m%d-%H%M%S"
    )
    shots_dir = (
        REPO_ROOT / "qa" / "content-evidence" / f"vision-judge-{run_id}"
        / "screenshots"
    )
    shots_dir.mkdir(parents=True, exist_ok=True)
    browse = Browse()
    browse.restart()
    time.sleep(2)
    if not browse_login(browse):
        print("FATAL: demo login failed", file=sys.stderr)
        return 2
    result = render_and_judge(browse, args.story_id, args.step, shots_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
