#!/usr/bin/env python3
"""重抽對帳 —— 對一個模組**從原稿重新取一次**，跟現有 yml 逐欄比對（#2874）。

## 為什麼要有這支

22 支 `extract-*` skill 標著「尚未實跑」，而它們裡面的數字全是
「對現有語料的統計」—— 不是「我用它抽出來的結果」。差別很大：

  統計   告訴你「現有資料長什麼樣」
  實跑   告訴你「照這份 skill 做，會不會抽出一樣的東西」

2026-08-23 第一次真的用 `extract-vocab-definitions` 抽 L0011 就證明了差別：
11 題全中，但第 4 題掉了一個頓號（`pdftotext -layout` 在欄寬處折行，
折點正好在標點上）—— 那個錯誤**只有真的重抽一次才會出現**。

## 它做什麼、不做什麼

✅ 對**逐字型欄位**（課文、譯文、說明、提示語）從 DOCX 的 `<w:t>` 流重新取，
   跟現有 yml 的同一欄逐字比對。
⛔ 它**不是**完整的抽取器：判斷型的欄位（answer、kind、confidence、
   needs_review）不在範圍內 —— 那些要人看。

所以它回答的是一個較窄但可機器驗的問題：
**「現有 yml 的逐字欄位，跟原稿一字不差嗎？」**
不一致 = 要嘛抽的時候錯了、要嘛原稿後來變了，兩種都要人看。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import subprocess
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO / "scripts" / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sot() -> pathlib.Path:
    """`private/` 是 gitignored，worktree 裡沒有 —— 走回主 checkout 找。"""
    common = subprocess.run(["git", "rev-parse", "--git-common-dir"],
                            capture_output=True, text=True,
                            cwd=REPO).stdout.strip()
    base = pathlib.Path(common).resolve().parent if common else REPO
    return base / "private" / "curriculum-source" / "_SOT"


def check(uid: str, module: str) -> dict:
    vg = _load("verbatim_gate")
    dw = _load("docx_witnesses")
    f = LESSONS / uid / "v3" / f"{module}.yml"
    ly = LESSONS / uid / "v3" / "lesson.yml"
    if not f.is_file() or not ly.is_file():
        return {"uid": uid, "status": "skip", "why": "沒有這個模組"}
    rel = (yaml.safe_load(ly.read_text(encoding="utf-8")).get("source") or {}).get("drive_path")
    docx = _sot() / rel if rel else None
    if not docx or not docx.is_file():
        return {"uid": uid, "status": "skip", "why": "讀不到原稿"}

    src = vg.docx_text(docx)
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    unverifiable: list = []
    pairs = vg.walk(doc, unverifiable=unverifiable)

    mismatched = []
    checked = 0
    for key, val in pairs:
        segs = [s for s in (vg.LIST_MARKER_RE.sub("", vg.norm(p))
                            for p in vg.SPLIT_RE.split(val))
                if len(s) >= 4 and vg.has_cjk(s)]
        if not segs:
            continue
        checked += 1
        for seg in segs:
            if seg in src or vg.found_in_order(seg, src):
                continue
            mismatched.append({"field": key, "fragment": seg[:70]})
            break

    return {
        "uid": uid,
        "status": "ok" if not mismatched else "mismatch",
        "checked": checked,
        "unverifiable": len(unverifiable),
        "mismatched": mismatched[:5],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--module", required=True)
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 課（0 = 全部）")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    uids = sorted(p.parent.parent.name
                  for p in LESSONS.glob(f"L*/v3/{a.module}.yml"))
    if a.limit:
        uids = uids[: a.limit]
    if not uids:
        print(f"⛔ 沒有任何課有 {a.module}", file=sys.stderr)
        return 2

    results = [check(u, a.module) for u in uids]
    ok = [r for r in results if r["status"] == "ok"]
    bad = [r for r in results if r["status"] == "mismatch"]
    skip = [r for r in results if r["status"] == "skip"]
    total_checked = sum(r.get("checked", 0) for r in results)

    if a.json:
        print(json.dumps({"module": a.module, "ok": len(ok), "mismatch": len(bad),
                          "skip": len(skip), "checked": total_checked,
                          "details": bad[:10]}, ensure_ascii=False, indent=2))
    else:
        print(f"  {a.module}: {len(uids)} 課 · 逐字一致 {len(ok)} · 對不上 {len(bad)}"
              f" · 跳過 {len(skip)} · 受檢 {total_checked} 字串")
        for r in bad[:6]:
            m = r["mismatched"][0]
            print(f"    🔴 {r['uid']} [{m['field']}] {m['fragment']}")
    # ⛔ 「一個字串都沒檢查」不是通過
    if total_checked == 0:
        print(f"  ⛔ {a.module} 一個字串都沒被檢查 —— 那是沒驗到，不是通過",
              file=sys.stderr)
        return 2
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
