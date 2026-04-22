#!/usr/bin/env python3
"""Fix bracket-split sentences in opus.v2.json files.

The segmenter incorrectly split some sentences inside a quote, turning
`「A，B。」` into two sentences `「A。` + `B。」`. This script rejoins them,
restores `，` for the artificial `。`, recomputes length, and tags review_note
when the merged sentence exceeds 40 non-punct chars.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OPUS_DIR = ROOT / "backend" / "data" / "segmentation-v2"

PUNCT = set("，。！？；：、「」『』（）【】《》〈〉—…·~—─")


def count_non_punct(text: str) -> int:
    return sum(1 for c in text if c not in PUNCT)


def find_pairs(paragraph_sents):
    pairs = []
    for i, s in enumerate(paragraph_sents[:-1]):
        t1 = s["text"]
        opens1 = t1.count("「") + t1.count("『")
        closes1 = t1.count("」") + t1.count("』")
        if opens1 > closes1:
            t2 = paragraph_sents[i + 1]["text"]
            opens2 = t2.count("「") + t2.count("『")
            closes2 = t2.count("」") + t2.count("』")
            if opens2 < closes2 and (opens1 - closes1) == (closes2 - opens2):
                pairs.append(i)
    return pairs


def merge_sentence(s1, s2):
    t1 = s1["text"].rstrip()
    t2 = s2["text"].lstrip()
    if t1.endswith("。"):
        t1 = t1[:-1] + "，"
    elif t1.endswith("？") or t1.endswith("！"):
        pass  # preserve question/exclamation inside quote
    merged_text = t1 + t2
    n = count_non_punct(merged_text)
    reasoning = f"[{n}字] 合併原先被誤拆的引號內句子（Rule A 修正）。"
    if n > 40:
        reasoning += f" ⚠️ 超過 40 字硬上限（{n}字），但引號語意不可拆，保留為單句。"
    merged = {
        "idx": s1["idx"],
        "text": merged_text,
        "length": n,
        "reasoning": reasoning,
    }
    if n > 40:
        merged["review_note"] = f"over-40 ({n}): complete quote cannot split"
    return merged


def fix_file(path: Path) -> int:
    obj = json.loads(path.read_text())
    changed = 0
    for p in obj["paragraphs"]:
        while True:
            pairs = find_pairs(p["sentences"])
            if not pairs:
                break
            i = pairs[0]
            s1 = p["sentences"][i]
            s2 = p["sentences"][i + 1]
            merged = merge_sentence(s1, s2)
            # replace i with merged, drop i+1, renumber
            new_sents = p["sentences"][:i] + [merged] + p["sentences"][i + 2 :]
            for j, s in enumerate(new_sents):
                s["idx"] = j
            p["sentences"] = new_sents
            # recompute paragraph_length
            p["paragraph_length"] = sum(s["length"] for s in new_sents)
            changed += 1
    if changed:
        path.write_text(json.dumps(obj, ensure_ascii=False, indent=2))
    return changed


def main():
    total = 0
    for f in sorted(OPUS_DIR.glob("L*.opus.v2.json")):
        n = fix_file(f)
        if n:
            print(f"{f.name}: fixed {n} pair(s)")
            total += n
    print(f"\nTotal: {total} bracket-split pair(s) merged.")


if __name__ == "__main__":
    main()
