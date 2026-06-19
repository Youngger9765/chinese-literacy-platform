#!/usr/bin/env python3
"""Eval harness for strategy_validate (閱讀聚光燈 free_text AI grading, #2192/#2255).

Usage:
  cd backend && .venv/bin/python ../scripts/eval_strategy_validate.py
  cd backend && .venv/bin/python ../scripts/eval_strategy_validate.py --live --limit 3
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.ai_generation.strategy_practice import (  # noqa: E402
    STRATEGY_VALIDATION_SCHEMA,
    validate_strategy_answer,
)
from app.services.llm_models import get_model_for_task  # noqa: E402

# Dev7 samples — G6-L23 free_text pedagogy
SAMPLES = [
    {
        "lesson": "G6-L23",
        "question": "❶找重點句：哪一句描述最嚴重的不好的事？",
        "good_answer": "2013年，他們在屏東縣一塊紅豆田中，發現了超過3000隻野鳥屍體。",
        "weak_answer": "不知道",
        "strategy_name": "摘要策略：問題．解決結構找重點",
        "story_title": "老鷹紅豆田毒鳥事件",
        "passage": "2012年10月，研究人員收到兩隻死亡的老鷹。2013年，他們在紅豆田發現超過3000隻野鳥屍體。",
    },
    {
        "lesson": "G6-L22",
        "question": "想想看：烏鴉遇到什麼問題？",
        "good_answer": "瓶子太深，水太少，喝不到水",
        "weak_answer": "天氣很好",
        "strategy_name": "摘要策略：問題．解決．結果結構",
        "story_title": "烏鴉喝水",
    },
    {
        "lesson": "G7-L28",
        "question": "先看圖，你覺得這篇文章主要在談什麼？",
        "good_answer": "巴斯德用實驗證明肉湯腐敗不是自然發生",
        "weak_answer": "煮湯",
        "strategy_name": "圖文整合閱讀策略（初階）",
        "story_title": "看不見的兇手",
    },
]


def offline_checks() -> list[dict]:
    model, region = get_model_for_task("strategy_validate")
    results = [
        {
            "check": "task_model",
            "pass": model == "gemini-2.5-flash-lite" and region == "global",
            "detail": f"{model} @ {region}",
        },
        {
            "check": "schema_fields",
            "pass": set(STRATEGY_VALIDATION_SCHEMA["required"])
            == {"is_correct", "feedback", "suggestion"},
            "detail": STRATEGY_VALIDATION_SCHEMA["required"],
        },
        {
            "check": "sample_count",
            "pass": len(SAMPLES) >= 3,
            "detail": len(SAMPLES),
        },
    ]
    for s in SAMPLES:
        results.append(
            {
                "check": f"fixture_{s['lesson']}",
                "pass": bool(s["question"] and s["good_answer"] and s["weak_answer"]),
                "detail": s["question"][:40],
            }
        )
    return results


async def live_eval(limit: int) -> list[dict]:
    out: list[dict] = []
    for sample in SAMPLES[:limit]:
        for label, answer in [("good", sample["good_answer"]), ("weak", sample["weak_answer"])]:
            try:
                result = await validate_strategy_answer(
                    question=sample["question"],
                    student_answer=answer,
                    strategy_name=sample.get("strategy_name"),
                    story_title=sample.get("story_title"),
                    passage=sample.get("passage"),
                )
                out.append(
                    {
                        "lesson": sample["lesson"],
                        "label": label,
                        "answer": answer[:60],
                        "is_correct": result.get("is_correct"),
                        "feedback": result.get("feedback", "")[:120],
                        "suggestion": result.get("suggestion", "")[:120],
                        "pass": label == "good" and result.get("is_correct") is True
                        or label == "weak" and result.get("is_correct") is False,
                    }
                )
            except Exception as exc:
                out.append(
                    {
                        "lesson": sample["lesson"],
                        "label": label,
                        "pass": False,
                        "error": str(exc),
                    }
                )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Eval strategy_validate grader")
    parser.add_argument("--live", action="store_true", help="Call Vertex AI (costs tokens)")
    parser.add_argument("--limit", type=int, default=3, help="Max lessons for --live")
    args = parser.parse_args()

    offline = offline_checks()
    print("=== Offline checks ===")
    for row in offline:
        status = "PASS" if row["pass"] else "FAIL"
        print(f"  [{status}] {row['check']}: {row.get('detail', '')}")

    if not args.live:
        print("\nRun with --live to grade sample answers via Vertex AI")
        failed = [r for r in offline if not r["pass"]]
        return 1 if failed else 0

    print("\n=== Live eval ===")
    live = asyncio.run(live_eval(args.limit))
    for row in live:
        status = "PASS" if row.get("pass") else "FAIL"
        print(json.dumps(row, ensure_ascii=False))
    failed = [r for r in live if not r.get("pass")]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
