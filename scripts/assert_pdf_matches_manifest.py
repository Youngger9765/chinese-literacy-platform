#!/usr/bin/env python3
"""派工前確認「手上這份 PDF」就是「算頁碼時的那份」（#2857 B1）。

## 為什麼需要它

派工單的 `pages` 是對某一次 DOCX→PDF 轉檔的結果算的，那份 PDF 只活在暫存目錄裡。
飛機拿到的是**另一次獨立轉檔**的產物 —— 而那兩次不保證一樣：

    同一份 DOCX、同一台機器、清快取連轉三次
    L0016 → 8, 9, 9 頁
    L0013 → 11, 10, 11 頁

整份對比（172 課）：7 課的頁數不同，11 課共 33 個大題的頁碼不同。
L0016 從第 3 頁起每一節整體位移一頁 —— 語詞我最棒從 `[3]` 變成 `[4]`。

⛔ 最糟的不是它會錯，是**它不會喊**：派工單給的 span 含下一節的起始頁，
位移一頁通常仍有重疊，飛機會找到自己那一節的**一部分**然後回報成功。
靜默截斷，五條鎖沒有一條看得到。

所以這支把「靜默讀錯」換成「大聲擋下」。它不修不可重現本身
（根因未查明 —— 字型？LibreOffice 版本？），只確保不一致時不會派工。

## 用法

    python3 scripts/assert_pdf_matches_manifest.py --uid L0011 --pdf /tmp/x.pdf

exit 0 = 這份 PDF 的頁數跟派工單一致，可以派工
exit 1 = 不一致，⛔ 不要派工（重轉一次，或重跑 build_section_pages 更新派工單）
exit 2 = 材料不齊（沒有派工單／沒有 pdf_pages／讀不到 PDF）—— 也不要派工
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import re
import subprocess
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]


def pdf_page_count(pdf: pathlib.Path) -> int | None:
    """讀 PDF 頁數。優先 pdfinfo，沒有就退回自己數 /Type /Page。

    ⚠️ 回 None 代表「數不出來」，跟「數出來是 0」是兩件事 ——
    呼叫端必須把它當成材料不齊（exit 2），不可以當成不一致。
    """
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=60
        )
        if out.returncode == 0:
            m = re.search(r"^Pages:\s+(\d+)", out.stdout, re.M)
            if m:
                return int(m.group(1))
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    try:
        raw = pdf.read_bytes()
    except OSError:
        return None
    n = len(re.findall(rb"/Type\s*/Page[^s]", raw))
    return n or None


def _compare_prints(uid: str, pdf: pathlib.Path, manifest: dict) -> int | None:
    """比對每一頁的文字指紋。回 None = 這課沒存指紋（舊資料），跳過不擋。

    ⚠️ 「沒存指紋」與「指紋不符」必須分開。舊的 section-pages.yml 沒有這個欄位，
    把它當成不符會讓每一課都紅 —— 那道門紅久了就等於沒有。
    """
    db_path = REPO / "specs" / "modules" / "section-pages.yml"
    if not db_path.is_file():
        return None
    try:
        db = yaml.safe_load(db_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return None
    entry = (db.get("lessons") or {}).get(uid) or {}
    want = entry.get("page_prints")
    if not isinstance(want, list) or not want:
        return None   # 這課還沒存指紋

    try:
        spec = importlib.util.spec_from_file_location(
            "bsp", REPO / "scripts" / "build_section_pages.py")
        bsp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bsp)
        got = [bsp.page_print(t) for t in bsp.page_texts(pdf)]
    except Exception as exc:  # noqa: BLE001
        # 算不出來要說出來，⛔ 不可以當成「比對過了」
        print(f"⛔ 算不出這份 PDF 的頁面指紋（{exc}）—— 不派工", file=sys.stderr)
        return 2

    if len(got) != len(want):
        print(f"🔴 {uid} 手上這份 PDF 有 {len(got)} 頁，派工單記了 {len(want)} 頁的指紋。")
        print("   ⛔ 不要派工。")
        return 1

    diff = [i + 1 for i, (a, b) in enumerate(zip(got, want)) if a != b]
    if diff:
        print(f"🔴 {uid} 頁數相同（{len(got)} 頁）但**第 {diff} 頁的內容跟算頁碼時不一樣**。")
        print("   同一份 DOCX 轉兩次版面會變（實測 55/45），切節結果會跟著變。")
        print("   ⛔ 不要派工。重跑 scripts/build_section_pages.py 更新派工單。")
        return 1
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", required=True)
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--version", default=None, help="預設取最新的 v* 目錄")
    args = ap.parse_args()

    uid_dir = REPO / "backend" / "data" / "lessons" / args.uid
    if args.version:
        vdir = uid_dir / args.version
    else:
        vs = sorted((p for p in uid_dir.glob("v*") if p.is_dir()), key=lambda p: p.name)
        vdir = vs[-1] if vs else None
    if not vdir or not vdir.is_dir():
        print(f"⛔ 找不到 {args.uid} 的版本目錄")
        return 2

    mf = vdir / "_manifest.yml"
    if not mf.is_file():
        print(f"⛔ {args.uid} 沒有派工單（{mf}）—— 先跑 build_lesson_manifest.py")
        return 2

    manifest = yaml.safe_load(mf.read_text(encoding="utf-8")) or {}
    expected = manifest.get("pdf_pages")
    if not isinstance(expected, int) or expected <= 0:
        # 派工單沒記頁數 → 這課的頁碼無從交叉檢查。不可以當成「一致」放行，
        # 那正是「沒有門卻以為有門」的形狀。
        print(f"⛔ {args.uid} 的派工單沒有 pdf_pages，無法交叉檢查 —— 不派工")
        return 2

    pdf = pathlib.Path(args.pdf)
    if not pdf.is_file():
        print(f"⛔ 讀不到 PDF：{pdf}")
        return 2

    actual = pdf_page_count(pdf)
    if actual is None:
        print(f"⛔ 數不出 {pdf.name} 的頁數（pdfinfo 沒裝且 fallback 也失敗）—— 不派工")
        return 2

    # ── 頁數之外，再比每一頁的文字指紋（#2865）─────────────────────
    # 頁數一樣不代表版面一樣。實測 L0001 兩次轉檔都是 8 頁，但標題從
    # 「三　語詞我最棒」變成「三 🅐 語詞我最棒」—— 只比頁數會放行，
    # 而那份 PDF 的切節結果已經不同了。
    prints_verdict = _compare_prints(args.uid, pdf, manifest)
    if prints_verdict is not None:
        return prints_verdict

    if actual != expected:
        print(
            f"🔴 {args.uid} 手上這份 PDF 是 {actual} 頁，派工單是對 {expected} 頁那份算的。\n"
            "   頁碼會整體位移，而飛機讀到一半仍會回報成功（靜默截斷）。\n"
            "   ⛔ 不要派工。重轉一次，或重跑 scripts/build_section_pages.py 更新派工單。"
        )
        return 1

    print(f"✅ {args.uid} PDF {actual} 頁，與派工單一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
