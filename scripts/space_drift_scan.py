#!/usr/bin/env python3
"""#2864：找「原稿有空格、但 yml 把空格吃掉」的地方。

## 為什麼逐字門抓不到這一類

`verbatim_gate.py` 第 77 行比對前 `re.sub(r"\\s+", "", s)` —— 把空白全部拿掉。
那是**刻意且正確**的：DOCX 的 text run 會在任意位置切開，空白在兩邊本來就不可靠，
不拿掉會製造大量假警報。但代價是**這一類漂移它結構上看不到**。

所以另外走一條針對性的檢查，判準一樣是原稿。

## 誤報怎麼濾掉

抽取器自己組的字串（`年級5課次17` 這種）會湊巧命中 —— 它們不是原稿的逐字內容。
過濾法：把命中處的**上下文**（去空白後）拿回原稿找，找不到就不是逐字內容。

實測（2026-08-31，全庫 174 課）：
    「中文緊貼數字」出現            5068 處
    原稿有空格而 yml 沒有（原始）      6 處 / 4 課
    濾掉抽取器自組字串後（真漂移）     2 處 / 1 課（L0034，已修）

⛔ 不要憑「看起來比較整齊」統一成某一種寫法 —— 判準是原稿，不是美觀。
"""
from __future__ import annotations

import argparse
import glob
import importlib.util
import json
import pathlib
import re

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
SOT = REPO / "private" / "curriculum-source" / "_SOT"
LESSONS = REPO / "backend" / "data" / "lessons"

_spec = importlib.util.spec_from_file_location("dw", REPO / "scripts" / "docx_witnesses.py")
dw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dw)

TIGHT = re.compile(r"([一-鿿])(\d)")
#: 上下文取多長才夠判斷「這是不是原稿的逐字內容」
CONTEXT = 8


def _strings(o, out: list) -> list:
    if isinstance(o, str):
        out.append(o)
    elif isinstance(o, dict):
        for v in o.values():
            _strings(v, out)
    elif isinstance(o, list):
        for v in o:
            _strings(v, out)
    return out


def _nospace(s: str) -> str:
    return re.sub(r"\s+", "", s)


def scan_lesson(uid: str) -> list[dict]:
    lp = LESSONS / uid / "v3" / "lesson.yml"
    if not lp.is_file():
        return []
    meta = yaml.safe_load(lp.read_text(encoding="utf-8")) or {}
    meta = meta.get("lesson", meta)
    docx = SOT / (meta.get("source") or {}).get("drive_path", "")
    if not docx.is_file():
        return []
    doc = "".join(dw.docx_paragraphs(str(docx)))
    doc_ns = _nospace(doc)
    hits = []
    for f in sorted((LESSONS / uid / "v3").glob("*.yml")):
        for st in _strings(yaml.safe_load(f.read_text(encoding="utf-8")) or {}, []):
            for m in TIGHT.finditer(st):
                spaced = f"{m.group(1)} {m.group(2)}"
                if spaced not in doc or m.group(0) in doc:
                    continue
                # 誤報濾網：這段文字本身要是原稿的逐字內容
                ctx = st[max(0, m.start() - CONTEXT):m.end() + CONTEXT]
                if _nospace(ctx) not in doc_ns:
                    continue
                hits.append({"uid": uid, "file": f.name, "expected": spaced, "context": ctx})
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--json")
    a = ap.parse_args()
    uids = [a.uid] if a.uid else sorted(
        {pathlib.Path(p).parts[-3] for p in glob.glob(str(LESSONS / "L*/v3/_manifest.yml"))})
    if not SOT.is_dir():
        print("原稿不在（private/，CI 跑不到 —— 那是刻意的）")
        print("SPACE_DRIFT=SKIPPED")
        return 0
    all_hits = [h for u in uids for h in scan_lesson(u)]
    for h in all_hits:
        print(f"  {h['uid']}  {h['file']:<28} 原稿是 {h['expected']!r}   …{h['context']}…")
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps(all_hits, ensure_ascii=False, indent=2),
                                        encoding="utf-8")
    print(f"\n量了 {len(uids)} 課 · 原稿有空格而 yml 吃掉的：{len(all_hits)} 處")
    print(f"SPACE_DRIFT={'PASS' if not all_hits else 'FAIL'}")
    return 1 if all_hits else 0


if __name__ == "__main__":
    raise SystemExit(main())
