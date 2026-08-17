#!/usr/bin/env python3
"""把多模態抽取的整份 YAML 拆成「一個大題一份」的模組檔

為什麼要拆
----------
學習單本身就是一題一模組。舊結構把三個大題（語詞我最棒／閱讀理解／知識補給站）
擠進 `sections.yml`，而語詞應用、詞語複習連檔案都沒有 —— 抽取器抽不到那兩節，
不只是規則寫錯，是**連放的地方都沒有**。

不用數字前綴命名：文言文的大題集合完全不同（文白句子比對／文白詞語比對／自我挑戰），
序號對不上。大題序號寫在檔案裡的 `section_no`。

用法：
    python3 scripts/split_lesson_modules.py \
        --src qa/content-evidence/2026-08-17-ab-L0002/new.yml \
        --out backend/data/lessons/L0002/v3
    python3 scripts/split_lesson_modules.py --all --version v3
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent

# 每個模組 → (檔名, 教材上的大題序號)。序號 None = 不是大題（身分/課級屬性）。
# 來源 key → (模組名, 教材上的大題序號)。模組名同時是檔名與檔案內層的 key ——
# 兩者不一致等於又造一個「檔名說一件事、內容說另一件事」的坑（#2641 同型）。
# 序號 None = 不是大題（身分／課級屬性）。
MODULES: dict[str, tuple[str, str | None]] = {
    "lesson":            ("lesson", None),
    "metadata":          ("metadata", None),
    "source_errata":     ("errata", None),
    # ⚠️ 不叫 body：那是 HTML 詞彙，說不出它在學習單上是哪一大題。
    # 對齊既有前端元件 FullTextAnnotate.tsx。
    "body":              ("full_text_annotate", "一"),
    "key_reading":       ("key_reading", "二"),
    "vocab_definitions": ("vocab_definitions", "三"),
    "vocab_application": ("vocab_application", "四"),
    "keypoints":         ("keypoints", "五"),
    "spotlight":         ("spotlight", "六"),
    "comprehension":     ("comprehension", "七"),
    "vocab_review":      ("vocab_review", "八"),
    "resources":         ("resources", "九"),
    # 文言文專屬（大題集合與白話課不同）
    "intro_guide":       ("intro_guide", None),
    "modern_translation": ("modern_translation", None),
    "classical_text":    ("classical_text", None),
    "sentence_matching": ("sentence_matching", "一"),
    "word_matching":     ("word_matching", "二"),
    "self_challenge":    ("self_challenge", "六"),
}

# meta 底下的欄位怎麼分到 lesson.yml / metadata.yml
LESSON_FIELDS = {"lesson_uid", "catalog_slot", "title"}


def _derive(data: dict) -> None:
    """補上「抽取時記了做法、但消費端要成品」的欄位。

    多模態抽取忠實記下教材寫的東西（念順順說「從第四段開始讀」），但 API 要的是
    **那段文字本身**。這裡從已抽到的內容推導，而不是回頭叫抽取器重抄一次 ——
    重抄會多一次出錯機會，而且逐字門已經驗過段落是對的。
    """
    body = data.get("body") or {}
    paras = [
        (p.get("text") if isinstance(p, dict) else p)
        for p in (body.get("paragraphs") or [])
    ]

    if paras and not body.get("char_count"):
        body["char_count"] = sum(len(p or "") for p in paras)

    kr = data.get("key_reading")
    if isinstance(kr, dict) and not kr.get("passage"):
        spans = kr.get("spans_paragraphs") or (
            [kr["start_paragraph"]] if kr.get("start_paragraph") else []
        )
        # 段號是 1-based（教材印的段號），paras 是 0-based
        picked = [paras[i - 1] for i in spans if isinstance(i, int) and 1 <= i <= len(paras)]
        if picked:
            kr["passage"] = "".join(picked)
            kr["start_text"] = picked[0][:24]
            kr["extent_chars"] = len(kr["passage"])
            kr["source"] = "derived-from-body"


def split(src: Path, out: Path, version: str, dry: bool) -> list[str]:
    data = yaml.safe_load(src.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"⛔ {src} 不是 mapping")

    meta = data.get("meta") or {}
    uid = meta.get("lesson_uid")
    if not uid:
        raise SystemExit(f"⛔ {src} 缺 meta.lesson_uid —— 沒有身分就不知道要放哪")

    # 教材上實際有哪些大題，是這一課的結構事實，值得單獨留一份
    written: list[str] = []
    payloads: dict[str, dict] = {}

    payloads["lesson.yml"] = {
        "lesson_uid": uid,
        "version_id": version,
        **{k: meta[k] for k in ("title", "catalog_slot") if k in meta},
        "sections_present": data.get("sections_present") or [],
        "source": {"extracted_by": "extract-lesson-multimodal",
                   "pdf_pages": meta.get("pdf_pages")},
    }
    payloads["metadata.yml"] = {
        "lesson_uid": uid,
        "version_id": version,
        **{k: v for k, v in meta.items() if k not in LESSON_FIELDS | {"pdf_pages"}},
    }

    _derive(data)

    for key, (mod, no) in MODULES.items():
        if key in ("lesson", "metadata"):
            continue
        if key not in data or data[key] in (None, [], {}):
            continue
        payload: dict = {"lesson_uid": uid, "version_id": version}
        if no:
            payload["section_no"] = no
        # 內層 key == 模組名 == 檔名（去掉 .yml）
        payload[mod] = data[key]
        payloads[f"{mod}.yml"] = payload

    for fname, payload in payloads.items():
        written.append(fname)
        if dry:
            continue
        out.mkdir(parents=True, exist_ok=True)
        (out / fname).write_text(
            yaml.dump(payload, allow_unicode=True, sort_keys=False, width=10_000),
            encoding="utf-8",
        )
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--all", action="store_true",
                    help="掃 qa/content-evidence 下所有 new.yml / truth.yml")
    ap.add_argument("--version", default="v3")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    jobs: list[tuple[Path, Path]] = []
    if a.all:
        for p in sorted((REPO / "qa/content-evidence").rglob("*.yml")):
            if p.name not in ("new.yml", "truth.yml"):
                continue
            data = yaml.safe_load(p.read_text(encoding="utf-8"))
            uid = ((data or {}).get("meta") or {}).get("lesson_uid")
            if uid:
                jobs.append((p, REPO / "backend/data/lessons" / uid / a.version))
    elif a.src and a.out:
        jobs.append((a.src, a.out))
    else:
        raise SystemExit("⛔ 需要 --src + --out，或 --all")

    if not jobs:
        print("⛔ 沒有任何來源 —— 視為失敗（別讓空跑看起來像成功）")
        return 1

    for src, out in jobs:
        files = split(src, out, a.version, a.dry_run)
        tag = "（dry-run）" if a.dry_run else ""
        print(f"{out.parent.name} → {len(files)} 個模組{tag}: {' '.join(sorted(files))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
