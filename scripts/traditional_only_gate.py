#!/usr/bin/env python3
"""簡體字門：抽取結果只准出現正體字

為什麼需要這支
--------------
教材全是正體字，但**轉出來的 PDF 不是**。本機缺那幾套圓體／手寫體，
LibreOffice 會代換成簡體字型，於是 PDF 印出「读全文-做记号」「语词我最棒」
「文章重点表」「阅读聚光灯」，連教師答案都變簡體（体育／虽然／数据／沮丧）。

只看 PDF 抽的人會把整批標題與部分內文抄成簡體，而且**看起來完全正常** ——
2026-08-17 兩個 worker 各自撞到，其中一個差點把它當成教材缺陷寫進 errata。

逐字門其實擋得住大部分（它比對 `document.xml`，那份是乾淨的），但它只檢查
4 字以上含中文的片段；短字串、標題、系統合成的欄位會從縫隙溜過去。
這支補那個縫：**整份掃過去，一個簡體字都不准有。**

判準用「簡體專用字」清單，不做正簡轉換 —— 轉換需要外部字典，而且會對
「兩邊都合法」的字（如「后」在正體也存在）誤判。這裡只認**正體不會用到的字**。

用法：
    python3 scripts/traditional_only_gate.py --all
    python3 scripts/traditional_only_gate.py --uid L0019
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
EXTRACTED = REPO / "backend/data/lessons/_extracted"

# ── 合法字集：從 175 份原稿實際用字推導，不由人判斷 ──────────────────
#
# 為什麼不用手維護的「簡體字清單」：我試了三輪，每一輪都混進正體字
# （只／起／里／干／累），每一輪都讓一整批正確的課被判 FAIL。
# 判準錯的門比沒有門更糟 —— 它會叫人去改沒有壞的東西。
#
# 改成經驗定義：**教材全庫用過的字就是合法的**。175 份學習單都是正體中文，
# 所以它們的用字聯集就是這個專案的合法字集；抽取結果出現字集外的漢字，
# 要嘛是照 PDF 抄到被字型換掉的字形，要嘛是憑空生出來的字。兩種都該擋。
#
# 這個定義自我修正：教材加新字，字集自動跟著長，不需要有人去改清單。
CORPUS_CACHE = REPO / "backend/data/curriculum_qa/sot_charset.txt"
SOT = REPO / "private/curriculum-source/_SOT"
WT_RE = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.S)


def corpus_charset(rebuild: bool = False) -> set[str]:
    """全庫用過的漢字。建一次存檔，之後直接讀（掃 175 個 docx 要幾秒）。"""
    if CORPUS_CACHE.is_file() and not rebuild:
        return set(CORPUS_CACHE.read_text(encoding="utf-8"))

    chars: set[str] = set()
    docs = sorted(SOT.rglob("*.docx"))
    docs = [d for d in docs if not d.name.startswith("~$")]
    if not docs:
        raise SystemExit("⛔ 找不到任何原稿 docx，無法建字集 —— 不要用空字集當判準")
    for d in docs:
        with zipfile.ZipFile(d) as z:
            for part in z.namelist():
                if not (part.startswith("word/") and part.endswith(".xml")):
                    continue
                text = "".join(WT_RE.findall(z.read(part).decode("utf-8", "ignore")))
                chars |= {c for c in text if "\u4e00" <= c <= "\u9fff"}
    CORPUS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    CORPUS_CACHE.write_text("".join(sorted(chars)), encoding="utf-8")
    print(f"（字集已建：{len(docs)} 份原稿，{len(chars)} 個漢字）")
    return chars


# 抽取者自己寫的註記，不是教材內容。這些欄位裡出現「贅字」「錨點」「不臆測」
# 很正常 —— 那些是正體字，只是學習單沒用過。把它們算進來會讓門對著自己的
# 工作紀錄叫，而真正要抓的（照 PDF 抄到被字型換掉的字形）藏在教材文字裡。
NOTE_KEYS = {
    "note", "kind", "confidence", "answer_carrier", "locator", "section",
    "extracted_by", "source_of_truth", "reason", "comment", "caveat",
}
NOTE_SUFFIXES = ("_note", "_notes", "_reason", "_caveat", "_rationale")


def _is_note_key(k: str) -> bool:
    return k in NOTE_KEYS or any(k.endswith(sfx) for sfx in NOTE_SUFFIXES)


def scan(path: Path, allowed: set[str]) -> list[tuple[str, str]]:
    """回 [(字集外的字, 上下文)]。只看教材內容，跳過抽取者的註記。"""
    hits: list[tuple[str, str]] = []
    text_nodes: list[str] = []

    def walk(n):
        if isinstance(n, str):
            text_nodes.append(n)
        elif isinstance(n, dict):
            # 標了 text_carrier: image 的內容畫在圖上，文字層本來就沒有 ——
            # 拿全庫字集去驗它必然誤判（逐字門也是列為「無法驗證」而非對不上）。
            # L0020 有一題的四個選項整個是圖，「遲鈍」正是這樣被誤報的。
            if n.get("text_carrier") == "image":
                return
            for k, v in n.items():
                if isinstance(k, str):
                    if _is_note_key(k):
                        continue          # 註記整支跳過，含它底下的內容
                    text_nodes.append(k)
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(yaml.safe_load(path.read_text(encoding="utf-8")))
    seen: set[str] = set()
    for s_ in text_nodes:
        for i, ch in enumerate(s_):
            if "\u4e00" <= ch <= "\u9fff" and ch not in allowed and ch not in seen:
                seen.add(ch)
                hits.append((ch, s_[max(0, i - 8): i + 9]))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--rebuild", action="store_true", help="重掃原稿重建字集")
    a = ap.parse_args()

    files = ([EXTRACTED / f"{a.uid}.yml"] if a.uid
             else sorted(EXTRACTED.glob("*.yml")))
    files = [f for f in files if f.is_file()]
    if not files:
        print("⛔ 沒有任何抽取結果 —— 視為失敗，別讓空跑看起來像成功")
        return 1

    allowed = corpus_charset(rebuild=a.rebuild)

    bad = 0
    for f in files:
        hits = scan(f, allowed)
        if hits:
            bad += 1
            print(f"  🔴 {f.stem}: {len(hits)} 個字集外的字")
            for ch, ctx in hits[:5]:
                print(f"       「{ch}」in …{ctx}…")
        else:
            print(f"  ✓ {f.stem}")

    print(f"\nTRADITIONAL_ONLY_GATE={'PASS' if not bad else 'FAIL'}  "
          f"（{len(files) - bad}/{len(files)}）")
    if bad:
        print("→ 這些字全庫 175 份原稿都沒用過。多半是照 PDF 抄到被字型換掉的字形；")
        print("   文字一律以 document.xml 為準，PDF 只提供 ☑／圈／版面。")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
