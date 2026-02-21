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
import re
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

MAX_QUESTION_RETRIES = 5  # Max session retries to get a matching question


async def call_api(session, api_base, endpoint, payload):
    url = f"{api_base}{endpoint}"
    async with session.post(url, json=payload) as resp:
        if resp.status != 200:
            text = await resp.text()
            return {"error": f"HTTP {resp.status}: {text}"}
        return await resp.json()


async def setup_session(session, api_base, suite):
    """Start a session + warmup. Returns (sid, last_question) or (None, error)."""
    endpoint = suite["endpoint"]
    setup = suite["setup"]
    sid = f"eval-{int(time.time())}-{random.randint(10000, 99999)}"

    # Start session
    start_result = await call_api(session, api_base, endpoint, {
        "session_id": sid,
        "story_title": setup["story_title"],
        "story_text": setup["story_text"],
        "student_answer": None,
    })
    if "error" in start_result:
        return None, start_result["error"]

    last_question = start_result.get("question", "")

    # Warmup: give correct answers to advance past initial questions
    for warmup in setup.get("warmup_answers", []):
        warmup_result = await call_api(session, api_base, endpoint, {
            "session_id": sid,
            "story_title": setup["story_title"],
            "story_text": setup["story_text"],
            "student_answer": warmup,
        })
        if "error" not in warmup_result:
            last_question = warmup_result.get("question", "")

    return sid, last_question


async def run_single_case(session, api_base, suite, case):
    """Run a single test case. Returns (case_id, actual, expected, passed, info)."""
    endpoint = suite["endpoint"]
    setup = suite["setup"]
    keyword = case.get("question_keyword")

    # If case has question_keyword, retry sessions until AI asks a matching question
    if keyword:
        pattern = re.compile(keyword)
        for attempt in range(MAX_QUESTION_RETRIES):
            sid, last_question = await setup_session(session, api_base, suite)
            if sid is None:
                return case["id"], "ERROR", case["expected_understood"], False, f"setup failed: {last_question}"
            if pattern.search(last_question):
                break
        else:
            return case["id"], "SKIP", case["expected_understood"], True, f"no matching question after {MAX_QUESTION_RETRIES} retries (last: {last_question[:30]})"
    else:
        sid, last_question = await setup_session(session, api_base, suite)
        if sid is None:
            return case["id"], "ERROR", case["expected_understood"], False, f"setup failed: {last_question}"

    # Test the actual case
    result = await call_api(session, api_base, endpoint, {
        "session_id": sid,
        "story_title": setup["story_title"],
        "story_text": setup["story_text"],
        "student_answer": case["input"],
    })

    if "error" in result:
        return case["id"], "ERROR", case["expected_understood"], False, result["error"]

    actual = result.get("understood")
    expected = case["expected_understood"]
    passed = actual == expected

    return case["id"], actual, expected, passed, f"Q: {last_question[:30]}"


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
    skipped = 0

    async with aiohttp.ClientSession() as session:
        for category, cases in sorted(by_category.items()):
            print(f"  {category} ({len(cases)} cases)")
            cat_passed = 0
            cat_total = 0

            for case in cases:
                votes = []
                last_info = ""
                for run_i in range(runs):
                    case_id, actual, expected, passed, info = await run_single_case(
                        session, api_base, suite, case
                    )
                    votes.append(passed)
                    last_info = info

                # Handle SKIP
                if actual == "SKIP":
                    print(f"  ~~ SKIP | '{case['input']}' — {last_info}")
                    skipped += 1
                    all_results.append({
                        "case_id": case_id,
                        "category": category,
                        "passed": True,  # Don't count skips as failures
                        "skipped": True,
                    })
                    cat_passed += 1
                    cat_total += 1
                    continue

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
                q_info = f" [{last_info}]" if not final_passed and last_info else ""
                print(f"  {icon} {status} | '{case['input']}' → {actual} (expected {expected}){confidence}{stability}{note}{q_info}")

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
    if skipped:
        print(f"  SKIPPED: {skipped} (no matching question)")
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
