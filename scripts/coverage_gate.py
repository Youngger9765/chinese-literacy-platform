#!/usr/bin/env python3
"""覆蓋率門：翻新有沒有把課文漏掉

跟逐字門的分工
--------------
逐字門問「你寫下來的東西，原稿上有嗎」——擋潤稿、擋看錯字。
它**完全不管有沒有漏**：少抄一整段，逐字門照樣 PASS，因為剩下的每個字都是對的。

L0124 就是這樣過關的：課文第一段「前言：植物是植物，肉是肉…」整段沒抽到，
v2 有 8 段、v3 只有 7 段，而逐字門 PASS、模組拆分成功、前端也畫得出來 ——
沒有任何一道檢查在看這件事。

為什麼只看課文，不看整份學習單
------------------------------
「整份有沒有漏」這個問題我試了三種寫法，全部在量**相鄰關係**而不是內容：

1. 原稿覆蓋率 → L0124 報漏 4068 字，但同一把尺量 v2 也漏 3735 字
   （兩版都沒存的東西不是這次弄丟的）
2. 滑動窗口比 v2/v3 串接字串 → 四課各報「漏 78 字」，八個片段拿去搜，八個全在
   （= 2×窗口−2 的邊界假象）
3. 句子級比對 → 假警報變成「v2 把表格欄位串成一句」這類接法差異，
   而真正的那一段（前言，20 字）反而低於門檻被漏掉

共同病根：v2 是平的、v3 是巢狀的，同樣內容在兩邊的**相鄰關係本來就不同**，
任何以「字串接在一起長什麼樣」為基礎的比法都會把排版差異報成內容遺失。

所以收斂成一個**結構對結構**的比較：v2 的 `body.paragraphs` 對 v3 的
`full_text_annotate.paragraphs`。同一個欄位、同一個意思、不牽涉排版。
這個比法一次就給出乾淨答案：十課裡只有 L0124 短少，其餘 ±2 字（標點差異）。

其他大題的完整性是另一個問題，比課文難（沒有可直接對位的結構），
留在 PRD TODO，不在這道門裡用會叫錯的方式硬做。

用法：
    python3 scripts/coverage_gate.py --all
    python3 scripts/coverage_gate.py --uid L0124
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend/data/lessons"

SOT = REPO / "private/curriculum-source/_SOT"
WT_RE = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.S)
KEEP_RE = re.compile(r"[一-鿿0-9A-Za-z]")

# 用段落開頭這麼多字當錨點，而不是整段全等。
# 全等會被一個錯字（教材勘誤、v2 的 OCR 瑕疵）整段判成不見。
ANCHOR = 16


def paragraphs(uid: str, version: str) -> list[str]:
    """課文段落。v2 叫 body、v3 叫 full_text_annotate，文言文另有 classical_text。"""
    d = LESSONS / uid / version
    for name in ("full_text_annotate.yml", "body.yml", "classical_text.yml", "sections.yml"):
        p = d / name
        if not p.exists():
            continue
        doc = yaml.safe_load(p.read_text(encoding="utf-8"))

        def find(n):
            if isinstance(n, dict):
                if isinstance(n.get("paragraphs"), list):
                    return n["paragraphs"]
                for v in n.values():
                    r = find(v)
                    if r is not None:
                        return r
            elif isinstance(n, list):
                for v in n:
                    r = find(v)
                    if r is not None:
                        return r
            return None

        got = find(doc)
        if got:
            return [str((x.get("text") if isinstance(x, dict) else x) or "") for x in got]
    return []


def squeeze(s: str) -> str:
    return "".join(c for c in s if KEEP_RE.match(c))


def docx_text(uid: str) -> str:
    for v in ("v3", "v2"):
        f = LESSONS / uid / v / "lesson.yml"
        if not f.exists():
            continue
        dp = ((yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("source") or {}).get("drive_path")
        if not dp:
            continue
        path = SOT / dp
        if not path.exists():
            # 檔名有全形/半形與標點差異（`新奇!` vs `新奇！`），用課號前綴找
            cands = list((SOT / Path(dp).parent).glob(f"{Path(dp).name[:6]}*.docx"))
            if len(cands) != 1:
                return ""
            path = cands[0]
        with zipfile.ZipFile(path) as z:
            return "".join(WT_RE.findall(z.read("word/document.xml").decode("utf-8", "ignore")))
    return ""


def lesson_text(uid: str, version: str) -> str:
    out: list[str] = []

    def walk(n):
        if isinstance(n, str):
            out.append(n)
        elif isinstance(n, dict):
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    for f in sorted((LESSONS / uid / version).glob("*.yml")):
        walk(yaml.safe_load(f.read_text(encoding="utf-8")))
    return "".join(out)


def check(uid: str) -> tuple[bool, list[str]]:
    """逐段比對，不比字數總和。

    ⚠️ 第一版比的是「v3 課文總字數 >= v2 總字數 - 容差」。mutation 當場打臉：
    從 L0072 刪掉一整段，**仍然 PASS** —— 因為 v3 本來就比 v2 長（多抽到內容），
    刪一段之後還在容差之上。總和會把「多抽到的」跟「漏掉的」互相抵銷，
    於是漏掉的那一段被自己的成果蓋住。逐段比對沒有這個抵銷。
    """
    v2, v3 = paragraphs(uid, "v2"), paragraphs(uid, "v3")
    if not v3:
        return False, [f"{uid}: v3 沒有課文段落 —— 整節不見了"]
    if not v2:
        return True, [f"{uid}: 沒有 v2 可比（新課），略過"]

    src = squeeze(docx_text(uid))
    if not src:
        return False, [f"{uid}: 讀不到原稿 —— 無法判斷是漏抄還是 v2 自己多寫的"]

    # ⚠️ 比對範圍是**整課的 v3**，不是只有段落清單。
    #    v3 會把內容搬到更合適的模組（文言文的導讀 → intro_guide.yml、
    #    圖說 → figure block），那是翻新的目的，不是遺失。只看段落清單的話，
    #    L0161 會報「弄丟 7 段」——實際上 7 段全都在 intro_guide.yml 裡。
    body3 = squeeze(lesson_text(uid, "v3"))
    lost = []
    for para in v2:
        anchor = squeeze(para)[:ANCHOR]
        if len(anchor) < ANCHOR:
            continue          # 太短的段落（標題行之類）不當課文看
        if anchor in src and anchor not in body3:
            lost.append(para)

    if not lost:
        return True, []
    c2, c3 = sum(map(len, v2)), sum(map(len, v3))
    # ⚠️ 這裡列的是**候選**，不是判決。基準 v2 的 body 對某些課是被污染的：
    #    舊管線會把整個聚光燈節攤進 body，所以「v2 有 28 段」可能是
    #    20 段策略說明／guide／選項／（段N）節錄 ＋ 8 段真課文（L0067 就是這樣）。
    #    照著把 28 段「補齊」＝ 把題目當課文塞進去。
    #
    #    而且錨點只取前 16 字，段首多印一個「（段1）」就對不上 —— 那是標記差異
    #    不是漏抄。查真相要用**整段全等**逐條回比，不要看這裡的段數差就下結論。
    detail = [f"{uid}: 課文 {len(v2)} → {len(v3)} 段（{c2} → {c3} 字），"
              f"{len(lost)} 段在原稿與 v2 裡有、v3 找不到（**候選，需逐條查證**）"]
    detail += [f"      {p[:52]}" for p in lost[:5]]
    detail += ["      ⚠️ v2 的 body 可能混入攤平的聚光燈內容；先確認這幾條是不是課文，"
               "再確認是不是只差段首標記（如「（段1）」）"]
    return False, detail


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()

    uids = [a.uid] if a.uid else sorted(p.name for p in LESSONS.iterdir()
                                        if p.is_dir() and (p / "v3").is_dir())
    if not uids:
        print("⛔ 沒有任何 v3 課可檢查 —— 視為失敗，別讓空跑看起來像成功")
        return 1

    bad = 0
    for uid in uids:
        ok, msgs = check(uid)
        if ok:
            print(f"  ✓ {uid}" + (f"  {msgs[0]}" if msgs else ""))
        else:
            bad += 1
            for m in msgs:
                print(f"  🔴 {m}")

    print(f"\nCOVERAGE_GATE={'PASS' if not bad else 'FAIL'}  （{len(uids) - bad}/{len(uids)}）")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
