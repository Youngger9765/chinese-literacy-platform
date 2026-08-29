#!/usr/bin/env python3
"""把每一篇自己的念順順補進 multi_text_parts.yml

多文本課的每一篇有各自的「念順順」。原稿印得清清楚楚（篇次 N/M 之後各有一個
「請用計時器，從指定段落（X）」），但抽取只抽了第 1 篇 —— 第 2、3 篇留著指示句、
passage 是空的，掃 QR 進去沒有東西可念。

規則跟單篇課完全一樣（見 lesson-reading-pipeline skill）：
    start = 指示句印的段號（在**該篇**的段落裡數，不是整課）
    end   = 該篇的 running_char_counts 最後一個數字落在的那一段
    passage = 兩端之間整段包含

⚠️ 段號是「該篇的第幾段」——多文本課每篇的段號各自從 1 起算。
⛔ 不要拿整課的段落去數，會整個錯位。
"""
from __future__ import annotations
import argparse, pathlib, re, sys
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
LESSONS = ROOT / "backend" / "data" / "lessons"
ZH = "一二三四五六七八九十"


def norm(s: str) -> str:
    return re.sub(r"[\s　]", "", s or "")


def zh_int(t: str):
    if t.isdigit():
        return int(t)
    if len(t) == 1 and t in ZH:
        return ZH.index(t) + 1
    if len(t) == 2 and t[0] == "十":
        return 10 + ZH.index(t[1]) + 1
    if len(t) == 2 and t[1] == "十":
        return (ZH.index(t[0]) + 1) * 10
    return None


def fill(uid: str, apply: bool) -> None:
    f = LESSONS / uid / "v3" / "multi_text_parts.yml"
    if not f.is_file():
        print(f"·  {uid}  沒有 multi_text_parts.yml")
        return
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    parts = doc.get("multi_text_parts") or []
    changed = False
    for part in parts:
        kr = part.get("key_reading")
        if not isinstance(kr, dict):
            continue
        if norm(kr.get("passage")):
            print(f"·  {uid} 篇{part.get('part_no')}  已有 passage，跳過")
            continue
        body = part.get("body") or {}
        paras = [norm(x.get("text")) for x in (body.get("paragraphs") or [])
                 if norm(x.get("text"))]
        raw = [(x.get("text") or "").strip() for x in (body.get("paragraphs") or [])
               if norm(x.get("text"))]
        counts = body.get("running_char_counts") or []
        m = re.search(r"從指定段落[（(]\s*([一二三四五六七八九十\d]+)",
                      kr.get("instruction") or "")
        start = zh_int(m.group(1)) if m else None
        if start is None:
            print(f"—  {uid} 篇{part.get('part_no')}  指示句沒有段號")
            continue
        # 🔴 段號 → 段落：用 idx 定址，不要用列表位置。
        #    書信體那類課的 idx 會重編（[1..9, 1..10]），拿列表位置去數會整個錯位。
        #    這批側檔目前每篇都是 1..N 連續，但**不能靠運氣** —— 不唯一就拒絕，不猜。
        raw_objs = [x for x in (body.get("paragraphs") or []) if norm(x.get("text"))]
        hits = [i for i, x in enumerate(raw_objs) if x.get("idx") == start]
        if len(hits) > 1:
            print(f"—  {uid} 篇{part.get('part_no')}  idx={start} 命中 {len(hits)} 次，"
                  f"分不出是哪一段 → 判不動")
            continue
        if len(hits) == 1:
            start_pos = hits[0] + 1
        elif start <= len(paras):
            start_pos = start          # 沒有 idx 欄位時才退回列表位置
            print(f"   ⚠️ {uid} 篇{part.get('part_no')} 沒有 idx={start} 的段落，"
                  f"退回用列表第 {start} 個")
        else:
            print(f"—  {uid} 篇{part.get('part_no')}  指定第 {start} 段，該篇只有 {len(paras)} 段")
            continue
        if not counts:
            print(f"—  {uid} 篇{part.get('part_no')}  該篇沒有 running_char_counts")
            continue
        last = counts[-1]
        cum = 0
        end = start_pos
        for i in range(start_pos - 1, len(paras)):
            cum += len(paras[i])
            end = i + 1
            if cum >= last:
                break
        passage = "".join(raw[start_pos - 1:end])
        kr["passage"] = passage
        kr["start_paragraph"] = start
        kr["end_paragraph"] = end
        kr["extent_chars"] = len(norm(passage))
        kr["start_text"] = passage[:24]
        kr["source"] = "part-scoped-anchor-and-count"
        changed = True
        print(f"✅ {uid} 篇{part.get('part_no')}/{part.get('part_of')}  "
              f"第 {start}–{end} 段 = {len(norm(passage))} 字（計數欄末 {last}）")
        print(f"      …{norm(passage)[-24:]}")
    if apply and changed:
        f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False),
                     encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("uids", nargs="*")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    uids = a.uids or sorted(
        p.parent.parent.name for p in LESSONS.glob("L*/v3/multi_text_parts.yml"))
    for uid in uids:
        fill(uid, a.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
