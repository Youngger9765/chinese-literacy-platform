#!/usr/bin/env python3
"""念順順起訖 —— 從原稿的兩個標記算出 start_paragraph / end_paragraph

規則（Young 2026-08-24 看原稿定案）：
  start = ☞ 錨點所在的那一段
  end   = 右緣累計字數欄「最後一個數字」落在的那一段
  passage = start 段到 end 段，整段包含（不切半句）

⛔ 不是「一路吃段落直到湊滿 max(累計字數)」——那是被否決的舊規則。
   差別：這裡吃到「數字落在的那一段」為止，常常 1 段，數字跨段時才多段。

## 兩個踩過的坑

1. **多個 ☞ 錨點**：drawing 是浮動物件，一課常命中好幾段。
   用計數欄段界投票：從正確起點起算，各段結尾的累計字數會精準命中欄裡的數字。
   平手就判不動，不要挑（L0001 0:0）。

2. **不要用「相鄰兩格的差 ≈ 行長」的比率當硬門檻**。
   真計數欄與雜訊的分布**重疊**（真 70–100%、雜訊 0–87%），
   設 70% 會擋掉 20 課真的（L0173 69% / L0165 67% / L0047 67% / L0054 63%…）。
   雜訊（參考書目、表格數字、章節號）本來就會被
   「最後一行要能在課文中唯一定位」那道擋住，不需要再加一層。
   ⚠️ 我當初的回測組只挑「本來就會過」的課，所以看不到自己造成的 regression。
"""
from __future__ import annotations
import argparse, pathlib, re, subprocess, sys, zipfile
import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"
SOT = pathlib.Path("/Users/young/project/chinese-literacy-platform"
                   "/private/curriculum-source/_SOT")   # 原稿只在主 checkout（gitignored）
CACHE = pathlib.Path("/tmp/kr-xml")


# 不可見字元也要正規化掉：DOCX 內文夾著**變體選擇符**（U+E0100–E01EF），
# 例如「清一󠇡色」「一不󠇡做二不休」。只去空白的話，字串比對會在那個位置之後
# 全部對不上 —— 前 16 字對得上、20 字就不行，而且肉眼完全看不出來。
# 2026-08-24 實測：這一條救回 L0055（→第2段，與指示句印的「二」一致）與 L0076。
_INVISIBLE = re.compile(
    r"[\s\u3000\ufe00-\ufe0f\u200b-\u200f\u2060\ufeff]"
    r"|[\U000e0100-\U000e01ef]"
)


def norm(s: str) -> str:
    return _INVISIBLE.sub("", s or "")


def paragraphs(uid: str) -> list[str]:
    f = LESSONS / uid / "v3" / "full_text_annotate.yml"
    if not f.is_file():
        return []
    d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    ft = d.get("full_text_annotate") or d
    out = [norm((p.get("text") if isinstance(p, dict) else p) or "")
           for p in (ft.get("paragraphs") or [])]
    return [p for p in out if p]


def source(uid: str) -> pathlib.Path:
    m = yaml.safe_load((LESSONS / uid / "v3" / "lesson.yml").read_text(encoding="utf-8"))
    m = m.get("lesson", m)
    return SOT / ((m.get("source") or {}).get("drive_path") or "")


def anchor_paragraphs(uid: str, paras: list[str]) -> list[int]:
    """☞ 掛在哪幾段（XML drawing 錨點；浮動物件所以可能多個）"""
    xml = zipfile.ZipFile(source(uid)).read("word/document.xml").decode("utf-8")
    index = {p[:24]: i + 1 for i, p in enumerate(paras)}
    hits = set()
    for block in re.split(r"(?=<w:p[ >])", xml):
        if not block.startswith("<w:p"):
            continue
        if "<w:drawing" not in block and "<w:pict" not in block:
            continue
        text = norm("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", block)))
        if len(text) >= 25 and text[:24] in index:
            hits.add(index[text[:24]])
    return sorted(hits)


def counter_column(uid: str) -> list[tuple[int, str]]:
    """右緣累計字數欄：(數字, 該行文字)，只取單調遞增那一串"""
    out = CACHE / uid
    out.mkdir(parents=True, exist_ok=True)
    pdfs = list(out.glob("*.pdf"))
    if not pdfs:
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf",
                        "--outdir", str(out), str(source(uid))],
                       check=True, capture_output=True, timeout=600)
        pdfs = list(out.glob("*.pdf"))
    txt = subprocess.run(["pdftotext", "-layout", str(pdfs[0]), "-"],
                         capture_output=True, text=True).stdout
    # 兩種版面都要接：
    #   ① 文字與數字同一行     「…卻贏得了                    369」
    #   ② 數字單獨成一行       文字在上一行，數字自己一行（L0034 是這種）
    # 只接 ① 的話，② 那種課會回報「找不到累計字數欄」—— 但 PDF 裡明明有 16 格。
    rows = []
    prev_text = ""
    for line in txt.split("\n"):
        line = line.rstrip()
        if not line.strip():
            continue
        same = re.search(r"^(.*\S)\s+(\d{2,4})$", line)
        alone = re.fullmatch(r"\s*(\d{2,4})", line)
        if same:
            rows.append((int(same.group(2)), norm(same.group(1))))
            prev_text = norm(same.group(1))
        elif alone and prev_text:
            rows.append((int(alone.group(1)), prev_text))
        else:
            prev_text = norm(line)
    seq: list[tuple[int, str]] = []
    for value, body in rows:
        if not seq:
            seq = [(value, body)]
        elif value > seq[-1][0]:
            seq.append((value, body))
        elif len(seq) < 4:
            seq = [(value, body)]
        else:
            break
    return seq


def locate_last(seq, paras) -> tuple[int | None, str]:
    """最後一個數字那一行落在第幾段。定位不到就是判不動 —— 這道同時擋掉雜訊"""
    if not seq:
        return None, "找不到累計字數欄"
    _, body = seq[-1]
    for probe in range(12, 4, -1):
        tail = body[-probe:]
        where = [i + 1 for i, p in enumerate(paras) if tail in p]
        if len(where) == 1:
            return where[0], ""
    return None, f"最後一行「{body[-14:]}」在課文中定位不到或不唯一"


ZH = "一二三四五六七八九十"


def printed_start(uid: str) -> int | None:
    """指示句印的段號 —— 第三個訊號。

    ⛔ 這不是「錨點失敗時的備援」，是**本來就該一起看的三票之一**
    （owner 2026-08-24：「不是備援是輔助，三者都要看」）。
    實測與 ☞ 錨點一致率 95%（124/131），已知 4 課印錯。
    """
    kr_file = LESSONS / uid / "v3" / "key_reading.yml"
    if not kr_file.is_file():
        return None
    d = yaml.safe_load(kr_file.read_text(encoding="utf-8")) or {}
    kr = d.get("key_reading") or d
    m = re.search(r"從指定段落[（(]\s*([一二三四五六七八九十\d]+)", kr.get("instruction") or "")
    if not m:
        return None
    t = m.group(1)
    if t.isdigit():
        return int(t)
    if len(t) == 1 and t in ZH:
        return ZH.index(t) + 1
    if len(t) == 2 and t[0] == "十":
        return 10 + ZH.index(t[1]) + 1
    if len(t) == 2 and t[1] == "十":
        return (ZH.index(t[0]) + 1) * 10
    if len(t) == 3 and t[1] == "十":
        return (ZH.index(t[0]) + 1) * 10 + ZH.index(t[2]) + 1
    return None


def boundary_hits(start: int, paras: list[str], values: set[int]) -> int:
    """從 start 起算，各段結尾的累計字數命中計數欄幾次 —— 這是驗證票"""
    cum = hit = 0
    for k in range(start - 1, len(paras)):
        cum += len(paras[k])
        if cum in values:
            hit += 1
    return hit


def pick_anchor(anchors, paras, seq, end_no):
    """多個錨點時用計數欄段界投票；平手不挑"""
    if len(anchors) <= 1:
        return anchors, ""
    values = {v for v, _ in seq}
    scores = {}
    for c in anchors:
        cum = hit = 0
        for k in range(c - 1, len(paras)):
            cum += len(paras[k])
            if cum in values:
                hit += 1
        scores[c] = hit
    best = max(scores, key=lambda k: scores[k])
    if scores[best] > 0 and list(scores.values()).count(scores[best]) == 1:
        return [best], f"計數欄段界投票 {scores}"
    if end_no is not None:
        ahead = [c for c in anchors if c <= end_no]
        if len(ahead) == 1:
            return ahead, "只有這個候選在最後一個數字之前"
    return anchors, ""


def run(uid: str) -> dict:
    paras = paragraphs(uid)
    r = {"uid": uid, "verdict": "unknown", "why": "", "start": None, "end": None}
    if not paras:
        r["why"] = "課文缺件（full_text_annotate 沒有段落）"
        return r
    seq = counter_column(uid)
    end_no, note = locate_last(seq, paras)
    anchors = anchor_paragraphs(uid, paras)
    anchors, how = pick_anchor(anchors, paras, seq, end_no)
    r["last_value"] = seq[-1][0] if seq else None
    if len(anchors) != 1:
        # 三票裡 ☞ 這票拿不到 → 用另外兩票：指示句印的段號 + 計數欄段界驗證。
        # ⛔ 不是「備援」，是本來就該一起看（owner 2026-08-24 明令）。
        # 只有在計數欄真的替它背書（段界命中 > 0）時才採信，否則仍判不動。
        printed = printed_start(uid)
        values = {v for v, _ in seq}
        # 多錨點投票平手時，指示句印的段號如果正好是候選之一 → 用它打破平手
        # （L0001 候選 [3,4] 投票 0:0，指示句印「四」）
        if len(anchors) > 1 and printed in anchors:
            anchors = [printed]
            r["anchor_resolved_by"] = f"多錨點平手，指示句印 {printed} 打破平手"
        elif printed and 1 <= printed <= len(paras) and values:
            hits = boundary_hits(printed, paras, values)
            if hits > 0 and (end_no is None or printed <= end_no):
                anchors = [printed]
                r["anchor_resolved_by"] = f"指示句印 {printed} + 計數欄段界命中 {hits} 次"
    if len(anchors) != 1:
        r["why"] = f"☞ 錨點 {anchors or '抓不到'}"
        return r
    if end_no is None:
        r["why"] = note
        return r
    start = anchors[0]
    if end_no < start:
        r["verdict"] = "review"
        r["why"] = f"數字落在第 {end_no} 段，在起點第 {start} 段之前"
        return r
    r.update(verdict="ok", start=start, end=end_no, how=how,
             passage="".join(paras[start - 1:end_no]))
    return r


def apply(uid: str, r: dict) -> None:
    f = LESSONS / uid / "v3" / "key_reading.yml"
    doc = yaml.safe_load(f.read_text(encoding="utf-8"))
    nested = "key_reading" in doc
    kr = doc["key_reading"] if nested else doc
    kr["passage"] = r["passage"]
    kr["start_paragraph"] = r["start"]
    kr["end_paragraph"] = r["end"]
    kr["extent_chars"] = len(r["passage"])
    kr["start_text"] = r["passage"][:24]
    kr["source"] = "docx-anchor-and-count"
    for dead in ("spans_paragraphs", "start_paragraph", "end", "end_paragraph",
                 "approx_chars_from_start", "approx_chars_note"):
        kr.pop(dead, None)
    f.write_text(yaml.safe_dump(doc if nested else kr, allow_unicode=True, sort_keys=False),
                 encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("uids", nargs="*", help="留空＝全庫")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    uids = a.uids or sorted(d.parent.parent.name
                            for d in LESSONS.glob("L*/v3/key_reading.yml"))
    for uid in uids:
        try:
            r = run(uid)
        except Exception as exc:
            print(f"🔴 {uid}  {type(exc).__name__}: {str(exc)[:90]}")
            continue
        kr_file = LESSONS / uid / "v3" / "key_reading.yml"
        cur = 0
        if kr_file.is_file():
            d = yaml.safe_load(kr_file.read_text(encoding="utf-8")) or {}
            cur = len(norm(((d.get("key_reading") or d) or {}).get("passage") or ""))
        if r["verdict"] == "ok":
            span = f"{r['start']}" if r["start"] == r["end"] else f"{r['start']}–{r['end']}"
            print(f"✅ {uid}  ☞第{r['start']}段 · 最後數字 {r['last_value']} 落第{r['end']}段"
                  f" → 第 {span} 段 = {len(r['passage'])} 字（現存 {cur}）"
                  + (f"  [{r['how']}]" if r.get("how") else ""))
            # 字數本來就對的課也要寫 —— 它們缺 start_paragraph/end_paragraph，
            # 只看字數會讓那些課永遠沒有段號（golden set 2026-08-24 抓到）
            kr_now = (yaml.safe_load(kr_file.read_text(encoding="utf-8")) or {}) if kr_file.is_file() else {}
            kr_now = kr_now.get("key_reading") or kr_now or {}
            needs = (len(r["passage"]) != cur
                     or kr_now.get("start_paragraph") != r["start"]
                     or kr_now.get("end_paragraph") != r["end"])
            if a.apply and needs:
                apply(uid, r)
                print(f"      ↳ 寫入 start_paragraph={r['start']} end_paragraph={r['end']}")
        else:
            print(f"—  {uid}  {r['why']}（現存 {cur} 字）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
