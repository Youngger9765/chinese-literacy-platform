#!/usr/bin/env python3
"""
Agent Accuracy Eval Runner

Runs test suites against a live backend to measure LLM agent accuracy.
Test data lives in JSON files alongside this script.

Usage:
    python3 tests/agent-eval/run_eval.py --suite tests/agent-eval/socratic-eval.json --api-base https://...
    python3 tests/agent-eval/run_eval.py --all --api-base https://...
    python3 tests/agent-eval/run_eval.py --suite ... --api-base ... --runs 3  # majority vote
"""

import argparse
import asyncio
import json
import os
import sys
import time
import random
from collections import defaultdict
from pathlib import Path

try:
    import aiohttp
except ImportError:
    print("ERROR: aiohttp required. Install with: pip install aiohttp")
    sys.exit(1)


async def call_api(session, api_base, endpoint, payload):
    url = f"{api_base}{endpoint}"
    async with session.post(url, json=payload) as resp:
        if resp.status != 200:
            text = await resp.text()
            return {"error": f"HTTP {resp.status}: {text}"}
        return await resp.json()


async def run_single_case(session, api_base, suite, case):
    """Run a single test case. Returns (case_id, actual, expected, passed)."""
    endpoint = suite["endpoint"]
    setup = suite["setup"]
    sid = f"eval-{int(time.time())}-{random.randint(10000, 99999)}"

    # Start session
    await call_api(session, api_base, endpoint, {
        "session_id": sid,
        "story_title": setup["story_title"],
        "story_text": setup["story_text"],
        "student_answer": None,
    })

    # Warmup: give correct answers to advance past initial questions
    for warmup in setup.get("warmup_answers", []):
        await call_api(session, api_base, endpoint, {
            "session_id": sid,
            "story_title": setup["story_title"],
            "story_text": setup["story_text"],
            "student_answer": warmup,
        })

    # Test the actual case
    result = await call_api(session, api_base, endpoint, {
        "session_id": sid,
        "story_title": setup["story_title"],
        "story_text": setup["story_text"],
        "student_answer": case["input"],
    })

    if "error" in result:
        return case["id"], "ERROR", case["expected_understood"], False

    actual = result.get("understood")
    expected = case["expected_understood"]
    passed = actual == expected

    return case["id"], actual, expected, passed


async def run_suite(api_base, suite_path, runs=1):
    """Run all cases in a suite. Returns results dict."""
    with open(suite_path) as f:
        suite = json.load(f)

    print(f"\n{'='*60}")
    print(f"  {suite['suite_name']} — {suite['description']}")
    print(f"  {len(suite['cases'])} cases × {runs} run(s)")
    print(f"{'='*60}\n")

    # Group cases by category
    by_category = defaultdict(list)
    for case in suite["cases"]:
        by_category[case["category"]].append(case)

    all_results = []
    category_stats = {}

    async with aiohttp.ClientSession() as session:
        for category, cases in sorted(by_category.items()):
            print(f"  {category} ({len(cases)} cases)")
            cat_passed = 0
            cat_total = 0

            for case in cases:
                votes = []
                for run_i in range(runs):
                    case_id, actual, expected, passed = await run_single_case(
                        session, api_base, suite, case
                    )
                    votes.append(passed)

                # Majority vote
                pass_count = sum(votes)
                final_passed = pass_count > runs / 2

                if runs > 1:
                    confidence = f" [{pass_count}/{runs}]"
                    if pass_count == runs:
                        stability = ""
                    elif final_passed:
                        stability = " FLAKY"
                    else:
                        stability = " FLAKY" if pass_count > 0 else ""
                else:
                    confidence = ""
                    stability = ""

                status = "PASS" if final_passed else "FAIL"
                icon = "  " if final_passed else ">>"
                note = f" — {case.get('note', '')}" if case.get("note") else ""
                print(f"  {icon} {status} | '{case['input']}' → {actual} (expected {expected}){confidence}{stability}{note}")

                all_results.append({
                    "case_id": case_id,
                    "category": category,
                    "passed": final_passed,
                    "votes": votes if runs > 1 else None,
                })

                if final_passed:
                    cat_passed += 1
                cat_total += 1

            pct = (cat_passed / cat_total * 100) if cat_total else 0
            flag = "" if cat_passed == cat_total else "  ← FAILURES"
            category_stats[category] = (cat_passed, cat_total, pct)
            print(f"    subtotal: {cat_passed}/{cat_total} ({pct:.0f}%){flag}\n")

    # Summary
    total = len(all_results)
    passed = sum(1 for r in all_results if r["passed"])
    failed = total - passed
    pct = (passed / total * 100) if total else 0

    print(f"{'='*60}")
    print(f"  RESULTS: {passed}/{total} passed ({pct:.1f}%)")
    if failed:
        print(f"  FAILED:  {failed}")
    print()
    for cat, (p, t, pc) in sorted(category_stats.items()):
        flag = "" if p == t else " ← REVIEW"
        print(f"    {cat}: {p}/{t} ({pc:.0f}%){flag}")
    print(f"{'='*60}\n")

    return passed == total


async def main():
    parser = argparse.ArgumentParser(description="Agent Accuracy Eval Runner")
    parser.add_argument("--suite", help="Path to test suite JSON")
    parser.add_argument("--all", action="store_true", help="Run all suites in tests/agent-eval/")
    parser.add_argument("--api-base", required=True, help="Backend API base URL")
    parser.add_argument("--runs", type=int, default=1, help="Runs per case for majority vote (default: 1)")
    args = parser.parse_args()

    if args.all:
        eval_dir = Path(__file__).parent
        suites = sorted(eval_dir.glob("*.json"))
        if not suites:
            print("No test suites found in", eval_dir)
            sys.exit(1)
        all_passed = True
        for suite_path in suites:
            passed = await run_suite(args.api_base, suite_path, args.runs)
            if not passed:
                all_passed = False
        sys.exit(0 if all_passed else 1)
    elif args.suite:
        passed = await run_suite(args.api_base, args.suite, args.runs)
        sys.exit(0 if passed else 1)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
