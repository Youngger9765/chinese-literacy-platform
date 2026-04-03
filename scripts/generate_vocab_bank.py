#!/usr/bin/env python3
"""
Generate vocab_bank for lesson YAML files that have fill_in_blank but no vocab_bank.

The vocab_bank maps answer codes (A, B, C...) to Chinese vocabulary words.
We use Vertex AI Gemini to analyze each fill_in_blank sentence and match
the answer code to the correct word from the vocabulary list.

Usage:
    python3 scripts/generate_vocab_bank.py [--dry-run] [--lesson L02]
"""
import argparse
import json
import os
import re
import sys
import glob
import warnings

warnings.filterwarnings("ignore")

import yaml
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

# GCP project settings (from CLAUDE.md)
GCP_PROJECT = "lingoleap-dev"
GCP_LOCATION = "us-central1"
MODEL_NAME = "gemini-2.5-flash"

LESSONS_DIR = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "lessons")


def normalize_code(code: str) -> str:
    """Normalize full-width letters (Ａ, Ｂ, ...) to ASCII (A, B, ...)."""
    if not code:
        return code
    normalized = ""
    for ch in code.strip():
        if "\uff21" <= ch <= "\uff3a":
            normalized += chr(ord("A") + ord(ch) - ord("\uff21"))
        else:
            normalized += ch
    return normalized


def load_yaml(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_yaml_insert_vocab_bank(path: str, vocab_bank: dict) -> None:
    """Insert vocab_bank into YAML file before fill_in_blank:"""
    with open(path, encoding="utf-8") as f:
        content = f.read()

    # Build the vocab_bank YAML block (compact, no extra blank lines)
    vb_lines = ["vocab_bank:"]
    for code in sorted(vocab_bank.keys()):
        word = vocab_bank[code]
        vb_lines.append(f"  {code}: {word}")
    vb_block = "\n".join(vb_lines) + "\n"

    if "vocab_bank:" in content:
        # Replace existing (shouldn't happen, but safe)
        content = re.sub(
            r"vocab_bank:.*?(?=\nfill_in_blank:)",
            vb_block.rstrip(),
            content,
            flags=re.DOTALL,
        )
    else:
        # Insert before fill_in_blank:
        content = content.replace("fill_in_blank:", vb_block + "fill_in_blank:", 1)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def build_prompt(fill_in_blank: list, vocabulary: list) -> str:
    vocab_list = "、".join(v["word"] for v in vocabulary)
    sentences_str = "\n".join(
        "代碼" + normalize_code(q["answer"]) + "：" + q["sentence"]
        for q in fill_in_blank
    )
    unique_codes = sorted(set(normalize_code(q["answer"]) for q in fill_in_blank))
    example_template = "{" + ",".join('"' + c + '":"詞"' for c in unique_codes) + "}"

    return (
        "詞彙：" + vocab_list + "\n\n"
        "填空題：\n" + sentences_str + "\n\n"
        "請以緊湊JSON格式（無空格無換行）回傳代碼對應詞語，格式如：" + example_template
    )


def generate_vocab_bank_with_ai(model, lesson_data: dict) -> dict:
    """Use Gemini to match answer codes to vocabulary words."""
    fill_in_blank = lesson_data.get("fill_in_blank", [])
    vocabulary = lesson_data.get("vocabulary", [])

    if not fill_in_blank or not vocabulary:
        return {}

    unique_codes = sorted(set(normalize_code(q["answer"]) for q in fill_in_blank))
    prompt = build_prompt(fill_in_blank, vocabulary)

    response = model.generate_content(
        prompt,
        generation_config=GenerationConfig(
            max_output_tokens=2048,
            temperature=0,
        ),
    )

    text = response.text.strip()

    # Strip markdown code blocks if present
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError as e:
        print(f"    ERROR parsing Gemini response: {e}")
        print(f"    Raw response (first 300 chars): {text[:300]}")
        return {}

    # Normalize codes in result and validate
    vocab_words = {v["word"] for v in vocabulary}
    normalized = {}
    for code, word in result.items():
        norm_code = normalize_code(code)
        if norm_code not in unique_codes:
            print(f"    WARNING: unexpected code {code} in response, skipping")
            continue
        if word not in vocab_words:
            print(f"    WARNING: '{word}' not in vocabulary list, skipping")
            continue
        normalized[norm_code] = word

    # Log missing codes
    missing = set(unique_codes) - set(normalized.keys())
    if missing:
        print(f"    WARNING: Missing codes in response: {missing}")

    return normalized


def process_file(path: str, model, dry_run: bool = False) -> str:
    """Process a single YAML file. Returns 'updated', 'skipped', or 'failed'."""
    data = load_yaml(path)
    lesson_name = os.path.basename(path)

    if not data.get("fill_in_blank"):
        print(f"  {lesson_name}: no fill_in_blank, skipping")
        return "skipped"

    if data.get("vocab_bank"):
        print(f"  {lesson_name}: already has vocab_bank, skipping")
        return "skipped"

    print(f"  {lesson_name}: generating vocab_bank...")

    vocab_bank = generate_vocab_bank_with_ai(model, data)

    if not vocab_bank:
        print(f"  {lesson_name}: FAILED")
        return "failed"

    print(f"  {lesson_name}: {vocab_bank}")

    if not dry_run:
        save_yaml_insert_vocab_bank(path, vocab_bank)
        print(f"  {lesson_name}: SAVED")

    return "updated"


def main():
    parser = argparse.ArgumentParser(description="Generate vocab_bank for lesson YAMLs")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, don't save")
    parser.add_argument("--lesson", help="Process only this lesson (e.g. L02)")
    args = parser.parse_args()

    print(f"Initializing Vertex AI (project={GCP_PROJECT}, location={GCP_LOCATION})")
    vertexai.init(project=GCP_PROJECT, location=GCP_LOCATION)
    model = GenerativeModel(MODEL_NAME)

    if args.lesson:
        pattern = os.path.join(LESSONS_DIR, f"{args.lesson}.yml")
        files = glob.glob(pattern)
        if not files:
            print(f"ERROR: {pattern} not found")
            sys.exit(1)
    else:
        files = sorted(glob.glob(os.path.join(LESSONS_DIR, "L*.yml")))

    print(f"\nProcessing {len(files)} file(s)...")
    if args.dry_run:
        print("DRY RUN — no files will be modified\n")

    counts = {"updated": 0, "skipped": 0, "failed": 0}

    for path in files:
        result = process_file(path, model, dry_run=args.dry_run)
        counts[result] = counts.get(result, 0) + 1

    print(f"\nDone: {counts['updated']} updated, {counts['skipped']} skipped, {counts['failed']} failed")
    if counts["failed"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
