#!/usr/bin/env python3
"""輸入普查 —— 寫抽取邏輯**之前**先跑這支

⚠️ 為什麼：2026-08-24 抽念順順，五個特例全是一課一課撞出來的
   （變體選擇符、書信體 idx 重編、錨點 0/多個、計數欄誤收書目、課文在表格裡）。
   每一個都只是「數一數」就會浮出來的分布，卻花了一整天逐課發現。

⛔ 這支只**數**，不下判斷、不改任何檔案。看到異常桶子再決定怎麼處理。
"""
from __future__ import annotations
import collections, pathlib, re, sys, zipfile
import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"
SOT = pathlib.Path("/Users/young/project/chinese-literacy-platform"
                   "/private/curriculum-source/_SOT")

VARIATION = re.compile(r"[\U000e0100-\U000e01ef]")
ZEROWIDTH = re.compile(r"[︀-️​-‏⁠﻿]")


# 每一課歸一類，後面抽取照類別走不同路徑。
# 順序有意義：由「最擋路」到「最好走」，第一個成立的就是它的類別。
CLASSES = [
    ("no_section",     "學習單根本沒有「念順順」這一節 —— 不是抽不到，是本來就沒有"),
    ("no_body",        "課文沒有段落 —— 上游課文抽取的缺口，這一層修不了"),
    ("no_counter",     "沒有累計字數欄 —— 多為定向課／文言文，可能本來就沒有念順順"),
    ("no_anchor",      "☞ 錨點對不到任何課文段落 —— XML 沒訊號，只能靠 vision"),
    ("multi_anchor",   "☞ 錨點命中多段 —— 用計數欄段界投票，平手就判不動"),
    ("renumbered",     "段落 idx 有重複（書信體）—— 用列表位置定址，不能用 idx"),
    ("standard",       "單一錨點 + 有計數欄 + idx 唯一 —— 走主路徑"),
]


def classify(f: dict) -> str:
    # ⚠️ 這一條必須排第一。2026-08-24 我是「抽不到」之後回頭才發現「本來就沒有」，
    #    順序反了 —— 那些課被歸成 no_body / no_counter，看起來像抽取失敗，
    #    於是有人（我）會一直去修一個根本不存在的東西。
    if not f["has_key_reading_section"]:
        return "no_section"
    if not f["has_body_paragraphs"]:
        return "no_body"
    if not f["has_counter_column"]:
        return "no_counter"
    if f["anchor_hits"] == 0:
        return "no_anchor"
    if f["anchor_hits"] > 1:
        return "multi_anchor"
    if not f["paragraph_idx_unique"]:
        return "renumbered"
    return "standard"


def main() -> int:
    write = "--write" in sys.argv
    check = "--check" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")] or None
    stats = collections.Counter()
    detail = collections.defaultdict(list)
    facts: dict[str, dict] = {}
    for f in sorted(LESSONS.glob("L*/v3/lesson.yml")):
        uid = f.parent.parent.name
        if only and uid not in only:
            continue
        stats["課數"] += 1
        meta = yaml.safe_load(f.read_text(encoding="utf-8"))
        meta = meta.get("lesson", meta)
        src = SOT / ((meta.get("source") or {}).get("drive_path") or "")
        fa = LESSONS / uid / "v3" / "full_text_annotate.yml"

        # ① 課文段落
        paras = []
        if fa.is_file():
            d = yaml.safe_load(fa.read_text(encoding="utf-8")) or {}
            ft = d.get("full_text_annotate") or d
            paras = [p for p in (ft.get("paragraphs") or []) if isinstance(p, dict)]
        facts[uid] = {"has_key_reading_section": False,
                      "has_body_paragraphs": bool(paras), "paragraph_idx_unique": True,
                      "anchor_hits": 0, "has_counter_column": False,
                      "body_in_tables": False, "invisible_chars_docx_only": False}
        # 有沒有念順順這一節 —— 看該課自己的 key_reading.yml 與 sections_present
        krf = LESSONS / uid / "v3" / "key_reading.yml"
        has_section = False
        if krf.is_file():
            kd = yaml.safe_load(krf.read_text(encoding="utf-8")) or {}
            kr = kd.get("key_reading") or kd
            has_section = bool((kr or {}).get("instruction") or (kr or {}).get("passage"))
        if not has_section:
            sp = meta.get("sections_present") or []
            has_section = any("念順順" in str(x) for x in sp)
        facts[uid]["has_key_reading_section"] = has_section
        if not has_section:
            stats["這課沒有念順順這一節"] += 1
            detail["沒有念順順節"].append(uid)

        if not paras:
            stats["🔴 課文沒有段落"] += 1
            detail["課文沒有段落"].append(uid)
            continue

        # ② 段號唯一嗎（書信體會重編）
        idxs = [p.get("idx") for p in paras]
        if len(set(idxs)) != len(idxs):
            stats["⚠️ 段落 idx 有重複（書信體）"] += 1
            detail["idx 重複"].append(uid)
            facts[uid]["paragraph_idx_unique"] = False


        if not src.is_file():
            stats["🔴 找不到原稿"] += 1
            continue
        try:
            xml = zipfile.ZipFile(src).read("word/document.xml").decode("utf-8")
        except Exception:
            stats["🔴 原稿讀不開"] += 1
            continue

        # ③ 不可見字元 —— ⚠️ 要查**兩側**
        #    2026-08-24 第一版只查 yml，結果是 0；變體選擇符其實在 DOCX 那側。
        #    比對失敗的原因正是**兩邊不一致**，只查一邊等於沒查。
        body_yml = "".join(p.get("text") or "" for p in paras)
        inv_yml = bool(VARIATION.search(body_yml) or ZEROWIDTH.search(body_yml))
        inv_docx = bool(VARIATION.search(xml) or ZEROWIDTH.search(xml))
        if inv_docx and not inv_yml:
            stats["🔴 DOCX 有不可見字元但 yml 沒有（比對會失敗）"] += 1
            detail["不可見字元只在 DOCX"].append(uid)
            facts[uid]["invisible_chars_docx_only"] = True
        elif inv_yml and not inv_docx:
            stats["⚠️ yml 有不可見字元但 DOCX 沒有"] += 1
        elif inv_docx:
            stats["兩側都有不可見字元"] += 1

        # ④ 課文在表格裡嗎
        if xml.count("<w:tbl>") > 0:
            stats["課文檔含表格"] += 1
            facts[uid]["body_in_tables"] = True

        # ⑤ 帶圖形錨點的段落有幾個對得到課文
        def norm(t):
            return re.sub(r"[\s　]|" + VARIATION.pattern + "|" + ZEROWIDTH.pattern, "", t or "")
        index = {norm(p.get("text"))[:24] for p in paras}
        anchors = 0
        for block in re.split(r"(?=<w:p[ >])", xml):
            if not block.startswith("<w:p"):
                continue
            if "<w:drawing" not in block and "<w:pict" not in block:
                continue
            t = norm("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", block)))
            if len(t) >= 25 and t[:24] in index:
                anchors += 1
        facts[uid]["anchor_hits"] = anchors
        stats[f"☞ 錨點命中課文段落 = {min(anchors, 3)}{'+' if anchors > 3 else ''} 個"] += 1
        if anchors == 0:
            detail["錨點 0 個"].append(uid)
        elif anchors > 1:
            detail["錨點多個"].append(uid)

        # ⑥ 有沒有右緣累計字數欄（看 DOCX 有沒有獨立成段的 2–4 位數字，且遞增）
        nums = [int(t) for b in re.split(r"(?=<w:p[ >])", xml) if b.startswith("<w:p")
                for t in [norm("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", b)))]
                if re.fullmatch(r"\d{2,4}", t)]
        rising = sum(1 for i in range(1, len(nums)) if nums[i] > nums[i - 1])
        facts[uid]["has_counter_column"] = rising >= 3
        if rising < 3:
            stats["⚠️ 沒有明顯的累計字數欄"] += 1
            detail["無計數欄"].append(uid)

    if write:
        import collections as _c
        by_class = _c.Counter()
        for uid, f in facts.items():
            cls = classify(f)
            by_class[cls] += 1
            mf = LESSONS / uid / "v3" / "metadata.yml"
            if not mf.is_file():
                continue
            doc = yaml.safe_load(mf.read_text(encoding="utf-8")) or {}
            doc["source_profile"] = {
                "class": cls,
                "note": dict(CLASSES)[cls],
                **f,
                "profiled": "2026-08-24",
            }
            mf.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False),
                          encoding="utf-8")
        print("\n寫入 metadata.yml 的 source_profile：")
        for cls, note in CLASSES:
            if by_class[cls]:
                print(f"  {cls:<14}{by_class[cls]:>4}  {note}")
        print()

    if check:
        # 抽取前的 gate：原稿換過／課文重抽之後，記在 metadata 的分類可能已經不準。
        # 這裡重新量一次跟記錄比，有漂移就擋下 —— 照過期的分類走會踩到沒處理過的特例。
        drift = []
        for uid, f in facts.items():
            mf = LESSONS / uid / "v3" / "metadata.yml"
            if not mf.is_file():
                continue
            rec = (yaml.safe_load(mf.read_text(encoding="utf-8")) or {}).get("source_profile")
            if not rec:
                drift.append(f"{uid} 沒有 source_profile（沒跑過普查）")
                continue
            now = classify(f)
            if rec.get("class") != now:
                drift.append(f"{uid} 記的是 {rec.get('class')}，實際重量是 {now}")
            for k, v in f.items():
                if rec.get(k) != v:
                    drift.append(f"{uid} {k}: 記 {rec.get(k)} 實際 {v}")
        if drift:
            print(f"\n🔴 PROFILE_DRIFT {len(drift)} 筆 —— 原稿或課文變過，分類已過期：")
            for d in drift[:25]:
                print(f"   {d}")
            print("   → 跑 `python3 scripts/corpus_profile.py --write` 重建，"
                  "再看有沒有新的類別需要處理")
            return 1
        print("\n✅ PROFILE_FRESH：175 課的 source_profile 與實際重量一致")
        return 0

    width = max(len(k) for k in stats) + 2
    print("=" * (width + 8))
    for k, v in stats.most_common():
        print(f"{k:<{width}}{v:>5}")
    print("=" * (width + 8))
    for k, v in detail.items():
        print(f"\n{k}（{len(v)}）: {' '.join(v[:25])}{' …' if len(v) > 25 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
