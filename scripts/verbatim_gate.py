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
    # `review_reason` 是「為什麼這課要人看」的說明，與 `verdict` 同一類：我方寫的。
    # `build_lesson_body.py` 早就在 body.yml 寫它，`extract_key_reading_v3.py`
    # 也在 key_reading.yml 寫 —— 沒排除的話，**標記待審這個動作本身**會讓該課
    # 逐字門變紅（實測 L0072 / L0110 / L0140 三課，紅的全是我自己那段中文）。
    # 誠實標記不應該讓門變紅，否則下一個人的修法就是不要標。
    "review_reason",
    "lesson_uid", "version_id", "catalog_slot", "structure", "strategy_type",
    "type", "index", "idx", "grid_size", "bind", "id", "recommend_range",
    "kind", "why", "confidence", "evidence", "corrected", "errata_ref",
    "drive_file_id", "drive_path", "pdf_pages", "pages_read",
    # `url_source` 是我方記「這個影片連結出自哪張總表」的溯源註記
    # （全庫 291 處，例：「總表0816『4.影片連結』年級9課次16」）——
    # 原稿上根本沒有這行字，拿它去逐字比對必然對不上。
    # ⚠️ 但**不要**把所有 `*_source` 一起排除：`passage_source`
    # 是「（本文出自國立編譯館）」，那是原稿印的出處註記，該檢查。
    "url_source",
    # `intro` 是我方寫的課文摘要（給線上頁用），**學習單上沒有這段** ——
    # 實測 174 課有 intro，印在原稿上的 **0 課**。拿它去逐字比對必然全紅。
    # ⚠️ 這一欄先前從沒被檢查過（⑦b 不涵蓋 metadata），是 2026-08-23
    # 重抽對帳器第一次掃到它才發現 —— 174/175「對不上」看起來像資料大壞，
    # 實際上是那一欄本來就不該驗。
    "intro",
    "section", "locator", "end", "label", "left_header", "right_header",
    "columns", "unit", "attached_to", "marker", "duration", "name",
})
ANNOTATION_RE = re.compile(r"^(note_|_)|(_note|_check|_carrier|_ref)$")

# `source` 在 meta 底下是「來源檔名」，但在 source_errata 底下是「原稿字串」，
# 必須比對。所以用「路徑」判斷，不是用 key 名。
SOURCE_IS_ANNOTATION_PARENTS = frozenset({"meta", "resources", "items", "supplement"})

# 這些容器雖然掛在註解鍵底下，裡面**有一個欄位是可驗的**，所以要走進去。
# `errata`：整份都是我方的判斷（corrected / why / kind / confidence 都在
# ANNOTATION_KEYS 裡），唯獨 `source` 是「原稿實際印的那行錯字」——
# 那是它唯一可以拿原稿驗的主張，而且值得驗：source 對不上 = 這條勘誤本身有問題。
# ⛔ 不要把 errata 整包跳過 —— 那會讓 69 課的 errata 變成「一個字串都沒驗」，
#    而 attest 把「0 受檢」算 FAIL（那是對的），於是 69/69 恆紅、無人能修。
ANNOTATION_CONTAINERS_TO_DESCEND = frozenset({"errata"})


def _holds_verifiable(node) -> bool:
    """這個註解容器裡面，還藏著該驗的東西嗎？

    ⚠️ 不能只看容器自己的鍵。`errata` 實際住在 `notes.errata`，
    在 `notes` 那一層就被擋掉了，於是 69 課的 errata 一個字串都沒驗到 ——
    而 attest 把「0 受檢」算 FAIL（那是對的），結果是 69/69 恆紅、無人能修。
    """
    if isinstance(node, dict):
        return any(
            k in ANNOTATION_CONTAINERS_TO_DESCEND or _holds_verifiable(v)
            for k, v in node.items()
        )
    if isinstance(node, list):
        return any(_holds_verifiable(v) for v in node)
    return False


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
            # `X_source` 已經被列為註解 → 那句註解講的就是「X 是從別處抄來的」，
            # 於是 X 本身也不該拿 DOCX 驗。`videos[].url` 就是這樣：
            # `url_source: 總表0816「4.影片連結」…` —— 連結印在總表上，
            # 學習單上只有 QR code，原稿文字流裡一個字母都沒有。
            # ⚠️ 這條靠「`X_source` 在不在註解名單」判別，不是靠字尾 —— 因為
            # `passage_source` 是「（本文出自國立編譯館）」，那是原稿印的出處，
            # 它不在註解名單，所以 `passage` 照驗。判準已經在資料裡，不用另立表。
            elif k.endswith("_source") and k in ANNOTATION_KEYS:
                corrected.add(k[: -len("_source")])
        for k, v in node.items():
            ks = str(k)
            if ks in corrected:
                continue
            # 🔴 註解排除必須套在**容器**上，不能只套葉節點。
            #    `notes` 一直在 ANNOTATION_KEYS 裡，但那個檢查寫在字串分支、
            #    用的是**葉節點自己的鍵** —— 所以它只保護得了 `notes: "一句話"`。
            #    `notes: {char_count: …, paragraphs: […]}` 會被走進去，
            #    然後拿葉鍵 `char_count` 去比對名單，不在名單 → 照驗，
            #    而那裡面裝的是抽取器自己寫的分析（「本課要用第四條 Word 口徑…」），
            #    原稿當然沒有這行字。全庫 149/174 課紅，這是最大一股。
            #    ⛔ 86% 說壞掉的門沒有人會信 —— 假警報跟漏抓一樣會讓門被關掉。
            if (
                isinstance(v, (dict, list))
                and (ks in ANNOTATION_KEYS or ANNOTATION_RE.search(ks))
                and ks not in ANNOTATION_CONTAINERS_TO_DESCEND
                and not _holds_verifiable(v)
            ):
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


# 原稿的文字流會被「插在段落中間的圖說」切斷。L0002 的課文中間插了
#   枯葉蝶(左下)與皇蛾(右上)翅膀上的蛇頭紋圖1圖2   （而且重複兩次）
# 於是整段課文一個字都沒抄錯，卻因為在原稿裡「不連續」而被判 FAIL。
#
# 放寬成「**依序**出現、允許被打斷」——不是「每一塊各自找得到」。
# 順序仍然要對，所以搬到別課、改寫、重排都還是會紅；
# 只有「中間被塞了東西」會過。
MAX_GAPS = 4        # 一段課文最多容忍被打斷幾次
MIN_PIECE = 8       # 每一塊至少要這麼長，否則就是碎片湊答案


def found_in_order(seg: str, src: str) -> bool:
    """seg 的每一塊都能在 src 裡**依序**找到（中間可以夾別的東西）。"""
    pos, rest, gaps = 0, seg, 0
    while rest:
        lo, hi, best = MIN_PIECE, len(rest), 0
        while lo <= hi:                       # 二分找最長可匹配前綴
            mid = (lo + hi) // 2
            if src.find(rest[:mid], pos) >= 0:
                best, lo = mid, mid + 1
            else:
                hi = mid - 1
        if best < MIN_PIECE:
            return False
        pos = src.find(rest[:best], pos) + best
        rest = rest[best:]
        gaps += 1
        if gaps > MAX_GAPS:
            return False
        if len(rest) < MIN_PIECE:             # 尾巴太短，跟著前一塊算
            return True
    return True


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
            if found_in_order(seg, src):      # 被圖說之類插斷，但順序沒亂
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
    # 🔴 機器可讀的那一行 —— 給 content_fidelity_attest.py 用。
    #    ⛔ 不要叫呼叫端去刮上面那行散文：它用半形冒號、而且同一行還印著
    #    「≥ 4」，把非數字濾掉會得到 "04" → 4。所以每一份 attestation 的
    #    checked 都是 4，不管實際受檢 0 個還是 200 個 —— 我拿那個數字報過
    #    「1176 字串」「308816 字串」，全是刮出來的垃圾。
    print(f"VERBATIM_GATE_CHECKED={checked}")
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
