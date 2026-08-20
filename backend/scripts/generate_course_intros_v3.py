#!/usr/bin/env python3
"""替 v3 課文生「課文簡介」，寫進 `metadata.yml` 的 `intro`。

為什麼要這支
------------
2026-08-19：`/learn/{id}/lesson-intro` 對**全部 175 課**顯示
「這篇課文目前沒有簡介資料。」

Young：之前不是有給過嗎？

有過。`scripts/_archive/generate_course_intros.py`（#1598）用 Gemini 從課文生，
寫進一修產物 `_parsed_2026-05-01/*.yml` 的 `lesson_intro.course_intro`。
那個目錄在二修重抽時整個刪掉，簡介跟著沒了 —— 而抽取本身不產簡介
（學習單上沒有這段文字，它從來就是我們生的）。

⚠️ 總表沒有簡介欄位（查過 `1.總表` 全部 23 欄）。所以來源只能是課文本身。

這支跟舊版的差別
----------------
- 讀 v3 uid tree 的 `lesson.yml`，不是已刪除的 `_parsed_2026-05-01`
- 寫 `metadata.yml` 的 `intro`（服務層 `_meta(l)["intro"]` 讀的就是它）
- prompt 沿用 #1598 那版（Young 5/8 走查後定的），不重寫

用法：
    python3 scripts/generate_course_intros_v3.py --dry-run --limit 3
    python3 scripts/generate_course_intros_v3.py --confirm
    python3 scripts/generate_course_intros_v3.py --confirm --force   # 覆寫既有
"""
from __future__ import annotations

import argparse
import pathlib
import sys
import time

import yaml

BACKEND = pathlib.Path(__file__).resolve().parent.parent
LESSONS = BACKEND / "data" / "lessons"

# #1598 的 prompt，Young 2026-05-08 走查後定的。不要順手重寫 ——
# 「不要暴雷」「不要寫成閱讀策略說明」這兩條都是那次走查的結論。
SYSTEM_PROMPT = """你是國小高年級到國中國語文教材的編輯。
要為一篇課文寫「課文簡介」，給學生在開始閱讀前快速理解這篇文章在講什麼。

要求：
1. 150–250 個中文字（必須），不要超過 250 字
2. 中性、客觀，告訴讀者「這篇文章主題是什麼、討論哪些重點」
3. 不要暴雷：不要直接告訴讀者文章的結論、答案、主角結局
4. 不要寫成「閱讀策略說明」（例：不要寫「這一課用 XX 策略」）
5. 不要寫成「學習目標」（例：不要寫「你會學到 XX」）
6. 純文字，不要 markdown 標記、不要分段標題
7. 用親切但不過度的口吻，國小高年級到國中閱讀程度

只回覆「課文簡介」本身，不要任何前後綴。"""


def story_text(uid: str) -> tuple[str, str]:
    """(課名, 課文全文)。沒有課文就回空字串 —— 不能憑課名生。

    ⚠️ 課文**不在** `lesson.yml`。那個檔只有課名、`catalog_slot` 與
    `sections_present`（目錄），沒有正文。第一版讀它，175 課全部回報
    「沒有課文」—— 一個那麼整齊的 0 就是找錯地方的信號，不是資料真的沒有。

    正文在 `full_text_annotate.yml` 的 `paragraphs`（讀全文-做記號那一步用的就是它）。
    """
    v3 = LESSONS / uid / "v3"
    title = ""
    for f in ("lesson.yml", "metadata.yml"):
        if (v3 / f).exists():
            d = yaml.safe_load((v3 / f).read_text(encoding="utf-8")) or {}
            title = str((d.get(f.split(".")[0]) or d).get("title") or d.get("title") or "").strip()
            if title:
                break

    # 一般課的正文在 `full_text_annotate.yml`；文言文那 10 課沒有那個檔，
    # 正文在 `classical_text.yml`（原文）。只找第一個的話那批課會全部回報
    # 「沒有課文」，而它們其實有。
    src_file = next(
        (v3 / name for name in ("full_text_annotate.yml", "classical_text.yml")
         if (v3 / name).exists()),
        None,
    )
    if src_file is None:
        return title, ""
    doc = yaml.safe_load(src_file.read_text(encoding="utf-8")) or {}
    sec = doc.get(src_file.stem) or doc
    paras = sec.get("paragraphs") or sec.get("lines") or sec.get("sentences") or []
    parts = []
    for para in paras:
        if isinstance(para, dict):
            t = para.get("text") or para.get("content") or ""
        else:
            t = para
        t = str(t).strip()
        if t:
            parts.append(t)
    return title, "\n".join(parts).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--confirm", action="store_true")
    ap.add_argument("--force", action="store_true", help="覆寫已有的簡介")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", help="只做這一課（lesson_uid）")
    args = ap.parse_args()
    if not (args.dry_run or args.confirm):
        raise SystemExit("要 --dry-run 或 --confirm 其中一個")

    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(vertexai=True, project="lingoleap-dev", location="us-central1")

    made = skipped = failed = notext = 0
    for d in sorted(LESSONS.iterdir()):
        uid = d.name
        if not (d.is_dir() and uid.startswith("L")):
            continue
        if args.only and uid != args.only:
            continue
        meta_f = d / "v3" / "metadata.yml"
        if not meta_f.exists():
            continue
        meta = yaml.safe_load(meta_f.read_text(encoding="utf-8")) or {}
        if meta.get("intro") and not args.force:
            skipped += 1
            continue

        title, text = story_text(uid)
        if not text:
            # 沒有課文就不生 —— 憑課名編一段出來，是把猜測寫進教材
            print(f"  {uid} 沒有課文，跳過（不能憑課名生）")
            notext += 1
            continue

        try:
            r = client.models.generate_content(
                model="gemini-2.5-flash-lite",
                contents=f"課文標題：{title}\n\n課文全文：\n{text[:8000]}\n\n"
                         "請依照規則撰寫這篇課文的「課文簡介」。",
                config=genai_types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.4,
                    max_output_tokens=600,
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                ),
            )
            intro = (r.text or "").strip()
        except Exception as exc:                                  # noqa: BLE001
            print(f"  {uid} 生成失敗：{type(exc).__name__} {str(exc)[:80]}")
            failed += 1
            continue

        if not (100 <= len(intro) <= 400):
            # 長度離譜通常代表模型回了別的東西（拒答、加了前綴）。
            # 寧可留空也不要把奇怪的東西當教材寫進去。
            print(f"  {uid} 長度 {len(intro)} 不合理，不寫入：{intro[:40]!r}")
            failed += 1
            continue

        made += 1
        print(f"  {uid} {title[:16]:18s} {len(intro)} 字  {intro[:34]}…")
        if args.confirm:
            meta["intro"] = intro
            meta_f.write_text(
                yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=200),
                encoding="utf-8",
            )
        if args.limit and made >= args.limit:
            break
        time.sleep(0.15)

    print(f"\n  生成 {made}，已有跳過 {skipped}，沒課文 {notext}，失敗 {failed}"
          + ("　※ dry-run" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
