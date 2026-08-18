#!/usr/bin/env python3
"""逐字比對門（extract-lesson-multimodal 的第 3 道）

LLM 讀圖會潤稿、會看錯字形（實測：「不分軒輊」被讀成「不分軒輕」，7 處全錯）。
這道門把抽出來的每個字串拿回 DOCX 逐字對，對不上就報。

**這是驗證工具，所以偏向 fail-closed**：不確定就報，寧可假陽性不要假陰性。

用法：
    python3 scripts/verbatim_gate.py --yaml <抽取結果.yml> --docx <原稿.docx>
    python3 scripts/verbatim_gate.py --yaml a.yml --docx b.docx --json out.json

退出碼：0 = 全數對上；1 = 有對不上的字串，或沒有任何字串被檢查
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

import yaml

# ── 讀 DOCX ───────────────────────────────────────────────────────────────

# ⚠️ `<w:t[^>]*>` 會誤吃 `<w:tab .../>`（w:tab 的前三個字元就是 w:t），把 XML 屬性
#    字串混進「原稿文字」——實測會讓來源從 5.6k 真字元膨脹成 248k 垃圾。必須要求後接空白或 `>`。
WT_RE = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.S)
PARA_RE = re.compile(r"<w:p(?:\s[^>]*)?>.*?</w:p>", re.S)

# 課文以外的文字散落在這些 part：註腳漏掉會誤報
DOCX_PARTS = ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml")

# 第五種載體：**Word 原生圖表**。座標軸標籤、圖例、系列名住在 `word/charts/*.xml`
# 的 `<a:t>` 裡，`document.xml` 一個字都沒有。
#
# 2026-08-18 L0150：課文的圖1、圖2 在 PDF 上一片空白（LibreOffice 畫不出來），
# 而數字完整躺在 chart XML 裡。只看 PDF 會判成「這兩張圖沒內容」，
# 而逐字門讀不到 charts，所以抽取者只能借 `text_carrier: image` 讓它進「無法驗證」——
# 那等於把可以驗的東西放進不驗的桶子。
#
# 全庫實測：157 課裡只有 2 課有圖表文字（合計 96 字），量很小但是真的內容。
# ⚠️ 加來源 part **只會讓更多字串找得到**，不可能製造新的 FAIL。
CHART_PART_RE = "word/charts/"

# 為什麼不用「以段落為比對單位」擋跨段拼接（2026-08-17 實測後放棄）
# ------------------------------------------------------------------
# 理論上把 `<w:p>` 之間放分隔符，可以擋掉「上段結尾＋下段開頭」拼出來的假 PASS。
# 但這批教材的 DOCX 不是那樣排的：L0002 有 **403 個 `<w:p>`、平均 12 字**，
# 課文的一個邏輯段落被拆散在幾十個區塊裡（`枯葉蝶就是偽裝高手` 不存在於任何單一區塊）。
# 加了分隔符 → 每一段課文都對不上 → 23 個假陽性。
# 在這種結構下，任何正確的抽取都必然跨區塊，所以「跨區塊」不帶任何訊號。
# 結論：用攤平比對；跨段拼接改由 `paragraph_count` 與人工逐頁閱讀把關。

# 破折號/連字號在 DOCX 與抽取結果之間常互換（──／—／–／-），不算歧異
DASHES = str.maketrans({c: "-" for c in "──—–－―‒"})

# 清單項目符號由 numbering.xml 產生；☞ 指標與 ※ 標記有時是圖形／符號物件
# —— 都不保證在 w:t 文字流裡。實測：L0072 的「※注意：」在原稿文字流中只有
# 「注意：」，※ 不在；但 L0124 的「※請勾選出正確答案」整串都在。同一個符號
# 兩種下場，所以兩邊都拿掉再比 —— 它是裝飾不是內容。
BULLETS = "・•·‧◆▪▶●○☞☜➤※"


def norm(s: str) -> str:
    """去掉隱藏字元、空白與清單項目符號，統一破折號。"""
    s = html.unescape(s)                       # DOCX 內是 &amp; &lt;，YAML 裡是 & <
    # 全形／半形在兩邊常不一致（原稿 `(＞、＝或＜)` vs 抽取 `(>、＝或<)`），
    # NFKC 把它們收斂到同一形，避免純寬度差異被當成抄錯。
    s = unicodedata.normalize("NFKC", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) not in ("Cf", "Mn"))
    s = "".join(ch for ch in s if ch not in BULLETS)
    return re.sub(r"\s+", "", s).translate(DASHES)


def docx_text(path: Path) -> str:
    """回傳原稿全文（攤平；理由見上方 BLOCK_SEP 註解）。"""
    chunks: list[str] = []
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        for part in DOCX_PARTS:
            if part in names:
                raw = z.read(part).decode("utf-8", "ignore")
                chunks.append("".join(WT_RE.findall(raw)))
        # 圖表用的是 DrawingML 的 `<a:t>`，不是 `<w:t>`，所以要另外抓
        for part in sorted(n for n in names if n.startswith(CHART_PART_RE) and n.endswith(".xml")):
            raw = z.read(part).decode("utf-8", "ignore")
            chunks.append("".join(re.findall(r"<a:t>([^<]*)</a:t>", raw)))
    return norm("".join(chunks))


# ── 收集要比對的字串 ───────────────────────────────────────────────────────

# 只切「真正的填空/勾選標記」。⚠️ 不要切一般括號與換行——`（Beyond Meat）`、
# block scalar 的換行都會被切碎成短片段，然後被長度門檻丟掉，變成漏報。
SPLIT_RE = re.compile(
    r"【[\s　]*】"          # 【　】
    r"|〖[\s　]*〗"
    r"|（[\s　]*）"          # （　）
    r"|\([\s　]*\)"
    r"|[□☑☒]"
    r"|\n"                  # 抽取結果的換行 = 原稿的段落界線
)

# Word 的自動編號（1. / 一、/ (一) / ❶）由 numbering.xml 產生，不在 w:t 文字流裡。
# 抽取結果照著版面打會把它們寫進字串，於是每個列點都對不上——全是假陽性。
LIST_MARKER_RE = re.compile(
    r"^(?:[0-9]{1,2}[.、)]"
    r"|[一二三四五六七八九十]{1,2}[、.)]"
    r"|[(][一二三四五六七八九十0-9]{1,2}[)]"
    r"|[\u2776-\u277f\u2460-\u2473\u2780-\u2793])"
)

# 這些 key 的值是抽取者自己寫的，不是原稿字串
ANNOTATION_KEYS = frozenset({
    "note", "notes", "verdict", "method", "answer_carrier", "extraction_check",
    "lesson_uid", "version_id", "catalog_slot", "structure", "strategy_type",
    "type", "index", "idx", "grid_size", "bind", "id", "recommend_range",
    "kind", "why", "confidence", "evidence", "corrected", "errata_ref",
    "drive_file_id", "drive_path", "pdf_pages", "pages_read",
    "section", "locator", "end", "label", "left_header", "right_header",
    "columns", "unit", "attached_to", "marker", "duration", "name",
})
ANNOTATION_RE = re.compile(r"^(note_|_)|(_note|_check|_carrier|_ref)$")

# `source` 在 meta 底下是「來源檔名」，但在 source_errata 底下是「原稿字串」，
# 必須比對。所以用「路徑」判斷，不是用 key 名。
SOURCE_IS_ANNOTATION_PARENTS = frozenset({"meta", "resources", "items", "supplement"})


def has_cjk(s: str) -> bool:
    return any("一" <= ch <= "鿿" for ch in s)


# 內容畫在圖片/圖形上時，文字流裡不會有它 —— 逐字門驗不到。
# 這種節點標 `text_carrier: image`，門會把它列進「無法驗證」而不是靜默跳過：
# 靜默跳過會讓「整段其實抄錯」跟「本來就驗不到」長得一模一樣。
# ⚠️ 只有 `text_carrier: image` 代表「這一段的文字本身畫在圖上」。
#    `answers_are_graphical: true` 只是說「答案是圈線/勾記」——它的指示語與題目文字
#    仍然在文字流裡，必須照驗。兩者混用會讓一整節逃過檢查。
IMAGE_CARRIER_FLAGS = ("text_carrier", "answers_are_graphical")


def _is_image_carrier(node: dict) -> bool:
    return str(node.get("text_carrier", "")).lower() == "image"


def walk(node, key=None, parent=None, out=None, unverifiable=None, in_image=False):
    """收集 YAML 裡所有「應該逐字來自原稿」的 (key, 字串)。"""
    if out is None:
        out = []
    if unverifiable is None:
        unverifiable = []
    if isinstance(node, dict):
        if _is_image_carrier(node) and not in_image:
            # 整個子樹都是圖上的文字 —— 全部收進 unverifiable，一個都不許靜默丟掉
            walk(node, key, parent, out, unverifiable, in_image=True)
            return out
        # `X_source_text` 存在 → `X` 是刻意修正過的版本，不比對它，改比 source_text。
        # 同名式（source_text ↔ text）與前綴式（stem_source_text ↔ stem）都要蓋到。
        corrected = set()
        for k in node:
            k = str(k)
            if k == "source_text":
                corrected.add("text")
            elif k.endswith("_source_text"):
                corrected.add(k[: -len("_source_text")])
        for k, v in node.items():
            ks = str(k)
            if ks in corrected:
                continue
            if ks == "source" and parent in SOURCE_IS_ANNOTATION_PARENTS:
                continue
            if ks == "title" and key == "meta":
                # ⚠️ `meta.title` 來自**總表 xlsx**（skill ⑤：「課名 → 對照 lesson.yml 的 title」），
                #    而這道門比對的是 **DOCX**。拿 A 來源的欄位去 B 來源找，找不到是必然的。
                #    L0139 就是這樣：總表課名「長喙天蛾見前人所未見」，
                #    學習單印的標題是「見前人所未見──達爾文與長喙天蛾的故事」——
                #    兩個都對，只是不同來源。門報 FAIL 會叫人去改一個沒有壞的欄位。
                #    真正該驗 title 的是「它跟總表對不對得上」，那是另一件事、另一個來源。
                continue
            if ks == "answer_paths":
                # ⚠️ 找字遊戲的 `word` 是**從座標套回格子算出來的**，不是抄來的。
                #    教材的格子印錯字時（「堅不可摧」印成「堅不可催」），
                #    座標門要求 word == 拼出來的字，逐字門卻要求它在原稿找得到 ——
                #    而斜著拼出來的字串原稿任何地方都不存在，兩道門直接互相打架。
                #    L0026 的「苦腦」只是因為 2 個字低於 4 字門檻才躲過。
                #    這一段交給 `normalize_word_search.py` 用格子驗，不歸逐字門管。
                continue
            walk(v, ks, key, out, unverifiable, in_image)
    elif isinstance(node, list):
        for v in node:
            walk(v, key, parent, out, unverifiable, in_image)
    elif isinstance(node, str):
        ks = str(key or "")
        if ks in ANNOTATION_KEYS or ANNOTATION_RE.search(ks):
            return out
        if ks == "source" and parent in SOURCE_IS_ANNOTATION_PARENTS:
            return out
        if ks in IMAGE_CARRIER_FLAGS:
            return out
        (unverifiable if in_image else out).append((ks, node))
    return out


def check(yaml_path: Path, docx_path: Path, min_len: int):
    src = docx_text(docx_path)
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"⛔ {yaml_path} 不是 mapping，無法比對")

    unverifiable: list = []
    pairs = walk(data, unverifiable=unverifiable)
    checked, misses = 0, []
    for key, val in pairs:
        segs = [s for s in (LIST_MARKER_RE.sub("", norm(p)) for p in SPLIT_RE.split(val))
                if len(s) >= min_len and has_cjk(s)]
        if not segs:
            continue
        checked += 1

        bad = []
        for seg in segs:
            if seg in src:
                continue
            # 這一段對不上 → 再切短，把真正歧異的那幾個字揪出來
            span = 20
            frags = [seg[i:i + span] for i in range(0, len(seg), span)]
            hit = [f for f in frags if len(f) >= min_len and f not in src]
            bad.extend(hit or [seg])

        if bad:
            misses.append({
                "field": key,
                "preview": val[:60].replace("\n", " "),
                "unmatched_fragments": bad[:4],
            })
    return checked, misses, src, unverifiable


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yaml", required=True, type=Path)
    ap.add_argument("--docx", required=True, type=Path)
    ap.add_argument("--min-len", type=int, default=4,
                    help="片段短於此長度不比對（預設 4；答案/語詞多為 2-4 字，別調高）")
    ap.add_argument("--json", type=Path)
    ap.add_argument("--allow-empty", action="store_true",
                    help="允許 0 個字串被檢查仍算 PASS（預設視為 FAIL）")
    a = ap.parse_args()

    checked, misses, src, unverifiable = check(a.yaml, a.docx, a.min_len)

    print(f"原稿字元數 : {len(src)}")
    print(f"受檢字串   : {checked}（片段長度 ≥ {a.min_len} 且含中文）")
    print(f"對不上     : {len(misses)}")
    print(f"無法驗證   : {len(unverifiable)}（標了 text_carrier: image，文字畫在圖上）")
    if misses:
        print()
        for m in misses:
            print(f"  ✗ [{m['field']}] {m['preview']}")
            for f in m["unmatched_fragments"]:
                print(f"      對不上的片段: {f}")

    if unverifiable:
        print()
        for k, v in unverifiable[:10]:
            print(f"  ~ [{k}] {v[:56]}")

    if a.json:
        a.json.write_text(
            json.dumps({"checked": checked, "misses": misses,
                        "unverifiable": [{"field": k, "text": v} for k, v in unverifiable]},
                       ensure_ascii=False, indent=1),
            encoding="utf-8",
        )

    # fail-closed：一個字串都沒檢查到，多半是 YAML 空的、schema 變了、或過濾器吃光了。
    # 這種情況回 PASS 等於默默放行，比報錯危險。
    if checked == 0 and not a.allow_empty:
        print("\n⛔ 沒有任何字串被檢查——視為 FAIL（要放行請加 --allow-empty）")
        print("VERBATIM_GATE=FAIL")
        return 1

    print()
    print("VERBATIM_GATE=" + ("PASS" if not misses else "FAIL"))
    return 0 if not misses else 1


if __name__ == "__main__":
    sys.exit(main())
